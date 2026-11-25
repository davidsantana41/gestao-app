import { createHash, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import { deleteApp, initializeApp } from 'firebase/app';
import { collection, connectFirestoreEmulator, doc, getDocFromServer, getDocsFromServer, getFirestore, runTransaction, serverTimestamp, terminate, type Firestore } from 'firebase/firestore';
import { lerComandoFinanceiro, montarFinanceiro, uuidFinanceiro } from './comandoFinanceiro.ts';
import { lerDados } from './gestao.ts';
import { caixinhasAfetadas, saldoVerificavelEmCentavos } from './integridadeCaixinhas.ts';
import { metadata, version } from './syncSession.ts';
import { exigirOperacaoAdministrativa, podeExecutarComandoFinanceiro } from './identidadeFinanceiraServidor.ts';
import { criarBackupFinanceiro } from './backupFinanceiroServidor.ts';
import { ErroAdministrativo, executarAdministracaoEmulador } from './administracaoFinanceiraEmulador.ts';

export const projetoFinanceiroEmulador = 'demo-appcar-financeiro';
const host = '127.0.0.1';
const portaFirestore = 8091;
const authEmulador = '127.0.0.1:9097';
const hubEmulador = '127.0.0.1:4415';
const duracaoSessaoMs = 5 * 60_000;

class ErroServico extends Error {
  readonly status: number;
  readonly codigo?: string;

  constructor(status: number, mensagem: string, codigo?: string) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
  }
}

async function lerCorpo(req: IncomingMessage, limite = 32_768): Promise<unknown> {
  const partes: Buffer[] = [];
  let tamanho = 0;
  for await (const parte of req.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.isBuffer(parte) ? parte : Buffer.from(parte);
    tamanho += buffer.length;
    if (tamanho > limite) {
      req.resume();
      throw new ErroServico(413, 'Corpo excede o limite.');
    }
    partes.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(partes).toString('utf8'));
  } catch {
    throw new ErroServico(400, 'JSON inválido.');
  }
}

