'use client';

import { useState } from 'react';
import type { ItemFilaFinanceira } from '@/lib/filaFinanceiraOffline';
import type { useFinanceiroIntegrado } from '@/lib/useFinanceiroIntegrado';

type Financeiro = ReturnType<typeof useFinanceiroIntegrado>;

export default function RecuperacaoFilaLegada({ financeiro }: { financeiro: Financeiro }) {
  const [geracao, setGeracao] = useState<number>();
  if (!financeiro.geracoes.length) return null;
  const atual = geracao ?? financeiro.aberta ?? financeiro.geracoes[0];
  const itens = financeiro.itens as ItemFilaFinanceira[];
  const pendente = itens.some(item => item.estado === 'pendente' || item.estado === 'enviando');
  return <details className="recuperacao-fila-legada">
    <summary>Recuperar operações antigas deste dispositivo ({financeiro.geracoes.length})</summary>
    <div className="pilha compacta">
      <p>Há dados criptografados de uma versão anterior neste navegador. Eles serão preservados. Informe a senha antiga para conferir e, se necessário, reenviar operações ao servidor com o mesmo identificador.</p>
      {financeiro.geracoes.length > 1 && <label className="campo"><span>Versão da fila</span><select value={atual} disabled={pendente || financeiro.ocupado} onChange={e => setGeracao(Number(e.currentTarget.value))}>{financeiro.geracoes.map(item => <option key={item} value={item}>{item}</option>)}</select></label>}
      {financeiro.aberta !== atual && <form className="recuperacao-fila-form" onSubmit={e => {
        e.preventDefault();
        const form = e.currentTarget;
        const segredo = String(new FormData(form).get('senha-antiga') ?? '');
        form.reset();
        financeiro.desbloquear(segredo, atual);
      }}>
        <label className="campo"><span>Senha antiga da fila</span><input name="senha-antiga" type="password" autoComplete="current-password" required /></label>
        <button className="botao secundario" type="submit" disabled={financeiro.ocupado || !financeiro.conectada}>Conferir operações</button>
      </form>}
      {financeiro.erro && <p className="mensagem erro" role="alert">{financeiro.erro}</p>}
      {financeiro.aberta === atual && <>
        {itens.length === 0 && <p>Nenhuma operação armazenada nesta fila.</p>}
        {itens.map(item => <article className="item-recuperacao" key={item.comando.operacaoId}>
          <strong>{String(item.comando.alteracao.tipo ?? 'Operação')} · {item.estado}</strong>
          <span>Identificador {item.comando.operacaoId}</span>
          {item.motivo && <span>{item.motivo}</span>}
        </article>)}
        {pendente && <button type="button" className="botao secundario" disabled={financeiro.ocupado || !financeiro.conectada} onClick={financeiro.tentarEnvio}>Retomar com o mesmo identificador</button>}
      </>}
    </div>
  </details>;
}
