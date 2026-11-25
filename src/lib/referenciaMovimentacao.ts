import type { Lancamento } from './gestao';

type CampoReservaFixa = 'reservaFevereiro' | 'reservaInvestimento' | 'reservaAcidente';
type Selecao =
  | { fonte: 'retirada' | 'reserva-diaria'; indice: number }
  | { fonte: 'rateio'; chave: string }
  | { fonte: 'reserva-fixa'; chave: CampoReservaFixa };

export type ReferenciaMovimentacao = Readonly<{
  versao: 1;
  lancamentoId: string;
  fonte: Selecao['fonte'];
  chaveOriginal: string | null;
  sha256: string;
}>;

function registros(lancamento: Lancamento, fonte: Selecao['fonte']) {
  switch (fonte) {
    case 'retirada':
      return (lancamento.saidas ?? []).map(r => ({ chave: r.id, valores: [r.nome, r.valor, r.origem] }));
    case 'reserva-diaria':
      return (lancamento.reservasDiariasDia ?? []).map(r => ({ chave: r.id, valores: [r.nome, r.valor] }));
    case 'rateio':
      return Object.entries(lancamento.detalheCustosFixosDia ?? {}).map(([chave, valor]) => ({ chave, valores: [valor] }));
    case 'reserva-fixa':
      return (['reservaFevereiro', 'reservaInvestimento', 'reservaAcidente'] as const)
        .filter(chave => lancamento[chave] !== undefined)
        .map(chave => ({ chave, valores: [lancamento[chave]] }));
  }
}

async function sha256(texto: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

function opcoes(historico: readonly Lancamento[], lancamentoId: string, fonte: Selecao['fonte']) {
  if (!lancamentoId?.trim()) return [];
  const pais = historico.filter(h => h.id === lancamentoId);
  if (pais.length !== 1) return [];
  const [pai] = pais;
  if (pai.estornadoPor) return [];
  return registros(pai, fonte).map(({ chave, valores }) => {
    const chaveOriginal = chave?.trim() ? chave : null;
    return { chave: chaveOriginal, assinatura: JSON.stringify([1, pai.id, pai.data, pai.tipo, fonte, chaveOriginal, valores]) };
  });
}

function mesmaIdentidade(a: ReturnType<typeof opcoes>[number], b: ReturnType<typeof opcoes>[number]) {
  return a.chave ? a.chave === b.chave : b.chave === null && a.assinatura === b.assinatura;
}

/** O índice seleciona a linha na versão exibida. A referência emitida independe da posição. */
export async function referenciarMovimentacao(historico: readonly Lancamento[], lancamentoId: string, selecao: Selecao): Promise<ReferenciaMovimentacao | undefined> {
  const itens = opcoes(historico, lancamentoId, selecao.fonte);
  const item = 'indice' in selecao ? itens[selecao.indice] : itens.find(i => i.chave === selecao.chave);
  if (!item || itens.filter(i => mesmaIdentidade(item, i)).length !== 1) return;
  return { versao: 1, lancamentoId, fonte: selecao.fonte, chaveOriginal: item.chave, sha256: await sha256(item.assinatura) };
}

export async function conferirReferenciaMovimentacao(historico: readonly Lancamento[], referencia: ReferenciaMovimentacao) {
  if (referencia.versao !== 1) return false;
  const itens = opcoes(historico, referencia.lancamentoId, referencia.fonte)
    .filter(i => i.chave === referencia.chaveOriginal);
  if (referencia.chaveOriginal !== null && itens.length !== 1) return false;
  const assinaturas = await Promise.all(itens.map(i => sha256(i.assinatura)));
  return assinaturas.filter(hash => hash === referencia.sha256).length === 1;
}
