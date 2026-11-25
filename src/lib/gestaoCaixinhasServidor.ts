import { createHash } from 'node:crypto';
import { uuidFinanceiro } from './comandoFinanceiro.ts';
import { projetarCatalogoCaixinhas, revisarPendenciasCaixinhas, type IdCaixinha } from './catalogoCaixinhas.ts';
import { conferirReferenciaMovimentacao, referenciarMovimentacao, type ReferenciaMovimentacao } from './referenciaMovimentacao.ts';
import { reaisParaCentavos, somarCentavos } from './centavosFinanceiros.ts';
import { lerDados, type DadosPersistidos } from './gestao.ts';
import { metadata, version } from './syncSession.ts';
import { ErroServico, type TransacaoFinanceira } from './executorFinanceiroServidor.ts';
import { obterTodasCaixinhas, type EventoAuditoriaCaixinha } from './gestaoCaixinhasIntegrada.ts';

export const acoesCaixinha = ['caixinha-criar', 'caixinha-editar', 'caixinha-arquivar', 'caixinha-reativar', 'caixinha-excluir', 'caixinha-conciliar'] as const;
type Acao = typeof acoesCaixinha[number];
type Registro = Record<string, unknown>;
type Evidencia = ReturnType<typeof projetarCatalogoCaixinhas>['pendencias'][number]['evidencia'];
type EvidenciaConciliavel = Extract<Evidencia, { fonte: 'retirada' | 'reserva-diaria' }>;
type Vinculo = { id: string; caixinhaId: IdCaixinha; referencia: ReferenciaMovimentacao; evidencia: EvidenciaConciliavel; geracao: number };
type Caixa = { id: IdCaixinha; estado: 'ativa' | 'arquivada' | 'excluida'; nome?: string; finalidade?: string };
export type TransacaoCatalogo = TransacaoFinanceira & { listar(caminho: string, filtro?: {
  campo: string; operador: 'in'; valor: readonly string[];
}): Promise<Registro[]> };

const rotulosAuditoria = {
  'caixinha-criar': 'criar',
  'caixinha-editar': 'renomear',
  'caixinha-arquivar': 'arquivar',
  'caixinha-reativar': 'reativar',
  'caixinha-excluir': 'excluir',
  'caixinha-conciliar': 'conciliar',
} as const;

export function acaoDeCaixinha(valor: unknown): valor is Acao {
  return acoesCaixinha.some(acao => acao === valor);
}

function objeto(valor: unknown, chaves: string[]): Registro {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)
      || Object.keys(valor).some(chave => !chaves.includes(chave))) throw new ErroServico(400, 'Contrato de caixinha inválido.');
  return valor as Registro;
}

function texto(valor: unknown, max: number, min = 1) {
  if (typeof valor !== 'string' || valor.length > max || valor.trim().length < min) throw new ErroServico(400, 'Confira os campos da caixinha.');
  return valor.trim();
}

