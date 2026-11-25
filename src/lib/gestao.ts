import type { SyncMetadata } from './syncSession';

export interface SaidaItem {
  id: string;
  nome: string;
  valor: number;
  origem: string; // 'principal', id da caixinha, 'reserva1', 'reserva2' ou 'reserva3'
}

export interface CustoFixoItem {
  id: string;
  nome: string;
  valorMensal: number;
  cor?: string;
}

export interface ReservaDiariaItem {
  id: string;
  nome: string;
  valor: number;
}


export interface DadosPersistidos {
  _sync?: SyncMetadata;
  reservasDiarias?: ReservaDiariaItem[];
  custosFixos: CustoFixoItem[];
  nomeReserva1: string;
  nomeReserva2: string;
  nomeReserva3: string;
  lembrete: string;
  historico: Lancamento[];
  modoEscuro: boolean;
}

export const moeda = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const decimal = (valor: number, casas = 2) => valor.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
export const centavos = (valor: number) => Math.round((valor + Number.EPSILON) * 100) / 100;

export function numero(texto: string): number {
  const valor = texto.trim().replace(/\s/g, '');
  if (!valor) return 0;
  const normalizado = valor.includes(',') ? valor.replace(/\./g, '').replace(',', '.') : valor;
  return /^\d+(\.\d*)?$/.test(normalizado) && Number.isFinite(Number(normalizado)) ? Number(normalizado) : 0;
}

export function dataLocal(data = new Date()) {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
}
export const dataBR = (iso: string) => iso.split('-').reverse().join('/');
export const dataISO = (br: string) => br.split('/').reverse().join('-');

export function dadosPadrao(): DadosPersistidos {
  return {
    custosFixos: [
      { id: '1', nome: 'Prestação do Carro', valorMensal: 2876.40, cor: '#3b82f6' },
      { id: '2', nome: 'IPVA', valorMensal: 111, cor: '#10b981' },
      { id: '3', nome: 'Seguro', valorMensal: 236.85, cor: '#8b5cf6' },
      { id: '4', nome: 'Troca de Óleo', valorMensal: 300, cor: '#f59e0b' },
      { id: '5', nome: 'violão', valorMensal: 200, cor: '#ec4899' },
    ],
    reservasDiarias: [], historico: [], lembrete: '', modoEscuro: true,
    nomeReserva1: 'Reserva Para Fevereiro', nomeReserva2: 'Reserva Para Investimento', nomeReserva3: 'Reserva de Acidente',
  };
}

// Mantém todos os registros e campos legados; não recalcula nem migra o histórico ao ler.
export function lerDados(valor: unknown): DadosPersistidos {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new Error('Formato de dados inválido.');
  const dados = valor as Partial<DadosPersistidos>;
  if (dados.historico !== undefined && !Array.isArray(dados.historico)) throw new Error('Histórico inválido.');
  if (dados.custosFixos !== undefined && !Array.isArray(dados.custosFixos)) throw new Error('Custos fixos inválidos.');
  return { ...dadosPadrao(), ...dados };
}

export interface ReservaFormulario { id: string; nome: string; valor: string }
export interface TurnoFormulario {
  data: string; faturamento: string; combustivel: string; litros: string; kmTrabalhado: string; kmTotal: string;
  reserva1: string; reserva2: string; reservas: ReservaFormulario[];
}
export function novoFormulario(reservas: ReservaDiariaItem[] = [], original?: Lancamento): TurnoFormulario {
  const texto = (valor: number | undefined) => valor ? String(valor).replace('.', ',') : '';
  return {
    data: original ? dataISO(original.data) : dataLocal(),
    faturamento: texto(original?.faturamentoBruto), combustivel: texto(original?.combustivel), litros: texto(original?.litros),
    kmTrabalhado: texto(original?.kmTrabalhado), kmTotal: texto(original?.kmTotal),
    reserva1: texto(original?.reservaFevereiro), reserva2: texto(original?.reservaInvestimento),
    reservas: (original ? original.reservasDiariasDia ?? [] : reservas).map(r => ({ ...r, valor: original ? texto(r.valor) : '' })),
  };
}

export function calcularTurno(form: TurnoFormulario, custos: CustoFixoItem[], original?: Lancamento) {
  const [ano, mes] = form.data.split('-').map(Number);
  const dias = diasTrabalhoNoMes(ano, mes - 1);
  const temMovimento = Boolean(original) || [form.faturamento, form.combustivel, form.kmTotal, form.reserva1, form.reserva2, ...form.reservas.map(r => r.valor)].some(v => numero(v) > 0);
  const detalheFixos = original ? { ...original.detalheCustosFixosDia } : Object.fromEntries(custos.map(c => [c.id, temMovimento ? c.valorMensal / dias : 0]));
  const fixos = original?.custosFixosDia ?? Object.values(detalheFixos).reduce((s, v) => s + v, 0);
  const reservas = form.reservas.map(r => ({ id: r.id, nome: r.nome.trim(), valor: centavos(numero(r.valor)) }));
  const totalReservas = centavos(reservas.reduce((s, r) => s + r.valor, 0));
  const combustivel = centavos(numero(form.combustivel));
  const litros = numero(form.litros);
  const km = numero(form.kmTrabalhado);
  const acidente = centavos(numero(form.kmTotal) * 0.038);
  const reserva1 = centavos(numero(form.reserva1)), reserva2 = centavos(numero(form.reserva2));
  const saidas = original?.saidas ?? [];
  const despesas = centavos(combustivel + fixos + totalReservas + acidente + reserva1 + reserva2 + saidas.reduce((s, r) => s + r.valor, 0));
  return { dias, detalheFixos, fixos, reservas, totalReservas, combustivel, litros, km, acidente, reserva1, reserva2, saidas,
    precoLitro: litros > 0 ? combustivel / litros : 0,
    consumo: litros > 0 ? km / litros : 0,
    despesas, liquido: centavos(numero(form.faturamento) - despesas) };
}

