import { lerDados } from './gestao.ts';
import { metadata, version } from './syncSession.ts';
import { planejarAdocaoCaixinhas } from './integridadeCaixinhas.ts';

type Registro = Record<string, unknown>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const chaveCaixinha = /^diaria:/;
const inteiro = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

function objeto(valor: unknown): Registro {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new Error('Backup inválido.');
  return valor as Registro;
}

function agrupar(valor: unknown) {
  if (!Array.isArray(valor)) throw new Error('Coleção ausente no backup.');
  const itens = new Map<string, Registro>();
  for (const entrada of valor) {
    const registro = objeto(entrada);
    const id = registro.id;
    if (typeof id !== 'string' || !id) throw new Error('Identificador ausente no backup.');
    const anterior = itens.get(id);
    if (anterior && version(anterior) !== version(registro)) throw new Error('Mesmo ID com conteúdo divergente.');
    itens.set(id, registro);
  }
  return [...itens.values()];
}

function horario(valor: unknown) {
  const t = objeto(valor);
  if (typeof t.seconds !== 'number' || !Number.isSafeInteger(t.seconds)
      || !inteiro(t.nanoseconds) || t.nanoseconds >= 1_000_000_000) throw new Error('Horário inválido no backup.');
}

function retrato(valor: unknown) {
  const r = objeto(valor);
  if (Object.keys(r).length !== 3 || typeof r.nome !== 'string' || !r.nome.trim() || r.nome.length > 120
      || typeof r.finalidade !== 'string' || r.finalidade.length > 300
      || (r.estado !== 'ativa' && r.estado !== 'arquivada')) throw new Error('Retrato inválido no backup.');
  return r;
}

function transicaoValida(evento: Registro) {
  const depois = retrato(evento.depois);
  if (evento.acao === 'criar') {
    return evento.antes === null && evento.versaoAnterior === 0 && depois.estado === 'ativa'
      && evento.motivo === null && evento.saldoVerificado === null;
  }
  const antes = retrato(evento.antes);
  if (antes.finalidade !== depois.finalidade || typeof evento.motivo !== 'string'
      || !evento.motivo.trim() || evento.motivo.length > 500) return false;
  switch (evento.acao) {
    case 'renomear': return antes.estado === 'ativa' && depois.estado === 'ativa'
      && antes.nome !== depois.nome && evento.saldoVerificado === null;
    case 'arquivar': return antes.estado === 'ativa' && depois.estado === 'arquivada'
      && antes.nome === depois.nome && evento.saldoVerificado === 0;
    case 'reativar': return antes.estado === 'arquivada' && depois.estado === 'ativa'
      && antes.nome === depois.nome && evento.saldoVerificado === null;
    default: return false;
  }
}

/** Planeja a restauração sem acesso à rede. O escritor autorizado é externo a esta função. */
export function prepararRestauracaoCaixinhas(backup: unknown, uid: string, atual?: unknown) {
  const raiz = objeto(backup);
  if (raiz.schema !== 'appcar-ciclo-v1') {
    const conta = raiz.conta === undefined ? undefined : objeto(raiz.conta);
    const reset = raiz.schema === 'appcar-reset-backup-v1';
    if (raiz.schema !== undefined && !reset) throw new Error('Versão de backup desconhecida.');
    if ((conta && conta.identificador !== uid) || (reset && raiz.uid !== uid)) throw new Error('Backup de outro proprietário.');
    const financeiro = objeto(reset ? raiz.remote : conta ? raiz.dadosEmUso : raiz);
    if (!Array.isArray(financeiro.historico)) throw new Error('Histórico ausente no backup.');
    return { modo: 'consulta-legada' as const, financeiro, adocao: planejarAdocaoCaixinhas(lerDados(financeiro)) };
  }
  if (raiz.uid !== uid) throw new Error('Backup de outro proprietário.');
  const financeiro = objeto(raiz.financeiro);
  if (!financeiro._sync || !Array.isArray(financeiro.historico)) throw new Error('Versão financeira ausente no backup.');
  const sync = metadata(financeiro);
  const catalogo = agrupar(raiz.catalogo);
  const auditoria = agrupar(raiz.auditoria);
  const recibos = agrupar(raiz.recibos);
  if (atual !== undefined) {
    const destino = objeto(atual);
    if (destino.uid !== uid || destino.schema !== raiz.schema
        || version(financeiro) !== version(destino.financeiro)
        || version([...catalogo].sort(ordenarId)) !== version(agrupar(destino.catalogo).sort(ordenarId))) {
      throw new Error('Destino divergente. A restauração não sobrescreve geração, histórico ou estado atuais.');
    }
    auditoria.push(...agrupar(destino.auditoria));
    recibos.push(...agrupar(destino.recibos));
  }
  const eventos = agrupar(auditoria);
  const confirmacoes = agrupar(recibos);
  const ids = new Set(catalogo.map(c => c.id));
  for (const e of eventos) {
    horario(e.confirmadoEm);
    if (typeof e.id !== 'string' || !uuid.test(e.id) || e.autorUid !== uid || !ids.has(e.caixinhaId)
        || !inteiro(e.geracao) || e.geracao > sync.generation || !inteiro(e.revisaoFinanceira)
        || (e.geracao === sync.generation && e.revisaoFinanceira > sync.revision)
        || !transicaoValida(e)) throw new Error('Evento inválido no backup.');
  }
  for (const c of catalogo) {
    horario(c.criadoEm);
    horario(c.atualizadoEm);
    const trilha = eventos.filter(e => e.caixinhaId === c.id).sort((a, b) => Number(a.versaoNova) - Number(b.versaoNova));
    const ultimo = trilha.at(-1);
    if (typeof c.id !== 'string' || !chaveCaixinha.test(c.id) || !uuid.test(c.id.slice(7))
        || c.proprietarioUid !== uid || !ultimo || ultimo.id !== c.operacaoId || c.versao !== trilha.length
        || version(ultimo.depois) !== version({ nome: c.nome, finalidade: c.finalidade, estado: c.estado })
        || trilha.some((e, pos) => e.versaoAnterior !== pos || e.versaoNova !== pos + 1
          || version(e.antes) !== version(pos === 0 ? null : trilha[pos - 1].depois))) throw new Error('Trilha de caixinha incompatível.');
  }
  for (const r of confirmacoes) {
    horario(r.confirmadoEm);
    const chave = typeof r.id === 'string' ? /^g(\d+)-r(\d+)$/.exec(r.id) : null;
    if (!chave || r.autorUid !== uid || typeof r.assinatura !== 'string' || !/^[a-f0-9]{64}$/.test(r.assinatura)
        || Number(chave[1]) > sync.generation || Number(chave[2]) < 1
        || (Number(chave[1]) === sync.generation && Number(chave[2]) > sync.revision)) throw new Error('Recibo inválido no backup.');
  }
  return { modo: 'validado' as const, financeiro, catalogo, auditoria: eventos, recibos: confirmacoes };
}

function ordenarId(a: Registro, b: Registro) {
  return String(a.id).localeCompare(String(b.id));
}
