import 'server-only';

import { join } from 'node:path';
import { uuidFinanceiro } from './comandoFinanceiro';
import { confirmarComando, ErroServico, type TransacaoFinanceira } from './executorFinanceiroServidor';
import { lerDados } from './gestao';
import { acaoDeCaixinha, confirmarCaixinha, consultarCaixinhas, validarSaldosConciliados, type TransacaoCatalogo } from './gestaoCaixinhasServidor';
import { criarAutenticadorFirebase, type VerificadorFirebaseServidor } from './identidadeFinanceiraServidor';

const projeto = 'appcar-a0886';
const nomeApp = 'appcar-financeiro-producao';
type AppAdmin = { name: string; options: { projectId?: string } };
type Referencia = { path: string };
type Registro = Record<string, unknown>;
type Consulta = { where(campo: string, operador: 'in', valor: readonly string[]): Consulta };
type TransacaoAdmin = {
  get(ref: Referencia): Promise<{ data(): Registro | undefined }>;
  get(ref: Consulta): Promise<{ docs: { data(): Registro }[] }>;
  set(ref: Referencia, dados: Registro, opcoes?: { mergeFields: string[] }): unknown;
};
type BancoAdmin = {
  doc(caminho: string): Referencia;
  collection(caminho: string): Consulta;
  runTransaction<T>(executar: (tx: TransacaoAdmin) => Promise<T>): Promise<T>;
};

function listarColecao(db: BancoAdmin, tx: TransacaoAdmin): TransacaoCatalogo['listar'] {
  return async (caminho, filtro) => {
    const colecao = db.collection(caminho);
    const consulta = filtro ? colecao.where(filtro.campo, filtro.operador, filtro.valor) : colecao;
    return (await tx.get(consulta)).docs.map(doc => doc.data());
  };
}

function infraestrutura() {
  if (process.env.NODE_ENV !== 'production'
      || (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production')
      || process.env.APPCAR_FINANCEIRO_PRODUCAO !== '1' || process.env.APPCAR_FIREBASE_PROJECT_ID !== projeto
      || process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_EMULATOR_HUB) {
    throw new ErroServico(503, 'Serviço financeiro de produção desabilitado.');
  }

  // O SDK externo e as ADC pertencem ao ambiente Node do servidor.
  const { createRequire } = process.getBuiltinModule('node:module');
  const carregar = createRequire(join(process.cwd(), 'package.json'));
  const apps = carregar('firebase-admin/app') as {
    applicationDefault(): unknown;
    getApps(): AppAdmin[];
    initializeApp(opcoes: { projectId: string; credential: unknown }, nome: string): AppAdmin;
  };
  const auth = carregar('firebase-admin/auth') as {
    getAuth(app: AppAdmin): { verifyIdToken(token: string, revogacao: true): Promise<
      Awaited<ReturnType<VerificadorFirebaseServidor['verifyIdToken']>> & { firebase?: { sign_in_provider?: string } }
    > };
  };
  const firestore = carregar('firebase-admin/firestore') as {
    getFirestore(app: AppAdmin): BancoAdmin;
    FieldValue: { serverTimestamp(): unknown };
  };
  const app = apps.getApps().find(item => item.name === nomeApp)
    ?? apps.initializeApp({ projectId: projeto, credential: apps.applicationDefault() }, nomeApp);
  if (app.options.projectId !== projeto) throw new ErroServico(503, 'Projeto financeiro divergente.');
  const adminAuth = auth.getAuth(app);
  return {
    db: firestore.getFirestore(app),
    agora: () => firestore.FieldValue.serverTimestamp(),
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
  const infra = infraestrutura();
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
      ? controle.operacoesFinanceiras.filter(acaoDeCaixinha) : [];
    const financeiroVisivel = proprietario ? financeiro : {
      _sync: financeiro._sync,
      historico: financeiro.historico,
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