export function criarTurno(form: TurnoFormulario, custos: CustoFixoItem[], id: string, original?: Lancamento): Lancamento {
  const c = calcularTurno(form, custos, original);
  return { ...original, id, data: dataBR(form.data), diaSemana: new Date(`${form.data}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long' }), tipo: 'turno',
    faturamentoBruto: centavos(numero(form.faturamento)), combustivel: c.combustivel, litros: c.litros, kmTrabalhado: c.km, kmTotal: numero(form.kmTotal),
    reservaFevereiro: c.reserva1, reservaInvestimento: c.reserva2, reservaAcidente: c.acidente,
    custosFixosDia: c.fixos, detalheCustosFixosDia: c.detalheFixos, reservasDiariasDia: c.reservas,
    saidas: c.saidas, totalDespesas: c.despesas, liquido: c.liquido };
}

export function resultado(item: Lancamento) {
  // Retiradas de dinheiro já separado não descontam o saldo principal outra vez.
  const despesas = item.tipo === 'avulso_saida' ? (item.saidas ?? []).reduce((s, r) => s + (r.origem === 'principal' ? r.valor : 0), 0) : item.totalDespesas;
  return { despesas, liquido: item.tipo === 'avulso_saida' ? -despesas : item.liquido };
}

export function resumir(historico: Lancamento[]) {
  const dias = new Set<string>();
  let faturamento = 0, despesas = 0, liquido = 0, combustivel = 0, km = 0, litros = 0;
  const caixinhas: Record<string, number> = {};
  const reservas: Record<string, { nome: string; valor: number }> = {};
  for (const h of historico) {
    const r = resultado(h);
    faturamento += h.faturamentoBruto; despesas += r.despesas; liquido += r.liquido;
    combustivel += h.combustivel; km += h.kmTrabalhado || 0; litros += h.litros || 0;
    if (h.tipo === 'turno') dias.add(h.data);
    for (const [id, valor] of Object.entries(h.detalheCustosFixosDia ?? {})) caixinhas[id] = (caixinhas[id] ?? 0) + valor;
    for (const reserva of h.reservasDiariasDia ?? []) {
      const id = reserva.id || `nome:${reserva.nome}`;
      reservas[id] ??= { nome: reserva.nome || 'Reserva antiga sem nome', valor: 0 };
      reservas[id].valor += reserva.valor;
    }
    for (const [id, valor] of [['reserva1', h.reservaFevereiro], ['reserva2', h.reservaInvestimento], ['reserva3', h.reservaAcidente]] as const) caixinhas[id] = (caixinhas[id] ?? 0) + (valor || 0);
    for (const saida of h.saidas ?? []) {
      if (saida.origem === 'principal') continue;
      if (saida.origem.startsWith('diaria:')) {
        const id = saida.origem.slice(7);
        reservas[id] ??= { nome: saida.nome, valor: 0 };
        reservas[id].valor -= saida.valor;
      } else caixinhas[saida.origem] = (caixinhas[saida.origem] ?? 0) - saida.valor;
    }
  }
  return { faturamento, despesas, liquido, combustivel, km, litros, dias: dias.size, caixinhas, reservas };
}

export interface Lancamento {
  id: string;
  data: string; // Formato DD/MM/AAAA
  diaSemana: string;
  descricao?: string;
  tipo: 'turno' | 'avulso_saida' | 'avulso_entrada';
  faturamentoBruto: number;
  combustivel: number;
  litros: number;
  kmTrabalhado: number;
  kmTotal: number;
  reservaFevereiro: number;
  reservaInvestimento: number;
  reservaAcidente: number;
  custosFixosDia: number; 
  detalheCustosFixosDia?: { [id: string]: number };
  reservasDiariasDia?: ReservaDiariaItem[];
  saidas: SaidaItem[];
  totalDespesas: number;
  liquido: number;
}


function dataPascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}

export function diasTrabalhoNoMes(ano: number, mes: number): number {
  return Math.max(datasTrabalhoNoMes(ano, mes).length, 1);
}

export function datasTrabalhoNoMes(ano: number, mes: number): number[] {
  const feriados = new Set([
    '01-01', '04-21', '05-01', '09-07', '10-12',
    '11-02', '11-15', '11-20', '12-25',
  ]);
  const sextaSanta = dataPascoa(ano);
  sextaSanta.setDate(sextaSanta.getDate() - 2);
  const totalDias = new Date(ano, mes + 1, 0).getDate();
  const dias: number[] = [];
  for (let dia = 1; dia <= totalDias; dia++) {
    const data = new Date(ano, mes, dia);
    if (data.getDay() === 0) continue;
    const chave = `${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    const ehSextaSanta = data.getMonth() === sextaSanta.getMonth() && data.getDate() === sextaSanta.getDate();
    if (!feriados.has(chave) && !ehSextaSanta) dias.push(dia);
  }
  return dias;
}

