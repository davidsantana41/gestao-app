import { dataISO, decimal, moeda, resultado, resumir, type DadosPersistidos, type Lancamento } from '@/lib/gestao';
import { sinalSaldo } from './saldo';
import PendenciasConciliacao from './PendenciasConciliacao';
import type { LeituraCaixinhas } from '@/lib/useFinanceiroIntegrado';

export function Historico({ itens, onEditar, onExcluir, onEstornar }: { itens: Lancamento[]; onEditar?: (item: Lancamento) => void; onExcluir?: (item: Lancamento) => void; onEstornar?: (item: Lancamento) => void }) {
  return <section className="painel"><div className="titulo-linha"><h2>Histórico de lançamentos</h2><span className="selo">{itens.length} registros</span></div>
    {!itens.length ? <p className="vazio">Seus lançamentos salvos aparecerão aqui.</p> : <div className="tabela-scroll" tabIndex={0} role="region" aria-label="Histórico de lançamentos"><table className="historico-tabela" role="table"><caption className="somente-leitor">Histórico de lançamentos</caption><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Data</th><th role="columnheader" scope="col">Lançamento</th><th role="columnheader" scope="col">Faturamento / valor</th><th role="columnheader" scope="col">Despesas e reservas</th><th role="columnheader" scope="col">Saldo principal</th><th role="columnheader" scope="col">Ações</th></tr></thead><tbody role="rowgroup">{itens.map(h => {
      const r = resultado(h);
      return <tr key={h.id} role="row">
        <td role="cell" data-coluna="Data"><div>{h.data}<small>{h.diaSemana}</small></div></td>
        <td role="cell" data-coluna="Lançamento"><div>{h.tipo === 'turno' ? 'Turno de trabalho' : h.descricao}<small>{h.tipo === 'turno' ? (h.reservasDiariasDia ?? []).map(r => `${r.nome || 'Reserva antiga'}: ${moeda(r.valor)}`).join(' · ') : h.depositoCaixinha ? 'Depósito em caixinha' : h.tipo === 'avulso_entrada' ? 'Entrada avulsa' : 'Saída avulsa'}</small>{h.estornadoPor && <small>Estornado · {h.motivoEstorno}</small>}</div></td>
        <td role="cell" data-coluna="Faturamento / valor">{moeda(h.tipo === 'avulso_saida' ? (h.saidas ?? []).reduce((s, r) => s + r.valor, 0) : h.faturamentoBruto)}</td>
        <td role="cell" data-coluna="Despesas e reservas">{moeda(r.despesas)}</td>
        <td role="cell" data-coluna="Saldo principal" data-saldo={sinalSaldo(r.liquido)}>{moeda(r.liquido)}</td>
        <td role="cell">{!h.estornadoPor && <div className="acoes">{onEditar && h.tipo === 'turno' && <button type="button" className="botao discreto" onClick={() => onEditar(h)}>Editar</button>}{onExcluir && <button type="button" className="botao discreto perigo" onClick={() => onExcluir(h)}>Excluir</button>}{onEstornar && <button type="button" className="botao discreto perigo" onClick={() => onEstornar(h)}>Estornar</button>}</div>}</td>
      </tr>;
    })}</tbody></table></div>}
  </section>;
}

