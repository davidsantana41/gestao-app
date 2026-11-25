import { createCipheriv, createDecipheriv, createHash, randomBytes, sign, verify, type KeyObject } from 'node:crypto';
import { uuidFinanceiro } from './comandoFinanceiro.ts';
import { metadata, version } from './syncSession.ts';

type Registro = Record<string, unknown>;
type Conteudo = {
  uid: string;
  espacoId: string;
  financeiro: Registro;
  catalogo: Registro[];
  auditoria: Registro[];
  recibos: Registro[];
  auditoriaAdministrativa?: Registro[];
  geracoesArquivadas?: Registro[];
};

const schema = 'appcar-financeiro-backup-v1';
const schemaProtegido = 'appcar-financeiro-criptografado-v1';
const camposBackup = ['uid', 'espacoId', 'financeiro', 'catalogo', 'auditoria', 'recibos', 'auditoriaAdministrativa', 'geracoesArquivadas'];
const camposFinanceiros = ['_sync', 'historico', 'custosFixos', 'reservasDiarias', 'nomeReserva1',
  'nomeReserva2', 'nomeReserva3', 'lembrete', 'modoEscuro'];
const sigilo = /^(?:authorization|bearer|token|(?:id|access|refresh|session)Token|senha|password|credencia(?:l|is)|credentials?|private[_-]?key|secret|segredo|api[_-]?key|sessionCookie|cookie)$/i;
const inteiro = (valor: unknown): valor is number => Number.isSafeInteger(valor) && Number(valor) >= 0;

function objeto(valor: unknown): Registro {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new Error('Formato de backup inválido.');
  return valor as Registro;
}

function jsonProtegido<T>(valor: T): T {
  return JSON.parse(JSON.stringify(valor, (chave, item) => {
    if (sigilo.test(chave)) throw new Error('Campo de credencial proibido no backup.');
    if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('Número inválido no backup.');
    return item;
  }));
}

function indexar(valor: unknown) {
  if (!Array.isArray(valor)) throw new Error('Coleção de backup ausente.');
  const registros = new Map<string, Registro>();
  for (const item of valor) {
    const registro = objeto(item);
    if (typeof registro.id !== 'string' || !registro.id || registros.has(registro.id)) throw new Error('ID de backup inválido ou duplicado.');
    registros.set(registro.id, registro);
  }
  return registros;
}

function validarConteudo(valor: unknown, uid: string, espacoId: string) {
  const dados = objeto(valor);
  if (!uid || !uuidFinanceiro.test(espacoId) || dados.uid !== uid || dados.espacoId !== espacoId
      || Object.keys(dados).some(campo => !camposBackup.includes(campo))) throw new Error('Conta ou espaço incompatível com o backup.');
  const sync = conferirFinanceiro(dados.financeiro);
  for (const chave of indexar(dados.catalogo).values()) {
    if (!/^(?:diaria|fixo|reserva-fixa):.+$/.test(String(chave.id))
      || (chave.estado !== 'ativa' && chave.estado !== 'arquivada')) throw new Error('Caixinha inválida no backup.');
  }
  const auditoria = indexar(dados.auditoria);
  const recibos = indexar(dados.recibos);
  const revisoes = new Set<string>();
  if (auditoria.size !== recibos.size) throw new Error('Auditoria e recibos incompatíveis.');
  for (const [id, evento] of auditoria) {
    const recibo = recibos.get(id);
    const chave = `${evento.geracao}:${evento.revisao}`;
    const horario = objeto(evento.confirmadoEm);
    if (!uuidFinanceiro.test(id) || evento.autorUid !== uid || evento.espacoId !== espacoId
      || !inteiro(evento.geracao) || evento.geracao > sync.generation
      || !inteiro(evento.revisao) || evento.revisao < 1 || evento.revisaoAnterior !== evento.revisao - 1
      || (evento.geracao === sync.generation && evento.revisao > sync.revision) || revisoes.has(chave)
      || typeof evento.assinatura !== 'string' || !/^[a-f0-9]{64}$/.test(evento.assinatura)
      || !Number.isSafeInteger(horario.seconds) || !inteiro(horario.nanoseconds) || horario.nanoseconds >= 1_000_000_000
      || recibo?.revisao !== evento.revisao || recibo.geracao !== evento.geracao) {
      throw new Error('Proveniência financeira ou recibo incompatível no backup.');
    }
    revisoes.add(chave);
  }
  for (const [id, evento] of indexar(dados.auditoriaAdministrativa ?? []).entries()) {
    const resultado = objeto(evento.resultado);
    const horario = objeto(evento.confirmadoEm);
    if (!uuidFinanceiro.test(id) || evento.autorUid !== uid || evento.espacoId !== espacoId
        || auditoria.has(id) || resultado.operacaoId !== id || evento.tipo !== resultado.tipo
        || !['provisionar', 'restaurar', 'reiniciar', 'manter'].includes(String(evento.tipo))
        || !inteiro(resultado.geracao) || resultado.geracao > sync.generation || !inteiro(resultado.revisao)
        || (resultado.geracao === sync.generation && resultado.revisao > sync.revision)
        || typeof evento.assinatura !== 'string' || !/^[a-f0-9]{64}$/.test(evento.assinatura)
        || !Number.isSafeInteger(horario.seconds) || !inteiro(horario.nanoseconds) || horario.nanoseconds >= 1_000_000_000) {
      throw new Error('Auditoria administrativa inválida no backup.');
    }
  }
  for (const [id, arquivo] of indexar(dados.geracoesArquivadas ?? []).entries()) {
    const anterior = conferirFinanceiro(arquivo.financeiro);
    if (id !== String(anterior.generation) || anterior.generation >= sync.generation) {
      throw new Error('Geração arquivada incompatível com o backup.');
    }
  }
  return dados as Conteudo;
}

