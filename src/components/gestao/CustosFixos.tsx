'use client';
import { useState } from 'react';
import { moeda, numero, type CustoFixoItem } from '@/lib/gestao';
import { Campo, Valor } from './Campo';
const rascunhoDe = (itens: CustoFixoItem[]) => itens.map(c => ({ ...c, texto: String(c.valorMensal).replace('.', ',') }));

export default function CustosFixos({ itens, onSalvar }: { itens: CustoFixoItem[]; onSalvar: (itens: CustoFixoItem[], base: CustoFixoItem[]) => boolean }) {
  const [base, setBase] = useState(() => structuredClone(itens));
  const [draft, setDraft] = useState(() => rascunhoDe(itens));
  const dirty = JSON.stringify(draft) !== JSON.stringify(rascunhoDe(base));
  const rascunho = dirty ? draft : rascunhoDe(itens);
  const setRascunho = (next: typeof draft) => { if (!dirty) setBase(itens); setDraft(next); };
  const [erro, setErro] = useState('');
  return <section className="painel">
    <div className="titulo-linha"><div><p className="sobretitulo">PLANEJAMENTO</p><h2>Custos fixos e caixinhas</h2><p className="ajuda">O valor mensal é dividido pelos dias de trabalho do mês do turno.</p></div><button type="button" className="botao secundario" onClick={() => setRascunho([...rascunho, { id: crypto.randomUUID(), nome: '', valorMensal: 0, texto: '', cor: '#38bdf8' }])}>+ Adicionar custo</button></div>
    <div className="grade-custos">{rascunho.map(c => <div className="custo-item" key={c.id} style={{ borderTopColor: c.cor }}>
      <Campo label="Nome do custo" value={c.nome} onChange={e => { const nome = e.currentTarget.value; setRascunho(rascunho.map(r => r.id === c.id ? { ...r, nome } : r)); }} />
      <Valor label="Valor mensal (R$)" value={c.texto} onChange={texto => setRascunho(rascunho.map(r => r.id === c.id ? { ...r, texto } : r))} />
      <div className="titulo-linha"><Campo label="Cor" type="color" value={c.cor || '#38bdf8'} onChange={e => { const cor = e.currentTarget.value; setRascunho(rascunho.map(r => r.id === c.id ? { ...r, cor } : r)); }} /><button type="button" className="botao discreto perigo" onClick={() => { if (window.confirm(`Remover ${c.nome || 'este custo'}? Os turnos antigos serão preservados.`)) setRascunho(rascunho.filter(r => r.id !== c.id)); }}>Remover</button></div>
    </div>)}</div>
    {!rascunho.length && <p className="vazio">Nenhum custo fixo configurado.</p>}
    <div className="rodape-painel"><strong>Total mensal: {moeda(rascunho.reduce((s, c) => s + numero(c.texto), 0))}</strong><button type="button" className="botao primario" onClick={() => {
      if (rascunho.some(c => !c.nome.trim())) { setErro('Preencha o nome de cada custo.'); return; }
      setErro(''); const novos = rascunho.map(({ texto, ...c }) => ({ ...c, nome: c.nome.trim(), valorMensal: numero(texto) }));
      if (onSalvar(novos, dirty ? base : itens)) { setBase(novos); setDraft(rascunhoDe(novos)); }
    }}>Salvar custos fixos</button></div>
    {erro && <p role="alert" className="mensagem erro">{erro}</p>}
  </section>;
}
