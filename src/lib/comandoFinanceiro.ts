import { criarTurno, dataBR, datasTrabalhoNoMes, type DadosPersistidos, type Lancamento } from './gestao.ts';
import { arredondarRazaoEmCentavos, centavosParaReais, distribuirCentavos, reaisParaCentavos, somarCentavos } from './centavosFinanceiros.ts';

export const uuidFinanceiro = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const maxCentavos = 100_000_000_000;
const MAX_LINHAS = 40;
type Campos = Record<string, unknown>;

function invalido(campo: string): never { throw new Error(`Campo financeiro inválido: ${campo}.`); }
function objeto(valor: unknown, chaves: string[]): Campos {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(valor))) invalido('objeto');
  const resultado = valor as Campos;
  for (const chave of Object.keys(resultado)) if (!chaves.includes(chave)) invalido(chave);
  return resultado;
}
function texto(valor: unknown, campo: string, limite = 120) {
  if (typeof valor !== 'string' || !valor.trim() || valor.length > limite) invalido(campo);
  return valor.trim();
}
function id(valor: unknown) {
  const chave = texto(valor, 'identificador');
  if (valor !== chave || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(chave)
      || chave === 'constructor' || chave === 'prototype') invalido('identificador');
  return chave;
}
function inteiro(valor: unknown, campo: string, max = maxCentavos) {
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor) || valor < 0 || valor > max) invalido(campo);
  return valor;
}
function dataISO(valor: unknown) {
  const data = texto(valor, 'data', 10);
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(data)) invalido('data');
  const instante = new Date(data + 'T00:00:00Z');
  if (!Number.isFinite(+instante) || instante.toISOString().slice(0, 10) !== data) invalido('data');
  return data;
}
function lista<T>(valor: unknown, decodificar: (linha: unknown) => T) {
  if (!Array.isArray(valor) || valor.length > MAX_LINHAS) invalido('lista');
  return Array.from(valor, decodificar);
}
function idsUnicos<T extends { id: string }>(itens: T[]): T[] {
  if (new Set(itens.map(item => item.id)).size !== itens.length) invalido('IDs duplicados');
  return itens;
}

