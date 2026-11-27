import { createHash } from 'node:crypto';
import { lerComandoFinanceiro, montarFinanceiro, uuidFinanceiro } from './comandoFinanceiro.ts';
import { lerDados, type DadosPersistidos } from './gestao.ts';
import { caixinhasAfetadas, saldoVerificavelEmCentavos } from './integridadeCaixinhas.ts';
import { metadata, version } from './syncSession.ts';
import { podeExecutarComandoFinanceiro } from './identidadeFinanceiraServidor.ts';
import { projetarCatalogoCaixinhas, type IdCaixinha } from './catalogoCaixinhas.ts';

export type TransacaoFinanceira = {
  get(caminho: string): Promise<Record<string, unknown> | undefined>;
  set(caminho: string, dados: Record<string, unknown>): void;
  agora(): unknown;
};

export class ErroServico extends Error {
  readonly status: number;
  readonly codigo?: string;

  constructor(status: number, mensagem: string, codigo?: string) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
  }
}

export async function confirmarComando(tx: TransacaoFinanceira, uid: string, espacoId: string, financeiro: string,
  entrada: unknown, opcoes?: { atualizarCampos: boolean; criarCusto: boolean; criarReservaDiaria?: boolean;
    validarSaldos?: (antes: DadosPersistidos, depois: DadosPersistidos, ids: IdCaixinha[]) => Promise<void> }) {
  let comando;
  try {
    comando = lerComandoFinanceiro(entrada);
  } catch (erro) {
    throw new ErroServico(400, (erro as Error).message);
  }
  const { revisao, ...intencao } = comando;
  const assinatura = createHash('sha256').update(version(intencao)).digest('hex');
  const espaco = 'espacosFinanceiros/' + espacoId;
  const evento = espaco + '/operacoes/' + comando.operacaoId;

  const controle = await tx.get(espaco);
  if (!podeExecutarComandoFinanceiro(uid, controle, comando.tipo)) {
    throw new ErroServico(403, 'Operação não autorizada neste espaço.');
  }
  const documento = await tx.get(financeiro);
  const sync = metadata(documento);
  if (!documento?._sync || comando.geracao !== sync.generation) {
    throw new ErroServico(409, 'Geração financeira divergente.', 'geracao-divergente');
  }
  const confirmado = await tx.get(evento);
  if (confirmado) {
    if (confirmado.assinatura !== assinatura || confirmado.autorUid !== uid || confirmado.geracao !== sync.generation) {
      throw new ErroServico(409, 'ID de operação já utilizado.');
    }
    return { operacaoId: comando.operacaoId, revisao: confirmado.revisao as number, repetida: true };
  }
  if (await tx.get(espaco + '/administracao/' + comando.operacaoId)) {
    throw new ErroServico(409, 'ID de operação já utilizado.');
  }
  if (revisao !== sync.revision) throw new ErroServico(409, 'Revisão financeira divergente.');
  const antes = lerDados(documento);
  if (opcoes?.atualizarCampos && comando.tipo === 'excluir') {
    throw new ErroServico(422, 'Use Estornar para preservar o lançamento e seu histórico.');
  }
  if (opcoes?.atualizarCampos && comando.tipo === 'turno' && !comando.alvo) {
    const reservas = new Set(antes.reservasDiarias?.map(r => r.id));
    const identidadesConhecidas = new Set(projetarCatalogoCaixinhas(antes).caixinhas.map(item => item.id));
    for (const reserva of comando.form.reservas) {
      if (reservas.has(reserva.id)) continue;
      if (!opcoes.criarReservaDiaria || !uuidFinanceiro.test(reserva.id)
          || identidadesConhecidas.has(('diaria:' + reserva.id) as IdCaixinha)) {
        throw new ErroServico(422, 'A nova reserva precisa de uma identidade permanente disponível. Atualize o cadastro e tente novamente.');
      }
    }
  }
  const depois = validarMovimentos(() => montarFinanceiro(antes, comando));
  const { ids, alteraPendencias } = caixinhasAfetadas(antes, depois);
  if (alteraPendencias) throw new ErroServico(422, 'A alteração afeta referências ambíguas.');
  await opcoes?.validarSaldos?.(antes, depois, ids);
  const catalogo = await Promise.all(ids.map(async id => {
    const registro = await tx.get(espaco + '/caixinhas/' + encodeURIComponent(id));
    return { id, dados: registro };
  }));
  const custosNovos = new Set<string>();
  if (opcoes?.criarCusto && comando.tipo === 'custos-fixos') {
    const conhecidos = new Set<string>(projetarCatalogoCaixinhas(antes).caixinhas.map(item => item.id));
    for (const custo of comando.custosFixos) {
      const id = 'fixo:' + custo.id;
      if (!conhecidos.has(id)) custosNovos.add(id);
    }
  }
  const reservasNovas = new Set<string>();
  if (opcoes?.atualizarCampos && opcoes.criarReservaDiaria && comando.tipo === 'turno' && !comando.alvo) {
    const idsAnteriores = new Set((antes.reservasDiarias ?? []).map(reserva => reserva.id));
    const identidadesAnteriores = new Set(projetarCatalogoCaixinhas(antes).caixinhas.map(item => item.id));
    for (const reserva of depois.reservasDiarias ?? []) {
      const id = ('diaria:' + reserva.id) as IdCaixinha;
      if (!idsAnteriores.has(reserva.id) && !identidadesAnteriores.has(id)) reservasNovas.add(id);
    }
  }
  const criar: string[] = [];
  for (const { id, dados } of catalogo) {
    if (!dados && (custosNovos.has(id) || reservasNovas.has(id))) {
      if (!opcoes?.validarSaldos) validarMovimentos(() => saldoVerificavelEmCentavos(depois, id));
      criar.push(id);
      continue;
    }
    if (dados?.id !== id || (dados.estado !== 'ativa' && dados.estado !== 'arquivada')) {
      throw new ErroServico(422, 'Identidade da caixinha indisponível.');
    }
    if (dados.estado === 'arquivada') throw new ErroServico(422, 'Movimentação em caixinha arquivada.');
    if (!opcoes?.validarSaldos) validarMovimentos(() => {
      const anterior = saldoVerificavelEmCentavos(antes, id);
      const posterior = saldoVerificavelEmCentavos(depois, id);
      if (posterior < 0 && posterior < anterior) throw new Error('Saldo insuficiente na caixinha.');
    });
  }
  const proximaRevisao = revisao + 1;
  const lancamentoId = comando.tipo === 'custos-fixos' || comando.tipo === 'preferencias' ? null
    : ('alvo' in comando ? comando.alvo : null) ?? comando.operacaoId;
  const campos = comando.tipo === 'custos-fixos' ? { custosFixos: depois.custosFixos }
    : comando.tipo === 'preferencias'
      ? { ...(comando.modoEscuro !== undefined && { modoEscuro: depois.modoEscuro }),
        ...(comando.lembrete !== undefined && { lembrete: depois.lembrete }) }
      : comando.tipo === 'turno' && !comando.alvo
        ? { historico: depois.historico, reservasDiarias: depois.reservasDiarias ?? [] }
      : { historico: depois.historico };
  const _sync = { ...sync, revision: proximaRevisao };
  tx.set(financeiro, opcoes?.atualizarCampos ? { ...campos, _sync } : { ...depois, _sync });
  for (const id of criar) tx.set(espaco + '/caixinhas/' + encodeURIComponent(id), { id, estado: 'ativa' });
  tx.set(evento, {
    id: comando.operacaoId, espacoId, assinatura, autorUid: uid, geracao: sync.generation,
    revisaoAnterior: revisao, revisao: proximaRevisao, tipo: comando.tipo,
    lancamentoId, caixinhas: ids.sort(), confirmadoEm: tx.agora(),
    ...((comando.tipo === 'estornar' || (comando.tipo === 'turno' && comando.alvo)) && {
      antes: antes.historico.find(h => h.id === lancamentoId) ?? null,
      depois: depois.historico.find(h => h.id === lancamentoId) ?? null,
      ...(comando.tipo === 'estornar' && { motivo: comando.motivo }),
    }),
  });
  return { operacaoId: comando.operacaoId, revisao: proximaRevisao, repetida: false };
}

function validarMovimentos<T>(acao: () => T): T {
  try {
    return acao();
  } catch (erro) {
    throw new ErroServico(422, (erro as Error).message);
  }
}