export default function Relatorios({ dados, caixinhas, onVerCaixinhas, mes, onMes, onEditar, onExcluir, onEstornar }: {
  dados: DadosPersistidos; caixinhas?: LeituraCaixinhas['relatorio']; onVerCaixinhas?: () => void;
  mes: string; onMes: (mes: string) => void; onEditar?: (item: Lancamento) => void; onExcluir?: (item: Lancamento) => void; onEstornar?: (item: Lancamento) => void;
}) {
  const itens = dados.historico.filter(h => !mes || dataISO(h.data).startsWith(mes));
  const r = resumir(itens);
  const acumulado = resumir(dados.historico);
  const nomes: Record<string, string> = { reserva1: dados.nomeReserva1, reserva2: dados.nomeReserva2, reserva3: dados.nomeReserva3, ...Object.fromEntries(dados.custosFixos.map(c => [c.id, c.nome])) };
  const porMes: Record<string, Lancamento[]> = {}, porAno: Record<string, Lancamento[]> = {};
  dados.historico.forEach(h => {
    const iso = dataISO(h.data), mes = iso.slice(0, 7), ano = iso.slice(0, 4);
    (porMes[mes] ??= []).push(h); (porAno[ano] ??= []).push(h);
  });
  return <div className="pilha">
    <section className="painel filtro"><div><p className="sobretitulo">VISÃO DO SEU TRABALHO</p><h2>Relatórios</h2></div><label className="campo"><span>Filtrar por mês</span><input type="month" value={mes} onChange={e => onMes(e.currentTarget.value)} /></label><button className="botao secundario" type="button" onClick={() => onMes('')}>Todo o período</button></section>
    <div className="grade-metricas">
      <div className="metrica"><span>Faturamento</span><strong>{moeda(r.faturamento)}</strong></div>
      <div className="metrica"><span>Despesas e reservas</span><strong>{moeda(r.despesas)}</strong></div>
      <div className="metrica"><span>Saldo líquido</span><strong data-saldo={sinalSaldo(r.liquido)}>{moeda(r.liquido)}</strong></div>
      <div className="metrica"><span>Dias trabalhados</span><strong>{r.dias}</strong></div>
    </div>
    <section className="painel"><h2>Indicadores do período</h2><div className="grade-metricas pequena"><div><span>Combustível</span><strong>{moeda(r.combustivel)}</strong></div><div><span>KM trabalhados</span><strong>{decimal(r.km)}</strong></div><div><span>Preço médio por litro</span><strong>{r.litros ? `${moeda(r.combustivel / r.litros)}/L` : '—'}</strong></div><div><span>Consumo médio</span><strong>{r.litros ? `${decimal(r.km / r.litros)} km/L` : '—'}</strong></div></div></section>
    {caixinhas ? <section className="painel pilha compacta">
      <h2>Reservas e caixinhas acumuladas</h2>
      <p className="ajuda">Saldo de todo o histórico, com retiradas e vínculos confirmados.</p>
      <div className="grade-custos reservas-acumuladas">{caixinhas.caixinhas.map(caixa =>
        <div className="custo-item reserva-acumulada" key={caixa.id}>
          <span>{caixa.nome}</span>
          <strong data-saldo={caixa.saldoAtestado ? sinalSaldo(caixa.saldo) : undefined}>{caixa.saldoAtestado ? moeda(caixa.saldo) : 'Em revisão'}</strong>
        </div>)}
      </div>
      {caixinhas.totalPendencias > 0 && <p>Movimentações para revisar ({caixinhas.totalPendencias}).</p>}
      {onVerCaixinhas && <button type="button" className="botao secundario" onClick={onVerCaixinhas}>Ver caixinhas</button>}
    </section> : <>
      <section className="painel"><h2>Reservas e caixinhas acumuladas</h2><p className="ajuda">Saldo de todo o histórico, já descontadas as retiradas.</p><div className="grade-custos reservas-acumuladas">{Object.entries(acumulado.caixinhas).map(([id, valor]) => <div className="custo-item reserva-acumulada" key={id} style={{ borderTopColor: dados.custosFixos.find(c => c.id === id)?.cor || undefined }}><span>{nomes[id] || 'Caixinha anterior'}</span><strong data-saldo={sinalSaldo(valor)}>{moeda(valor)}</strong></div>)}{Object.entries(acumulado.reservas).map(([id, r]) => <div className="custo-item reserva-acumulada" key={id}><span>{r.nome}</span><strong data-saldo={sinalSaldo(r.valor)}>{moeda(r.valor)}</strong></div>)}</div>{!dados.historico.length && <p className="vazio">As reservas aparecerão depois de salvar um turno.</p>}</section>
      <PendenciasConciliacao dados={dados} />
    </>}
    <Historico itens={itens} onEditar={onEditar} onExcluir={onExcluir} onEstornar={onEstornar} />
    {[['Resultados por mês', porMes], ['Resultados por ano', porAno]] .map(([titulo, grupos]) => <section className="painel" key={String(titulo)}><h2>{String(titulo)}</h2><div className="tabela-scroll" tabIndex={0} role="region" aria-label={String(titulo)}><table><caption className="somente-leitor">{String(titulo)}</caption><thead><tr><th scope="col">Período</th><th scope="col">Dias</th><th scope="col">Faturamento</th><th scope="col">Despesas e reservas</th><th scope="col">Saldo líquido</th></tr></thead><tbody>{Object.entries(grupos).sort(([a], [b]) => b.localeCompare(a)).map(([periodo, itens]) => { const total = resumir(itens as Lancamento[]); return <tr key={periodo}><td>{periodo}</td><td>{total.dias}</td><td>{moeda(total.faturamento)}</td><td>{moeda(total.despesas)}</td><td data-saldo={sinalSaldo(total.liquido)}>{moeda(total.liquido)}</td></tr>; })}</tbody></table></div></section>)}
  </div>;
}
