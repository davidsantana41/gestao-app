'use client';

import { useReducer, useState } from 'react';
import { calcularTurno, criarTurno, decimal, moeda, novoFormulario, numero, type DadosPersistidos, type Lancamento, type TurnoFormulario } from '@/lib/gestao';
import { Campo, Valor } from './Campo';

type Acao = { tipo: 'campo'; campo: Exclude<keyof TurnoFormulario, 'reservas'>; valor: string }
  | { tipo: 'adicionar'; id: string } | { tipo: 'reserva'; id: string; campo: 'nome' | 'valor'; valor: string }
  | { tipo: 'remover'; id: string };
function reduzir(form: TurnoFormulario, acao: Acao): TurnoFormulario {
  switch (acao.tipo) {
    case 'campo': return { ...form, [acao.campo]: acao.valor };
    case 'adicionar': return { ...form, reservas: [...form.reservas, { id: acao.id, nome: '', valor: '' }] };
    case 'reserva': return { ...form, reservas: form.reservas.map(r => r.id === acao.id ? { ...r, [acao.campo]: acao.valor } : r) };
    case 'remover': return { ...form, reservas: form.reservas.filter(r => r.id !== acao.id) };
  }
}

export default function TurnoForm({ dados, original, onSalvar, onCancelar }: {
  dados: DadosPersistidos; original?: Lancamento; onSalvar: (item: Lancamento) => void; onCancelar: () => void;
}) {
  const [form, dispatch] = useReducer(reduzir, undefined, () => novoFormulario(dados.reservasDiarias, original));
  const [erro, setErro] = useState('');
  const conta = calcularTurno(form, dados.custosFixos, original);
  const campo = (nome: Exclude<keyof TurnoFormulario, 'reservas'>, valor: string) => dispatch({ tipo: 'campo', campo: nome, valor });
  const salvar = (event: React.FormEvent) => {
    event.preventDefault();
    setErro('');
    if (form.reservas.some(r => !r.nome.trim())) { setErro('Dê um nome a cada reserva ou remova as que não deseja salvar.'); return; }
    if (numero(form.kmTotal) < numero(form.kmTrabalhado)) { setErro('O KM total deve ser maior ou igual ao KM trabalhado.'); return; }
    if (!numero(form.faturamento) && !numero(form.combustivel) && !conta.totalReservas && !conta.acidente && !conta.reserva1 && !conta.reserva2) {
      setErro('Preencha o faturamento, o combustível ou uma reserva para salvar.'); return;
    }
    if (!original && dados.historico.some(h => h.tipo === 'turno' && h.data === form.data.split('-').reverse().join('/')) && !window.confirm('Já existe um turno nessa data. Deseja adicionar outro?')) return;
    onSalvar(criarTurno(form, dados.custosFixos, original?.id ?? crypto.randomUUID(), original));
  };
  return <form onSubmit={salvar} className="turno-grid">
    <div className="pilha">
      <section className="painel">
        <div className="titulo-linha"><div><p className="sobretitulo">SEU TRABALHO</p><h2>{original ? 'Editar turno' : 'Registrar turno'}</h2></div><span className="selo">{original ? 'Edição' : 'Novo'}</span></div>
        <div className="duas-colunas"><Campo label="Data do turno" type="date" required value={form.data} onChange={e => campo('data', e.currentTarget.value)} /><Valor label="Faturamento bruto (R$)" value={form.faturamento} onChange={v => campo('faturamento', v)} /></div>
      </section>
      <section className="painel">
        <h2>Abastecimento e quilometragem</h2><p className="ajuda">Informe os valores do turno. Os indicadores são atualizados na hora.</p>
        <div className="duas-colunas">
          <Valor label="Valor gasto (R$)" value={form.combustivel} onChange={v => campo('combustivel', v)} />
          <Valor label="Litros" value={form.litros} onChange={v => campo('litros', v)} />
          <Valor label="KM trabalhado" value={form.kmTrabalhado} onChange={v => campo('kmTrabalhado', v)} />
          <Valor label="KM total do carro" value={form.kmTotal} onChange={v => campo('kmTotal', v)} />
        </div>
        <div className="indicadores" aria-live="polite">
          <div><span>Preço por litro</span><strong data-testid="preco-litro">{conta.litros > 0 ? `${moeda(conta.precoLitro)}/L` : '—'}</strong><small>{moeda(conta.combustivel)} ÷ {decimal(conta.litros)} L</small></div>
          <div><span>Consumo médio</span><strong data-testid="consumo">{conta.litros > 0 ? `${decimal(conta.consumo)} km/L` : '—'}</strong><small>{decimal(conta.km)} km ÷ {decimal(conta.litros)} L</small></div>
        </div>
      </section>
      <section className="painel">
        <div className="titulo-linha"><div><h2>Reservas do turno</h2><p className="ajuda">Você escolhe o nome e quanto separar hoje.</p></div><button type="button" className="botao secundario" onClick={() => dispatch({ tipo: 'adicionar', id: crypto.randomUUID() })}>+ Adicionar reserva</button></div>
        {form.reservas.length === 0 && <p className="vazio">Nenhuma reserva neste turno.</p>}
        <div className="pilha compacta">{form.reservas.map(r => <div className="linha-reserva" key={r.id} data-testid="reserva">
          <Campo label="Nome da reserva" value={r.nome} placeholder="Ex.: Manutenção, férias…" onChange={e => dispatch({ tipo: 'reserva', id: r.id, campo: 'nome', valor: e.currentTarget.value })} />
          <Valor label="Valor (R$)" value={r.valor} onChange={v => dispatch({ tipo: 'reserva', id: r.id, campo: 'valor', valor: v })} />
          <button type="button" className="botao icone perigo" aria-label={`Excluir reserva ${r.nome || 'nova'}`} onClick={() => { if (window.confirm(`Excluir ${r.nome || 'esta reserva'} do turno?`)) dispatch({ tipo: 'remover', id: r.id }); }}>×</button>
        </div>)}</div>
        <div className="total-linha" aria-live="polite"><span>Total das reservas do turno</span><strong data-testid="total-reservas">{moeda(conta.totalReservas)}</strong></div>
        <div className="nota">Depois de salvar, os nomes continuam disponíveis e os valores do próximo turno começam zerados.</div>
      </section>
      {(original?.reservaFevereiro || original?.reservaInvestimento) ? <section className="painel"><h2>Reservas do lançamento antigo</h2><div className="duas-colunas"><Valor label={dados.nomeReserva1} value={form.reserva1} onChange={v => campo('reserva1', v)} /><Valor label={dados.nomeReserva2} value={form.reserva2} onChange={v => campo('reserva2', v)} /></div></section> : null}
    </div>
    <aside className="pilha resumo-turno">
      <section className="painel">
        <p className="sobretitulo">EM TEMPO REAL</p><h2>Resumo do turno</h2>
        <dl className="detalhes" aria-live="polite">
          <div><dt>Faturamento bruto</dt><dd>{moeda(numero(form.faturamento))}</dd></div>
          <div><dt>Combustível</dt><dd>{moeda(conta.combustivel)}</dd></div>
          <div><dt>{dados.nomeReserva3}</dt><dd>{moeda(conta.acidente)}</dd></div>
          {conta.reservas.map(r => <div key={r.id} data-testid="resumo-reserva"><dt>{r.nome || 'Nova reserva — preencha o nome'}</dt><dd>{moeda(r.valor)}</dd></div>)}
          {conta.reserva1 > 0 && <div><dt>{dados.nomeReserva1}</dt><dd>{moeda(conta.reserva1)}</dd></div>}
          {conta.reserva2 > 0 && <div><dt>{dados.nomeReserva2}</dt><dd>{moeda(conta.reserva2)}</dd></div>}
          {Object.entries(conta.detalheFixos).map(([id, valor]) => <div key={id}><dt>{dados.custosFixos.find(c => c.id === id)?.nome || 'Custo fixo anterior'}</dt><dd>{moeda(valor)}</dd></div>)}
          {conta.saidas.map(s => <div key={s.id}><dt>{s.nome}</dt><dd>{moeda(s.valor)}</dd></div>)}
          <div className="despesas"><dt>Total separado e despesas</dt><dd>{moeda(conta.despesas)}</dd></div>
        </dl>
        <div className={`saldo ${conta.liquido < 0 ? 'negativo' : ''}`}><span>Saldo líquido do turno</span><strong data-testid="saldo-turno">{moeda(conta.liquido)}</strong></div>
        <p className="nota">Custos mensais divididos por {conta.dias} dias de trabalho. Reserva de acidente: R$ 0,038 × KM total.</p>
        {erro && <p role="alert" className="mensagem erro">{erro}</p>}
        <button type="submit" className="botao primario largo">{original ? 'Salvar alterações' : 'Salvar turno'}</button>
        {original && <button type="button" className="botao secundario largo" onClick={onCancelar}>Cancelar edição</button>}
      </section>
    </aside>
  </form>;
}