function conferirFinanceiro(valor: unknown) {
  const financeiro = objeto(valor);
  if (!financeiro._sync || !Array.isArray(financeiro.historico)
      || Object.keys(financeiro).some(campo => !camposFinanceiros.includes(campo))) throw new Error('Financeiro inválido no backup.');
  return metadata(financeiro);
}

/** Exportação do snapshot previamente autorizado e capturado pelo servidor. */
export function criarBackupFinanceiro(conteudo: Conteudo, chaveId: string, privada: KeyObject) {
  if (!chaveId || privada.type !== 'private' || privada.asymmetricKeyType !== 'ed25519') throw new Error('Chave de backup inválida.');
  const dados = validarConteudo(jsonProtegido(conteudo), conteudo.uid, conteudo.espacoId);
  const manifesto = { schema, chaveId, capturadoEm: new Date().toISOString(),
    sha256: createHash('sha256').update(version(dados)).digest('hex') };
  return { manifesto, dados, assinatura: sign(null, Buffer.from(version(manifesto)), privada).toString('base64url') };
}

/** Verifica a procedência antes de entregar uma prévia. Não escreve no destino. */
export function verificarBackupFinanceiro(arquivo: unknown, esperado: {
  uid: string; espacoId: string; chavesConfiaveis: ReadonlyMap<string, KeyObject>;
}) {
  const raiz = objeto(jsonProtegido(arquivo));
  const manifesto = objeto(raiz.manifesto);
  if (Object.keys(raiz).length !== 3 || Object.keys(manifesto).length !== 4 || manifesto.schema !== schema
      || typeof manifesto.chaveId !== 'string' || typeof manifesto.capturadoEm !== 'string'
      || !Number.isFinite(Date.parse(manifesto.capturadoEm))) throw new Error('Versão ou manifesto de backup incompatível.');
  const publica = esperado.chavesConfiaveis.get(manifesto.chaveId);
  if (publica?.type !== 'public' || publica.asymmetricKeyType !== 'ed25519' || typeof raiz.assinatura !== 'string'
      || !/^[A-Za-z0-9_-]{86}$/.test(raiz.assinatura)
      || !verify(null, Buffer.from(version(manifesto)), publica, Buffer.from(raiz.assinatura, 'base64url'))) {
    throw new Error('Procedência do backup não verificada.');
  }
  if (manifesto.sha256 !== createHash('sha256').update(version(raiz.dados)).digest('hex')) {
    throw new Error('Integridade do backup não verificada.');
  }
  return validarConteudo(raiz.dados, esperado.uid, esperado.espacoId);
}

export function protegerBackupFinanceiro(arquivoAssinado: ReturnType<typeof criarBackupFinanceiro>, chave: Uint8Array) {
  if (chave.byteLength !== 32) throw new Error('Chave de recuperação inválida.');
  const iv = randomBytes(12);
  const cifra = createCipheriv('aes-256-gcm', chave, iv);
  cifra.setAAD(Buffer.from(schemaProtegido));
  const conteudo = Buffer.concat([cifra.update(JSON.stringify(jsonProtegido(arquivoAssinado))), cifra.final()]);
  return { schema: schemaProtegido, iv: iv.toString('base64url'), tag: cifra.getAuthTag().toString('base64url'),
    conteudo: conteudo.toString('base64url') };
}

export function abrirBackupFinanceiroProtegido(arquivo: unknown, chave: Uint8Array, esperado: Parameters<typeof verificarBackupFinanceiro>[1]) {
  const copia = objeto(arquivo);
  if (chave.byteLength !== 32 || Object.keys(copia).length !== 4 || copia.schema !== schemaProtegido
      || typeof copia.iv !== 'string' || !/^[A-Za-z0-9_-]{16}$/.test(copia.iv)
      || typeof copia.tag !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(copia.tag)
      || typeof copia.conteudo !== 'string' || !/^[A-Za-z0-9_-]+$/.test(copia.conteudo)) {
    throw new Error('Versão ou envelope criptografado inválido.');
  }
  let assinado: unknown;
  try {
    const cifra = createDecipheriv('aes-256-gcm', chave, Buffer.from(copia.iv, 'base64url'));
    cifra.setAAD(Buffer.from(schemaProtegido));
    cifra.setAuthTag(Buffer.from(copia.tag, 'base64url'));
    assinado = JSON.parse(Buffer.concat([cifra.update(Buffer.from(copia.conteudo, 'base64url')), cifra.final()]).toString('utf8'));
  } catch {
    throw new Error('Integridade da cópia ou chave de recuperação incompatível.');
  }
  return { arquivoAssinado: assinado, dados: verificarBackupFinanceiro(assinado, esperado) };
}