export function idCaixinhaValido(valor: unknown): valor is IdCaixinha {
  return typeof valor === 'string' && /^(?:diaria|fixo|reserva-fixa):[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(valor);
}

const caminhoCaixa = (espaco: string, id: string) => espaco + '/caixinhas/' + encodeURIComponent(id);
const chaveVinculo = (ref: ReferenciaMovimentacao) => createHash('sha256').update(version(ref)).digest('hex');

async function vinculosDoEspaco(tx: Pick<TransacaoCatalogo, 'listar'>, espaco: string, dados: DadosPersistidos) {
  const registros = await tx.listar(espaco + '/vinculosCaixinhas');
  const vinculos = registros.filter(item => item.geracao === dados._sync?.generation) as unknown as Vinculo[];
  for (const vinculo of vinculos) {
    if (!idCaixinhaValido(vinculo.caixinhaId) || !vinculo.referencia
        || vinculo.id !== chaveVinculo(vinculo.referencia)
        || (vinculo.evidencia?.fonte !== 'retirada' && vinculo.evidencia?.fonte !== 'reserva-diaria')
        || !await conferirReferenciaMovimentacao(dados.historico, vinculo.referencia)) {
      throw new ErroServico(409, 'Um vínculo confirmado perdeu a referência original. Revise o vínculo.');
    }
  }
  return vinculos;
}

async function referenciarPendencias(dados: DadosPersistidos) {
  return Promise.all(revisarPendenciasCaixinhas(dados).map(async pendencia => {
    const e = pendencia.evidencia;
    const referenciaMovimento = (e.fonte === 'retirada' || e.fonte === 'reserva-diaria')
      ? await referenciarMovimentacao(dados.historico, e.lancamentoId, { fonte: e.fonte, indice: e.indice }) : undefined;
    return { ...pendencia, referenciaVerificada: referenciaMovimento ? chaveVinculo(referenciaMovimento) : null, referenciaMovimento };
  }));
}

async function pendenciasDoEspaco(dados: DadosPersistidos, vinculos: Vinculo[]) {
  const confirmados = new Set(vinculos.map(item => item.id));
  const pendencias = await referenciarPendencias(dados);
  return pendencias.filter(item => !item.referenciaVerificada || !confirmados.has(item.referenciaVerificada));
}

function saldo(evidencias: readonly Evidencia[]) {
  return somarCentavos(evidencias.filter(e => e.fonte !== 'configuracao').map(e => {
    const valor = reaisParaCentavos(e.valor);
    if (valor < 0) throw new Error('Valor histórico negativo.');
    return e.fonte === 'retirada' ? -valor : valor;
  }));
}

export function saldoComVinculos(dados: DadosPersistidos, id: IdCaixinha, vinculos: Vinculo[]) {
  const projetada = projetarCatalogoCaixinhas(dados).caixinhas.find(item => item.id === id);
  return saldo([...(projetada?.evidencias ?? []), ...vinculos.filter(item => item.caixinhaId === id).map(item => item.evidencia)]);
}

export async function validarSaldosConciliados(tx: Pick<TransacaoCatalogo, 'listar'>, espaco: string,
  antes: DadosPersistidos, depois: DadosPersistidos, ids: IdCaixinha[]) {
  const vinculos = await vinculosDoEspaco(tx, espaco, depois);
  if (!ids.length) return;
  const pendencias = await pendenciasDoEspaco(depois, vinculos);
  for (const id of ids) {
    if (pendencias.some(p => p.referencia === id || p.candidatos.some(c => c.caixinha.id === id))) {
      throw new ErroServico(422, 'Revise os vínculos pendentes desta caixinha antes de movimentá-la.');
    }
    try {
      const anterior = saldoComVinculos(antes, id, vinculos);
      const posterior = saldoComVinculos(depois, id, vinculos);
      if (posterior < 0 && posterior < anterior) throw new Error('Saldo insuficiente na caixinha.');
    } catch (erro) {
      throw new ErroServico(422, (erro as Error).message);
    }
  }
}

export async function consultarCaixinhas(tx: Pick<TransacaoCatalogo, 'listar'>, espaco: string, dados: DadosPersistidos, proprietario: boolean) {
  const [registros, vinculos, pendencias, eventos] = await Promise.all([
    tx.listar(espaco + '/caixinhas'),
    vinculosDoEspaco(tx, espaco, dados),
    referenciarPendencias(dados),
    proprietario ? tx.listar(espaco + '/operacoes', { campo: 'tipo', operador: 'in', valor: acoesCaixinha }) : [],
  ]);
  const projecao = projetarCatalogoCaixinhas(dados);
  const persistidas = new Map(registros.filter(item => idCaixinhaValido(item.id)).map(item => [item.id as IdCaixinha, item as Caixa]));
  const auditoria = eventos.sort((a, b) => Number(b.revisao) - Number(a.revisao)).flatMap((evento): EventoAuditoriaCaixinha[] => {
    const id = Array.isArray(evento.caixinhas) ? evento.caixinhas[0] : undefined;
    if (!acaoDeCaixinha(evento.tipo) || !idCaixinhaValido(id) || typeof evento.id !== 'string'
        || typeof evento.autorUid !== 'string') return [];
    const antes = evento.antes as Caixa | null;
    const depois = evento.depois as Caixa | undefined;
    const vinculo = evento.vinculo as Vinculo | undefined;
    return [{
      id: evento.id, acao: rotulosAuditoria[evento.tipo], caixinhaId: id, autorUid: evento.autorUid,
      confirmadoEm: (evento.confirmadoEm as { toDate?: () => Date } | undefined)?.toDate?.().toISOString() ?? '',
      motivo: typeof evento.motivo === 'string' ? evento.motivo : undefined,
      nomeAnterior: antes?.nome, nomeNovo: depois?.nome, finalidade: depois?.finalidade,
      vinculo: vinculo && { referenciaSha256: vinculo.id, lancamentoId: vinculo.referencia.lancamentoId,
        fonte: vinculo.evidencia.fonte, valor: vinculo.evidencia.valor },
    }];
  });
  // Incorpora também identidades cujo cadastro financeiro foi arquivado ou removido.
  const reservas = [...(dados.reservasDiarias ?? [])];
  const custos = [...dados.custosFixos];
  for (const caixa of persistidas.values()) {
    const id = caixa.id.slice(caixa.id.indexOf(':') + 1);
    if (caixa.id.startsWith('diaria:') && !reservas.some(r => r.id === id)) reservas.push({ id, nome: caixa.nome ?? id, valor: 0 });
    if (caixa.id.startsWith('fixo:') && !custos.some(c => c.id === id)) custos.push({ id, nome: caixa.nome ?? id, valorMensal: 0 });
  }
  const relatorio = obterTodasCaixinhas(dados, {
    catalogoComplementar: { ...dados, reservasDiarias: reservas, custosFixos: custos },
    vinculos: vinculos.map(({ id, caixinhaId, referencia, evidencia }) => ({
      id, caixinhaId, lancamentoId: referencia.lancamentoId, fonte: evidencia.fonte, valor: evidencia.valor,
      data: 'data' in evidencia ? evidencia.data : undefined, descricao: 'nome' in evidencia ? evidencia.nome : undefined,
      confirmadoEm: '', autorUid: '', motivo: '',
    })),
    referencias: pendencias.map(item => item.referenciaVerificada),
    confirmados: new Set(vinculos.map(item => item.id)),
  });
  const caixinhas = relatorio.caixinhas.flatMap(caixa => {
    const cadastro = persistidas.get(caixa.id);
    if (cadastro?.estado === 'excluida') return [];
    const estado = cadastro?.estado === 'arquivada' ? 'arquivada' as const : 'ativa' as const;
    const saldoAtestado = caixa.saldoAtestado && relatorio.pendencias.length === 0;
    const motivoSaldo = saldoAtestado ? undefined : 'Revise as pendências e os valores históricos antes de confirmar o saldo.';
    const configurada = caixa.familia !== 'diaria' && projecao.caixinhas.some(c => c.id === caixa.id && c.configurada);
    const editavel = cadastro?.estado === 'ativa' || cadastro?.estado === 'arquivada';
    const motivo = !editavel ? 'A identidade precisa ser cadastrada pelo operador do espaço.'
      : motivoSaldo ?? (caixa.saldoCentavos !== 0 ? 'Zere o saldo por uma movimentação válida.'
        : configurada ? 'Desative a configuração de rateio ou reserva associada.' : undefined);
    const motivoExclusao = motivo ?? (caixa.movimentos.length ? 'Use Desativar para preservar as movimentações.' : undefined);
    return [{ ...caixa, estado, editavel, nome: cadastro?.nome ?? caixa.nome, finalidade: cadastro?.finalidade ?? '',
      auditoria: auditoria.filter(evento => evento.caixinhaId === caixa.id), saldoAtestado, motivoSaldoNaoAtestado: motivoSaldo,
      podeArquivar: !motivo, motivoBloqueioArquivamento: motivo, podeExcluir: !motivoExclusao, motivoBloqueioExclusao: motivoExclusao }];
  });
  const ativas = caixinhas.filter(caixa => caixa.estado === 'ativa');
  return { relatorio: { ...relatorio, caixinhas, totalAtivas: ativas.length, totalArquivadas: caixinhas.length - ativas.length,
    totalSaldoCentavos: somarCentavos(ativas.map(caixa => caixa.saldoCentavos)) }, auditoria };
}

export async function confirmarCaixinha(tx: TransacaoCatalogo, uid: string, espaco: string, financeiro: string, entrada: unknown) {
  const raiz = objeto(entrada, ['operacaoId', 'geracao', 'revisao', 'alteracao']);
  const op = objeto(raiz.alteracao, ['tipo', 'caixinhaId', 'nome', 'finalidade', 'motivo', 'referencia']);
  const operacaoId = texto(raiz.operacaoId, 36);
  if (!uuidFinanceiro.test(operacaoId) || !acaoDeCaixinha(op.tipo)
      || !Number.isSafeInteger(raiz.revisao) || Number(raiz.revisao) < 0
      || Number(raiz.revisao) >= Number.MAX_SAFE_INTEGER || !Number.isSafeInteger(raiz.geracao) || Number(raiz.geracao) < 0) {
    throw new ErroServico(400, 'Operação de caixinha inválida.');
  }
  const controle = await tx.get(espaco);
  if (controle?.proprietarioUid !== uid || controle.comandosFinanceiros !== true
      || !Array.isArray(controle.operacoesFinanceiras) || !controle.operacoesFinanceiras.includes(op.tipo)) {
    throw new ErroServico(403, 'Operação de caixinha não autorizada.');
  }
  const documento = await tx.get(financeiro);
  const sync = metadata(documento);
  if (!documento?._sync || raiz.geracao !== sync.generation) throw new ErroServico(409, 'Geração divergente.', 'geracao-divergente');
  const evento = espaco + '/operacoes/' + operacaoId;
  const assinatura = createHash('sha256').update(version([raiz.geracao, op])).digest('hex');
  const confirmado = await tx.get(evento);
  if (confirmado) {
    if (confirmado.assinatura !== assinatura || confirmado.autorUid !== uid) throw new ErroServico(409, 'UUID já utilizado.');
    return { operacaoId, revisao: confirmado.revisao as number, repetida: true };
  }
  if (raiz.revisao !== sync.revision || await tx.get(espaco + '/administracao/' + operacaoId)) {
    throw new ErroServico(409, 'A base mudou. Atualize os dados e revise a operação.');
  }
  const dados = lerDados(documento);
  const id = op.tipo === 'caixinha-criar' ? 'diaria:' + operacaoId : op.caixinhaId;
  if (!idCaixinhaValido(id)) throw new ErroServico(400, 'Identidade inválida.');
  const caminho = caminhoCaixa(espaco, id);
  const atual = await tx.get(caminho) as Caixa | undefined;
  const projetada = projetarCatalogoCaixinhas(dados).caixinhas.find(item => item.id === id);
  if (op.tipo !== 'caixinha-criar' && (!atual || atual.id !== id || atual.estado === 'excluida')) {
    throw new ErroServico(422, 'Caixinha indisponível ou sem identidade cadastrada.');
  }
  let depois: Caixa = atual ?? { id, estado: 'ativa' };
  let reservas = dados.reservasDiarias ?? [];
  let vinculo: Vinculo | undefined;
  const motivo = texto(op.motivo, 300);
  const idDiaria = id.startsWith('diaria:') ? id.slice(7) : null;
  switch (op.tipo) {
    case 'caixinha-criar':
    case 'caixinha-editar': {
      if (op.tipo === 'caixinha-criar' && (atual || projetada)) throw new ErroServico(409, 'Identidade já utilizada.');
      const nome = texto(op.nome, 120), finalidade = texto(op.finalidade, 300, 0);
      depois = { ...depois, nome, finalidade };
      if (idDiaria && depois.estado === 'ativa') {
        reservas = reservas.some(r => r.id === idDiaria)
          ? reservas.map(r => r.id === idDiaria ? { ...r, nome } : r)
          : [...reservas, { id: idDiaria, nome, valor: 0 }];
      }
      break;
    }
    case 'caixinha-reativar':
      if (depois.estado !== 'arquivada') throw new ErroServico(422, 'A caixinha já está ativa.');
      depois = { ...depois, estado: 'ativa' };
      if (idDiaria && !reservas.some(r => r.id === idDiaria)) reservas = [...reservas, { id: idDiaria, nome: depois.nome ?? id, valor: 0 }];
      break;
    case 'caixinha-arquivar':
    case 'caixinha-excluir': {
      const vinculos = await vinculosDoEspaco(tx, espaco, dados);
      if ((await pendenciasDoEspaco(dados, vinculos)).length) throw new ErroServico(422, 'Revise os vínculos pendentes antes de desativar ou excluir.');
      let saldoAtual: number;
      try { saldoAtual = saldoComVinculos(dados, id, vinculos); }
      catch { throw new ErroServico(422, 'O saldo está em revisão.'); }
      if (saldoAtual !== 0) throw new ErroServico(422, 'Zere o saldo com uma movimentação válida antes de arquivar ou excluir.');
      if (!idDiaria && projetada?.configurada) throw new ErroServico(422, 'A caixinha ainda recebe rateios ou reservas automáticas. Desative a configuração associada antes de prosseguir.');
      const historico = Boolean(projetada?.evidencias.some(e => e.fonte !== 'configuracao') || vinculos.some(v => v.caixinhaId === id));
      if (op.tipo === 'caixinha-excluir' && historico) throw new ErroServico(422, 'A caixinha tem histórico. Use Desativar para preservar os vínculos.');
      if (op.tipo === 'caixinha-arquivar' && depois.estado === 'arquivada') throw new ErroServico(422, 'A caixinha já está arquivada.');
      depois = { ...depois, estado: op.tipo === 'caixinha-excluir' ? 'excluida' : 'arquivada' };
      if (idDiaria) reservas = reservas.filter(r => r.id !== idDiaria);
      break;
    }
    case 'caixinha-conciliar': {
      if (depois.estado !== 'ativa') throw new ErroServico(422, 'Reative a caixinha antes de vincular a movimentação.');
      const vinculos = await vinculosDoEspaco(tx, espaco, dados);
      const pendencia = (await pendenciasDoEspaco(dados, vinculos)).find(item => item.referenciaVerificada === op.referencia);
      if (!pendencia?.referenciaMovimento || !pendencia.referenciaVerificada) throw new ErroServico(409, 'A referência mudou ou já foi vinculada.');
      const { evidencia } = pendencia;
      if (evidencia.fonte !== 'retirada' && evidencia.fonte !== 'reserva-diaria') throw new ErroServico(422, 'Movimentação sem vínculo verificável.');
      if (evidencia.fonte === 'reserva-diaria' && !idDiaria) throw new ErroServico(422, 'Escolha uma reserva diária para esta contribuição.');
      vinculo = { id: pendencia.referenciaVerificada, referencia: pendencia.referenciaMovimento,
        evidencia: { ...evidencia, nome: evidencia.nome ?? '', ...(evidencia.fonte === 'retirada' &&
          { retiradaId: evidencia.retiradaId ?? '', origem: evidencia.origem ?? '' }) }, caixinhaId: id, geracao: sync.generation };
      try {
        const anterior = saldoComVinculos(dados, id, vinculos);
        const posterior = saldoComVinculos(dados, id, [...vinculos, vinculo]);
        if (posterior < 0 && posterior < anterior) throw new Error();
      } catch { throw new ErroServico(422, 'O vínculo produziria saldo insuficiente ou depende de um valor inválido.'); }
      break;
    }
  }
  const revisao = sync.revision + 1;
  tx.set(financeiro, { _sync: { ...sync, revision: revisao }, ...(reservas !== dados.reservasDiarias && { reservasDiarias: reservas }) });
  if (op.tipo !== 'caixinha-conciliar') tx.set(caminho, depois);
  if (vinculo) tx.set(espaco + '/vinculosCaixinhas/' + sync.generation + '-' + vinculo.id, vinculo);
  tx.set(evento, { id: operacaoId, tipo: op.tipo, assinatura, autorUid: uid, geracao: sync.generation,
    revisaoAnterior: sync.revision, revisao, caixinhas: [id], confirmadoEm: tx.agora(), motivo,
    antes: atual ?? null, depois, ...(vinculo && { vinculo, lancamentoId: vinculo.referencia.lancamentoId }) });
  return { operacaoId, revisao, repetida: false };
}