async function autenticar(entrada: unknown) {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) throw new ErroServico(400, 'Credenciais inválidas.');
  const { email, senha } = entrada as Record<string, unknown>;
  if (Object.keys(entrada).length !== 2 || typeof email !== 'string' || typeof senha !== 'string'
      || email.length > 254 || senha.length > 1024 || !email.endsWith('@appcar.test')) {
    throw new ErroServico(400, 'Credenciais inválidas.');
  }
  const resposta = await fetch(`http://${authEmulador}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${projetoFinanceiroEmulador}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: senha, returnSecureToken: true }),
    redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  if (resposta.status === 400 || resposta.status === 401) throw new ErroServico(401, 'Credenciais inválidas.');
  if (!resposta.ok) throw new ErroServico(503, 'Autenticação indisponível.');
  const identidade = await resposta.json() as { localId?: unknown };
  if (typeof identidade.localId !== 'string' || !identidade.localId) throw new ErroServico(503, 'Identidade indisponível.');
  return identidade.localId;
}

async function confirmar(db: Firestore, uid: string, espacoId: string, entrada: unknown) {
  let comando;
  try {
    comando = lerComandoFinanceiro(entrada);
  } catch (erro) {
    throw new ErroServico(400, (erro as Error).message);
  }
  const { revisao, ...intencao } = comando;
  const assinatura = createHash('sha256').update(version(intencao)).digest('hex');
  const espaco = doc(db, 'espacosFinanceiros', espacoId);
  const financeiro = doc(espaco, 'dados', 'main');
  const evento = doc(espaco, 'operacoes', comando.operacaoId);

  return runTransaction(db, async tx => {
    const controle = (await tx.get(espaco)).data();
    if (!podeExecutarComandoFinanceiro(uid, controle, comando.tipo)) {
      throw new ErroServico(403, 'Operação não autorizada neste espaço.');
    }
    const documento = (await tx.get(financeiro)).data();
    const sync = metadata(documento);
    if (!documento?._sync || comando.geracao !== sync.generation) {
      throw new ErroServico(409, 'Geração financeira divergente.', 'geracao-divergente');
    }
    const confirmado = (await tx.get(evento)).data();
    if (confirmado) {
      if (confirmado.assinatura !== assinatura || confirmado.autorUid !== uid || confirmado.geracao !== sync.generation) {
        throw new ErroServico(409, 'ID de operação já utilizado.');
      }
      return { operacaoId: comando.operacaoId, revisao: confirmado.revisao as number, repetida: true };
    }
    if ((await tx.get(doc(espaco, 'administracao', comando.operacaoId))).exists()) {
      throw new ErroServico(409, 'ID de operação já utilizado.');
    }
    if (revisao !== sync.revision) throw new ErroServico(409, 'Revisão financeira divergente.');
    const antes = lerDados(documento);
    const depois = validarMovimentos(() => montarFinanceiro(antes, comando));
    const { ids, alteraPendencias } = caixinhasAfetadas(antes, depois);
    if (alteraPendencias) throw new ErroServico(422, 'A alteração afeta referências ambíguas.');
    const catalogo = await Promise.all(ids.map(async id => {
      const registro = await tx.get(doc(espaco, 'caixinhas', encodeURIComponent(id)));
      return { id, dados: registro.data() };
    }));
    for (const { id, dados } of catalogo) {
      if (dados?.id !== id || (dados.estado !== 'ativa' && dados.estado !== 'arquivada')) {
        throw new ErroServico(422, 'Identidade da caixinha indisponível.');
      }
      if (dados.estado === 'arquivada') throw new ErroServico(422, 'Movimentação em caixinha arquivada.');
      validarMovimentos(() => {
        const anterior = saldoVerificavelEmCentavos(antes, id);
        const posterior = saldoVerificavelEmCentavos(depois, id);
        if (posterior < 0 && posterior < anterior) throw new Error('Saldo insuficiente na caixinha.');
      });
    }
    const proximaRevisao = revisao + 1;
    const lancamentoId = comando.tipo === 'custos-fixos' ? null
      : ('alvo' in comando ? comando.alvo : null) ?? comando.operacaoId;
    tx.set(financeiro, { ...depois, _sync: { ...sync, revision: proximaRevisao } });
    tx.set(evento, {
      id: comando.operacaoId, espacoId, assinatura, autorUid: uid, geracao: sync.generation,
      revisaoAnterior: revisao, revisao: proximaRevisao, tipo: comando.tipo,
      lancamentoId, caixinhas: ids.sort(), confirmadoEm: serverTimestamp(),
    });
    return { operacaoId: comando.operacaoId, revisao: proximaRevisao, repetida: false };
  });
}

function validarMovimentos<T>(acao: () => T): T {
  try {
    return acao();
  } catch (erro) {
    throw new ErroServico(422, (erro as Error).message);
  }
}

async function consultarEspaco(db: Firestore, uid: string, espacoId: string) {
  const espaco = doc(db, 'espacosFinanceiros', espacoId);
  const controle = (await getDocFromServer(espaco)).data();
  if (controle?.proprietarioUid !== uid) throw new ErroServico(403, 'Consulta não autorizada neste espaço.');

  const financeiro = doc(espaco, 'dados', 'main');
  const antes = (await getDocFromServer(financeiro)).data();
  if (!antes?._sync) throw new ErroServico(409, 'Financeiro indisponível.');
  const catalogo = await getDocsFromServer(collection(espaco, 'caixinhas'));
  const [controleAtual, depois] = await Promise.all([getDocFromServer(espaco), getDocFromServer(financeiro)]);
  if (controleAtual.data()?.proprietarioUid !== uid) throw new ErroServico(403, 'Consulta não autorizada neste espaço.');
  if (version(antes) !== version(depois.data())) throw new ErroServico(409, 'O espaço mudou durante a consulta.');
  return { financeiro: lerDados(antes), caixinhas: catalogo.docs.map(item => item.data()) };
}

async function exportarBackup(db: Firestore, uid: string, espacoId: string, chaveId: string, chave: KeyObject) {
  const espaco = doc(db, 'espacosFinanceiros', espacoId);
  const financeiro = doc(espaco, 'dados', 'main');
  const lerBase = async () => {
    const [controle, dados, concessao] = await Promise.all([
      getDocFromServer(espaco), getDocFromServer(financeiro),
      getDocFromServer(doc(db, 'concessoesAdministrativas', espacoId)),
    ]);
    return { controle: controle.data(), dados: dados.data(), concessao: concessao.data() };
  };
  const inicio = await lerBase();
  const concessao = inicio.controle?.concessaoAdministrativa ?? inicio.concessao;
  try {
    exigirOperacaoAdministrativa({
      uidVerificado: uid, proprietarioUid: inicio.controle?.proprietarioUid, operacao: 'backup',
      concessao, espacoId, espacoDaConcessao: concessao?.espacoId,
      atual: inicio.dados?._sync ? metadata(inicio.dados) : undefined,
    });
  } catch {
    throw new ErroServico(403, 'Backup não autorizado neste espaço.');
  }
  if (!inicio.dados) throw new ErroServico(409, 'Financeiro indisponível.');
  const lerColecoes = async () => {
    const [catalogo, auditoria, administracao, arquivos] = await Promise.all([
      getDocsFromServer(collection(espaco, 'caixinhas')),
      getDocsFromServer(collection(espaco, 'operacoes')),
      getDocsFromServer(collection(espaco, 'administracao')),
      getDocsFromServer(collection(espaco, 'geracoesArquivadas')),
    ]);
    return {
      catalogo: catalogo.docs.map(item => item.data()), auditoria: auditoria.docs.map(item => item.data()),
      auditoriaAdministrativa: administracao.docs.map(item => item.data()),
      geracoesArquivadas: arquivos.docs.map(item => ({ id: item.id, financeiro: item.data() })),
    };
  };
  const colecoes = await lerColecoes();
  const conferencia = await lerColecoes();
  if (version(inicio) !== version(await lerBase()) || version(colecoes) !== version(conferencia)) {
    throw new ErroServico(409, 'O espaço mudou durante a exportação. Repita a consulta.');
  }
  const recibos = colecoes.auditoria.map(({ id, geracao, revisao }) => ({ id, geracao, revisao }));
  return criarBackupFinanceiro({ uid, espacoId, financeiro: inicio.dados, ...colecoes, recibos }, chaveId, chave);
}

export async function iniciarServicoFinanceiroEmulador() {
  if (process.env.FIRESTORE_EMULATOR_HOST !== `${host}:${portaFirestore}`
      || process.env.FIREBASE_AUTH_EMULATOR_HOST !== authEmulador
      || process.env.FIREBASE_EMULATOR_HUB !== hubEmulador) throw new Error('Use o Emulator Suite financeiro dedicado.');
  const resposta = await fetch(`http://${hubEmulador}/emulators`, { redirect: 'error', signal: AbortSignal.timeout(5000) });
  const emuladores = await resposta.json();
  if (!resposta.ok || emuladores.firestore?.host !== host || emuladores.firestore?.port !== portaFirestore
      || emuladores.auth?.host !== host || emuladores.auth?.port !== 9097) throw new Error('Emuladores financeiros indisponíveis.');

  const app = initializeApp({ projectId: projetoFinanceiroEmulador }, `financeiro-${randomBytes(12).toString('hex')}`);
  const db = getFirestore(app);
  // Identidade administrativa exclusiva do emulador. Nunca enviada pela API.
  connectFirestoreEmulator(db, host, portaFirestore, { mockUserToken: 'owner' });
  const chaveBackupId = randomBytes(16).toString('hex');
  const { privateKey: chaveBackup, publicKey: chavePublicaBackup } = generateKeyPairSync('ed25519');
  const chavesConfiaveis = new Map([[chaveBackupId, chavePublicaBackup]]);
  const sessoes = new Map<string, { uid: string; expiraEm: number }>();
  const servidor = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (req.url === '/sessao') {
        if (req.method !== 'POST') throw new ErroServico(405, 'Use POST.');
        const uid = await autenticar(await lerCorpo(req));
        const agora = Date.now();
        for (const [chave, sessao] of sessoes) if (sessao.expiraEm <= agora) sessoes.delete(chave);
        if (sessoes.size >= 1000) throw new ErroServico(503, 'Limite de sessões atingido.');
        const token = randomBytes(32).toString('base64url');
        sessoes.set(token, { uid, expiraEm: agora + duracaoSessaoMs });
        res.end(JSON.stringify({ token, uid }));
        return;
      }
      const caminho = /^\/espacos\/([^/]+)\/(consulta|comandos|backup|administracao)$/.exec(req.url ?? '');
      if (!caminho || !uuidFinanceiro.test(caminho[1])) throw new ErroServico(404, 'Rota inexistente.');
      const metodo = caminho[2] === 'consulta' ? 'GET' : 'POST';
      if (req.method !== metodo) throw new ErroServico(405, `Use ${metodo}.`);
      const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '')?.[1];
      const sessao = token ? sessoes.get(token) : undefined;
      if (!sessao || sessao.expiraEm <= Date.now()) throw new ErroServico(401, 'Sessão inválida.');
      const contaFila = req.headers['x-appcar-conta-fila'];
      if (contaFila !== undefined && contaFila !== sessao.uid) {
        throw new ErroServico(403, 'A sessão pertence a outra conta.', 'conta-divergente');
      }
      if (caminho[2] === 'consulta') {
        res.end(JSON.stringify(await consultarEspaco(db, sessao.uid, caminho[1])));
        return;
      }
      const corpo = await lerCorpo(req, caminho[2] === 'administracao' ? 512_000 : undefined);
      if (caminho[2] === 'administracao') {
        res.end(JSON.stringify(await executarAdministracaoEmulador(db, sessao.uid, caminho[1], corpo, chavesConfiaveis)));
        return;
      }
      if (caminho[2] === 'backup') {
        if (corpo === null || typeof corpo !== 'object' || Array.isArray(corpo) || Object.keys(corpo).length) {
          throw new ErroServico(400, 'A exportação recebe um objeto vazio.');
        }
        res.end(JSON.stringify(await exportarBackup(db, sessao.uid, caminho[1], chaveBackupId, chaveBackup)));
        return;
      }
      res.end(JSON.stringify(await confirmar(db, sessao.uid, caminho[1], corpo)));
    } catch (erro) {
      res.statusCode = erro instanceof ErroServico || erro instanceof ErroAdministrativo ? erro.status : 503;
      res.end(JSON.stringify(erro instanceof ErroServico
        ? { erro: erro.message, codigo: erro.codigo }
        : { erro: erro instanceof ErroAdministrativo ? erro.message : 'Serviço financeiro indisponível.' }));
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      servidor.once('error', reject);
      servidor.listen(0, host, resolve);
    });
  } catch (erro) {
    await terminate(db);
    await deleteApp(app);
    throw erro;
  }
  const endereco = servidor.address();
  if (!endereco || typeof endereco === 'string') throw new Error('Endereço local indisponível.');
  return {
    origem: `http://${host}:${endereco.port}`,
    chaveBackupId,
    chavePublicaBackup,
    async encerrar() {
      sessoes.clear();
      await new Promise<void>((resolve, reject) => servidor.close(erro => erro ? reject(erro) : resolve()));
      await terminate(db);
      await deleteApp(app);
    },
  };
}
