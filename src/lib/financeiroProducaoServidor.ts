import 'server-only';

import { mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getVercelOidcToken } from '@vercel/oidc';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { uuidFinanceiro } from './comandoFinanceiro';
import { confirmarComando, ErroServico, type TransacaoFinanceira } from './executorFinanceiroServidor';
import { lerDados } from './gestao';
import { acaoDeCaixinha, confirmarCaixinha, consultarCaixinhas, validarSaldosConciliados, type TransacaoCatalogo } from './gestaoCaixinhasServidor';
import { criarAutenticadorFirebase } from './identidadeFinanceiraServidor';

const projeto = 'appcar-a0886';
const nomeApp = 'appcar-financeiro-producao';
type Registro = Record<string, unknown>;

function listarColecao(db: Firestore, tx: Transaction): TransacaoCatalogo['listar'] {
  return async (caminho, filtro) => {
    const colecao = db.collection(caminho);
    const consulta = filtro ? colecao.where(filtro.campo, filtro.operador, filtro.valor) : colecao;
    return (await tx.get(consulta)).docs.map(doc => doc.data());
  };
}

let caminhoToken: string | undefined;
async function prepararCredencialVercel() {
  if (process.env.VERCEL_ENV !== 'production') return;
  const audience = process.env.APPCAR_FIREBASE_OIDC_AUDIENCE;
  const conta = process.env.APPCAR_FIREBASE_OIDC_SERVICE_ACCOUNT;
  if (!audience || !/^\/\/iam\.googleapis\.com\/projects\/\d+\/locations\/global\/workloadIdentityPools\/[\w-]+\/providers\/[\w-]+$/.test(audience)
      || !conta?.endsWith('@' + projeto + '.iam.gserviceaccount.com') || !/^[a-z0-9-]+@[a-z0-9.-]+$/.test(conta)) {
    throw new ErroServico(503, 'Identidade do serviço financeiro não configurada.');
  }
  const token = await getVercelOidcToken();
  if (!caminhoToken) {
    const diretorio = mkdtempSync(join(tmpdir(), 'appcar-firebase-'));
    caminhoToken = join(diretorio, 'token');
    const config = join(diretorio, 'adc.json');
    writeFileSync(config, JSON.stringify({
      type: 'external_account', audience,
      subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
      token_url: 'https://sts.googleapis.com/v1/token',
      service_account_impersonation_url: 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/' + conta + ':generateAccessToken',
      credential_source: { file: caminhoToken, format: { type: 'text' } },
    }), { mode: 0o600 });
    process.env.GOOGLE_APPLICATION_CREDENTIALS = config;
  }
  const temporario = caminhoToken + '.tmp';
  writeFileSync(temporario, token, { mode: 0o600 });
  renameSync(temporario, caminhoToken);
}