export function lerComandoFinanceiro(valor: unknown) {
  const raiz = objeto(valor, ['operacaoId', 'geracao', 'revisao', 'alteracao']);
  const operacaoId = texto(raiz.operacaoId, 'operação');
  if (!uuidFinanceiro.test(operacaoId)) invalido('operação');
  const base = { operacaoId, geracao: inteiro(raiz.geracao, 'geração', Number.MAX_SAFE_INTEGER),
    revisao: inteiro(raiz.revisao, 'revisão', Number.MAX_SAFE_INTEGER - 1) };
  const entrada = raiz.alteracao as Campos | undefined;
  switch (entrada?.tipo) {
    case 'turno': {
      const c = objeto(entrada, ['tipo', 'lancamentoId', 'data', 'faturamentoCentavos', 'combustivelCentavos',
        'litrosCentesimos', 'kmTrabalhadoCentesimos', 'kmTotalCentesimos', 'reserva1Centavos', 'reserva2Centavos', 'reservas']);
      const kmTrabalhado = inteiro(c.kmTrabalhadoCentesimos, 'km trabalhado', 10_000_000);
      const kmTotal = inteiro(c.kmTotalCentesimos, 'km total', 10_000_000);
      if (kmTrabalhado > kmTotal) invalido('km trabalhado');
      const form = {
        data: dataISO(c.data),
        faturamento: String(inteiro(c.faturamentoCentavos, 'faturamento') / 100),
        combustivel: String(inteiro(c.combustivelCentavos, 'combustível') / 100),
        litros: String(inteiro(c.litrosCentesimos, 'litros', 1_000_000) / 100),
        kmTrabalhado: String(kmTrabalhado / 100), kmTotal: String(kmTotal / 100),
        reserva1: String(inteiro(c.reserva1Centavos, 'reserva 1') / 100),
        reserva2: String(inteiro(c.reserva2Centavos, 'reserva 2') / 100),
        reservas: idsUnicos(lista(c.reservas, linha => {
          const r = objeto(linha, ['id', 'nome', 'valorCentavos']);
          return { id: id(r.id), nome: texto(r.nome, 'nome da reserva'), valor: String(inteiro(r.valorCentavos, 'reserva') / 100) };
        })),
      };
      return { ...base, tipo: 'turno' as const, alvo: c.lancamentoId === undefined ? null : id(c.lancamentoId), form };
    }
    case 'entrada':
    case 'retirada': {
      const retirada = entrada.tipo === 'retirada';
      const c = objeto(entrada, ['tipo', 'data', 'descricao', 'valorCentavos', ...(retirada ? ['origem'] : [])]);
      const valor = inteiro(c.valorCentavos, 'valor');
      if (!valor) invalido('valor');
      const origem = retirada ? texto(c.origem, 'origem') : 'principal';
      if (retirada && c.origem !== origem) invalido('origem');
      id(origem.startsWith('diaria:') ? origem.slice(7) : origem);
      return { ...base, tipo: retirada ? 'retirada' as const : 'entrada' as const,
        data: dataISO(c.data), descricao: texto(c.descricao, 'descrição', 300), valor: valor / 100, origem };
    }
    case 'excluir': {
      const c = objeto(entrada, ['tipo', 'lancamentoId']);
      return { ...base, tipo: 'excluir' as const, alvo: id(c.lancamentoId) };
    }
    case 'custos-fixos': {
      const c = objeto(entrada, ['tipo', 'itens']);
      const custosFixos = idsUnicos(lista(c.itens, linha => {
        const r = objeto(linha, ['id', 'nome', 'valorMensalCentavos', 'cor']);
        const cor = r.cor === undefined ? '#38bdf8' : texto(r.cor, 'cor', 7);
        if (!/^#[a-f0-9]{6}$/i.test(cor)) invalido('cor');
        const chave = id(r.id);
        if (['principal', 'reserva1', 'reserva2', 'reserva3'].includes(chave)) invalido('identificador de custo');
        return { id: chave, nome: texto(r.nome, 'nome do custo'), valorMensal: inteiro(r.valorMensalCentavos, 'custo mensal') / 100, cor };
      }));
      return { ...base, tipo: 'custos-fixos' as const, custosFixos };
    }
    default: return invalido('tipo');
  }
}

export type ComandoFinanceiroValidado = ReturnType<typeof lerComandoFinanceiro>;

function centavosNaoNegativos(valor: number) {
  const centavos = reaisParaCentavos(valor);
  if (centavos < 0) invalido('valor monetário negativo');
  return centavos;
}

function rateiosDoTurno(dados: DadosPersistidos, data: string, item: Lancamento) {
  const [ano, mes, dia] = data.split('-').map(Number);
  const dias = datasTrabalhoNoMes(ano, mes - 1);
  const posicao = dias.indexOf(dia);
  const temMovimento = [item.faturamentoBruto, item.combustivel, item.kmTotal, item.reservaFevereiro,
    item.reservaInvestimento, ...(item.reservasDiariasDia ?? []).map(r => r.valor)].some(valor => valor > 0);
  const diaComRateio = dados.historico.some(h => h.tipo === 'turno' && h.data === item.data
    && (h.custosFixosDia > 0 || Object.values(h.detalheCustosFixosDia ?? {}).some(valor => valor !== 0)));
  const aplicar = temMovimento && posicao >= 0 && !diaComRateio;
  return Object.fromEntries(dados.custosFixos.map(c => {
    const mensal = centavosNaoNegativos(c.valorMensal);
    return [c.id, aplicar ? centavosParaReais(distribuirCentavos(mensal, dias.length)[posicao]) : 0];
  }));
}

/** Calcula os totais do piloto em centavos e preserva lançamentos que não são o alvo. */
export function montarFinanceiro(dados: DadosPersistidos, comando: ComandoFinanceiroValidado): DadosPersistidos {
  if (comando.tipo === 'custos-fixos') return { ...dados, custosFixos: comando.custosFixos };
  const alvo = 'alvo' in comando && comando.alvo;
  const anteriores = dados.historico.filter(h => h.id === (alvo || comando.operacaoId));
  if (anteriores.length !== (alvo ? 1 : 0)) invalido('identidade do lançamento');
  const [anterior] = anteriores;
  if (comando.tipo === 'excluir') return { ...dados, historico: dados.historico.filter(h => h.id !== comando.alvo) };
  if (comando.tipo === 'turno') {
    if (anterior && anterior.tipo !== 'turno') invalido('tipo histórico');
    if (!anterior && new Set(dados.custosFixos.map(c => id(c.id))).size !== dados.custosFixos.length) {
      invalido('custos fixos confirmados');
    }
    const item = criarTurno(comando.form, [], anterior?.id ?? comando.operacaoId, anterior);
    const nomesOriginais = new Map(anterior?.reservasDiariasDia?.map(r => [r.id, r.nome]));
    item.reservasDiariasDia = item.reservasDiariasDia?.map(r => ({ ...r, nome: nomesOriginais.get(r.id) ?? r.nome }));
    const detalhe = anterior ? item.detalheCustosFixosDia ?? {} : rateiosDoTurno(dados, comando.form.data, item);
    const porCusto = somarCentavos(Object.values(detalhe).map(centavosNaoNegativos));
    const fixos = anterior ? centavosNaoNegativos(anterior.custosFixosDia) : porCusto;
    const acidente = arredondarRazaoEmCentavos(reaisParaCentavos(item.kmTotal) * 38, 1000);
    const despesas = somarCentavos([
      fixos, acidente, ...[item.combustivel, item.reservaFevereiro, item.reservaInvestimento,
        ...(item.reservasDiariasDia ?? []).map(r => r.valor), ...(item.saidas ?? []).map(s => s.valor)].map(centavosNaoNegativos),
    ]);
    item.detalheCustosFixosDia = detalhe;
    item.custosFixosDia = centavosParaReais(fixos);
    item.reservaAcidente = centavosParaReais(acidente);
    item.totalDespesas = centavosParaReais(despesas);
    item.liquido = centavosParaReais(somarCentavos([centavosNaoNegativos(item.faturamentoBruto), -despesas]));
    if (anterior) return { ...dados, historico: dados.historico.map(h => h.id === anterior.id ? item : h) };
    return { ...dados, historico: [item, ...dados.historico],
      reservasDiarias: (item.reservasDiariasDia ?? []).map(r => ({ ...r, valor: 0 })) };
  }
  const { tipo, operacaoId, data, valor, origem, descricao } = comando;
  const entrada = tipo === 'entrada';
  const despesas = !entrada && origem === 'principal' ? valor : 0;
  const item: Lancamento = {
    id: operacaoId, tipo: entrada ? 'avulso_entrada' : 'avulso_saida', data: dataBR(data),
    diaSemana: new Date(data + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'UTC' }),
    descricao, faturamentoBruto: entrada ? valor : 0, combustivel: 0, litros: 0, kmTrabalhado: 0, kmTotal: 0,
    reservaFevereiro: 0, reservaInvestimento: 0, reservaAcidente: 0, custosFixosDia: 0,
    detalheCustosFixosDia: {}, reservasDiariasDia: [],
    saidas: entrada ? [] : [{ id: operacaoId, origem, nome: descricao, valor }],
    totalDespesas: despesas, liquido: entrada ? valor : 0 - despesas,
  };
  return { ...dados, historico: [item, ...dados.historico] };
}
