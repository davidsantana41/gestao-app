'use client';
import { useState } from 'react';
import { centavos, dataBR, dataLocal, moeda, numero, resumir, type DadosPersistidos, type Lancamento } from '@/lib/gestao';
import { Campo, Valor } from './Campo';

export default function AvulsoForm({ dados, onSalvar }: { dados: DadosPersistidos; onSalvar: (item: Lancamento) => boolean }) {
  const [form, setForm] = useState({ tipo: 'saida', data: dataLocal(), nome: '', valor: '', origem: 'principal' });
  const [erro, setErro] = useState('');
  const resumo = resumir(dados.historico);
  const origens = [{ id: 'principal', nome: 'Saldo principal', saldo: resumo.liquido },
    ...dados.custosFixos.map(c => ({ id: c.id, nome: c.nome, saldo: resumo.caixinhas[c.id] ?? 0 })),
    ...[['reserva1', dados.nomeReserva1], ['reserva2', dados.nomeReserva2], ['reserva3', dados.nomeReserva3]].map(([id, nome]) => ({ id, nome, saldo: resumo.caixinhas[id] ?? 0 })),
    ...Object.entries(resumo.reservas).map(([id, r]) => ({ id: `diaria:${id}`, nome: r.nome, saldo: r.valor }))];
  return <section className="painel"><h2>Entrada ou saída avulsa</h2><p className="ajuda">Registre movimentações fora do turno e escolha de onde retirar.</p>
    <form className="avulso-grid" onSubmit={e => {
      e.preventDefault(); setErro('');
      const valor = centavos(numero(form.valor));
      if (!form.nome.trim() || valor <= 0) { setErro('Informe uma descrição e um valor maior que zero.'); return; }
      if (!origens.some(o => o.id === form.origem)) { setErro('Escolha uma origem disponível.'); return; }
      const entrada = form.tipo === 'entrada';
      const despesa = !entrada && form.origem === 'principal' ? valor : 0;
      const salvo = onSalvar({ id: crypto.randomUUID(), data: dataBR(form.data), diaSemana: new Date(`${form.data}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long' }),
        tipo: entrada ? 'avulso_entrada' : 'avulso_saida', descricao: form.nome.trim(), faturamentoBruto: entrada ? valor : 0,
        combustivel: 0, litros: 0, kmTrabalhado: 0, kmTotal: 0, reservaFevereiro: 0, reservaInvestimento: 0, reservaAcidente: 0,
        custosFixosDia: 0, detalheCustosFixosDia: {}, reservasDiariasDia: [],
        saidas: entrada ? [] : [{ id: crypto.randomUUID(), nome: form.nome.trim(), valor, origem: form.origem }],
        totalDespesas: despesa, liquido: entrada ? valor : -despesa });
      if (salvo) setForm({ tipo: 'saida', data: dataLocal(), nome: '', valor: '', origem: 'principal' });
    }}>
      <label className="campo"><span>Tipo</span><select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.currentTarget.value })}><option value="saida">Saída</option><option value="entrada">Entrada</option></select></label>
      <Campo label="Data" type="date" required value={form.data} onChange={e => setForm({ ...form, data: e.currentTarget.value })} />
      <Campo label="Descrição" required value={form.nome} onChange={e => setForm({ ...form, nome: e.currentTarget.value })} />
      <Valor label="Valor (R$)" value={form.valor} onChange={valor => setForm({ ...form, valor })} />
      {form.tipo === 'saida' && <label className="campo"><span>Retirar de</span><select value={form.origem} onChange={e => setForm({ ...form, origem: e.currentTarget.value })}>{origens.map(o => <option key={o.id} value={o.id}>{o.nome} · {moeda(o.saldo)}</option>)}</select></label>}
      <button className="botao primario" type="submit">Registrar movimentação</button>
    </form>{erro && <p role="alert" className="mensagem erro">{erro}</p>}
  </section>;
}