async function infraestrutura() {
  if (process.env.NODE_ENV !== 'production'
      || (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production')
      || process.env.APPCAR_FINANCEIRO_PRODUCAO !== '1' || process.env.APPCAR_FIREBASE_PROJECT_ID !== projeto
      || process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_EMULATOR_HUB) {
    throw new ErroServico(503, 'Serviço financeiro de produção desabilitado.');
  }

  await prepararCredencialVercel();
  const app = getApps().find(item => item.name === nomeApp)
    ?? initializeApp({ projectId: projeto, credential: applicationDefault() }, nomeApp);
  if (app.options.projectId !== projeto) throw new ErroServico(503, 'Projeto financeiro divergente.');
  const adminAuth = getAuth(app);
  return {
    db: getFirestore(app),
    agora: FieldValue.serverTimestamp,
    autenticar: criarAutenticadorFirebase({
      async verifyIdToken(token, revogacao) {
        const identidade = await adminAuth.verifyIdToken(token, revogacao);
        if (!identidade.firebase?.sign_in_provider || identidade.firebase.sign_in_provider === 'anonymous') {
          throw new Error('Identidade não autorizada.');
        }
        return identidade;
      },
    }, projeto),
  };
}

async function autenticarRequisicao(cabecalho: string | undefined) {
  const infra = await infraestrutura();
  try {
    const { uid } = await infra.autenticar(cabecalho);
    if (!uidValido(uid)) throw new Error('UID inválido.');
    return { ...infra, uid };
  } catch { throw new ErroServico(401, 'Sessão inválida ou revogada.'); }
}

function uidValido(uid: string) {
  return /^[A-Za-z0-9_-]{1,128}$/.test(uid);
}

function espacoIntegrado(marcador: Registro) {
  if (marcador.contrato !== 'appdata-v1' || typeof marcador.espacoId !== 'string'
      || !uuidFinanceiro.test(marcador.espacoId)
      || (marcador.estado !== 'ativo' && marcador.estado !== 'suspenso')) {
    throw new ErroServico(503, 'O espaço está em preparação. A gravação está bloqueada.');
  }
  return marcador.espacoId;
}

function versaoValida(dados: Registro | undefined) {
  const sync = dados?._sync as { generation?: number; revision?: number } | undefined;
  return sync && typeof sync.generation === 'number' && Number.isSafeInteger(sync.generation) && sync.generation >= 0
    && typeof sync.revision === 'number' && Number.isSafeInteger(sync.revision) && sync.revision >= 0;
}

export async function consultarFinanceiroReal(authorization: string | undefined, titular: string | null, resolverDestino = false) {
  const { db, uid } = await autenticarRequisicao(authorization);
  const owner = titular ?? uid;
  if (!uidValido(owner)) throw new ErroServico(400, 'Espaço inválido.');
  return db.runTransaction(async tx => {
    const ler = async (caminho: string) => (await tx.get(db.doc(caminho))).data();
    if (owner !== uid) {
      const convite = await ler('shareInvites/' + owner);
      if (convite?.ownerUid !== owner || convite.partnerUid !== uid || convite.status !== 'active') {
        throw new ErroServico(403, 'Consulta não autorizada neste espaço.');
      }
    }
    const marcador = await ler('financeiroIntegrado/' + owner);
    if (!marcador) return { modo: 'legado' as const };
    const espacoId = espacoIntegrado(marcador);
    const espaco = 'espacosFinanceiros/' + espacoId;
    const controle = await ler(espaco);
    if (controle?.proprietarioUid !== owner) throw new ErroServico(503, 'Titularidade do espaço não confirmada.');
    if (resolverDestino) return { modo: 'integrado' as const, espacoId };
    const dados = await ler('users/' + owner + '/appData/main');
    if (!versaoValida(dados)) throw new ErroServico(503, 'Base financeira sem versão compatível.');
    const financeiro = lerDados(dados);
    const proprietario = owner === uid;
    const gravavel = proprietario && marcador.estado === 'ativo' && controle.comandosFinanceiros === true;
    const caixinhas = await consultarCaixinhas({ listar: listarColecao(db, tx) }, espaco, financeiro, proprietario);
    const acoes = gravavel && Array.isArray(controle.operacoesFinanceiras)
      ? controle.operacoesFinanceiras.filter(acao => acaoDeCaixinha(acao) || acao === 'deposito-caixinha' || acao === 'retirada') : [];
    const financeiroVisivel = proprietario ? financeiro : {
      _sync: financeiro._sync,
      historico: financeiro.historico.map(item => {
        const { motivoEstorno, ...visivel } = item;
        return motivoEstorno === undefined ? item : visivel;
      }),
      modoEscuro: financeiro.modoEscuro,
      lembrete: '',
      nomeReserva1: financeiro.nomeReserva1,
      nomeReserva2: financeiro.nomeReserva2,
      nomeReserva3: financeiro.nomeReserva3,
      reservasDiarias: financeiro.reservasDiarias?.map(({ id, nome, valor }) => ({ id, nome, valor })),
      custosFixos: financeiro.custosFixos.map(({ id, nome, valorMensal, cor }) => ({ id, nome, valorMensal, cor })),
    };
    return { modo: 'integrado' as const, espacoId, gravavel, financeiro: financeiroVisivel, caixinhas: { ...caixinhas, acoes } };
  });
}

export async function gravarFinanceiroReal(authorization: string | undefined, contaFila: string | null,
  espacoId: string, entrada: unknown) {
  if (!uuidFinanceiro.test(espacoId)) throw new ErroServico(400, 'Espaço inválido.');
  const { db, uid, agora } = await autenticarRequisicao(authorization);
  if (contaFila !== uid) throw new ErroServico(403, 'A sessão pertence a outra conta.', 'conta-divergente');
  return db.runTransaction(async tx => {
    const caminho = 'users/' + uid + '/appData/main';
    const get: TransacaoFinanceira['get'] = async caminho => (await tx.get(db.doc(caminho))).data();
    const marcador = await get('financeiroIntegrado/' + uid);
    if (!marcador || espacoIntegrado(marcador) !== espacoId) throw new ErroServico(403, 'Espaço integrado não autorizado.');
    if (marcador.estado !== 'ativo') throw new ErroServico(503, 'Envios suspensos neste espaço.');
    if (!versaoValida(await get(caminho))) throw new ErroServico(503, 'Base financeira sem versão compatível.');
    const adaptador: TransacaoCatalogo = {
      get,
      listar: listarColecao(db, tx),
      set: (destino, dados) => {
        if (destino === caminho) tx.set(db.doc(destino), dados, { mergeFields: Object.keys(dados) });
        else tx.set(db.doc(destino), dados);
      },
      agora,
    };
    const espaco = 'espacosFinanceiros/' + espacoId;
    const tipo = (entrada as { alteracao?: { tipo?: unknown } } | null)?.alteracao?.tipo;
    if (acaoDeCaixinha(tipo)) return confirmarCaixinha(adaptador, uid, espaco, caminho, entrada);
    return confirmarComando(adaptador, uid, espacoId, caminho, entrada, {
      atualizarCampos: true, criarCusto: true,
      validarSaldos: (antes, depois, ids) => validarSaldosConciliados(adaptador, espaco, antes, depois, ids),
    });
  });
}
