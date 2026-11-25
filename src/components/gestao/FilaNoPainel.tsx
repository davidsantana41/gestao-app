'use client';

import { useState } from 'react';
import type { useFinanceiroIntegrado } from '@/lib/useFinanceiroIntegrado';
import { moeda } from '@/lib/gestao';

const rotulos = { pendente: 'Pendente', enviando: 'Enviando', confirmado: 'Confirmado', conflito: 'Conflito', rejeitado: 'Rejeitado' };
const acoes = new Map<unknown, string>([
  ['custos-fixos', 'Custos fixos'],
  ['entrada', 'Entrada'],
  ['retirada', 'Retirada'],
  ['deposito-caixinha', 'Depósito em caixinha'],
  ['estornar', 'Estorno de lançamento'],
  ['preferencias', 'Preferências do painel'],
  ['excluir', 'Exclusão de lançamento'],
  ['caixinha-criar', 'Criação de caixinha'],
  ['caixinha-editar', 'Edição de caixinha'],
  ['caixinha-arquivar', 'Desativa??o de caixinha'],
  ['caixinha-reativar', 'Reativação de caixinha'],
  ['caixinha-excluir', 'Exclusão de caixinha'],
  ['caixinha-conciliar', 'Confirmação de vínculo'],
]);

export default function FilaNoPainel({ financeiro }: { financeiro: ReturnType<typeof useFinanceiroIntegrado> }) {
  const atual = financeiro.dados?._sync;
  const geracoes = [...new Set([...financeiro.geracoes, ...(atual ? [atual.generation] : [])])];
  const [selecionada, setSelecionada] = useState<number>();
  const geracao = selecionada ?? atual?.generation ?? geracoes[0];
  const pendente = financeiro.itens.some(item => item.estado === 'pendente' || item.estado === 'enviando');
  const ultimo = financeiro.itens.at(-1);
  return <section className="painel pilha compacta" aria-labelledby="fila-financeira-titulo">
    <div className="titulo-linha">
      <div><h2 id="fila-financeira-titulo">Fila financeira</h2>
        <p className="ajuda">{atual ? `${financeiro.producao ? 'Financeiro confirmado' : 'Firestore Emulator'} · Geração ${atual.generation}, revisão ${atual.revision}` : 'Aguardando dados confirmados.'}</p></div>
      <button type="button" className="botao secundario" disabled={financeiro.ocupado} onClick={() => void financeiro.atualizar()}>Atualizar dados confirmados</button>
    </div>
    {financeiro.erro && <p role="alert" className="mensagem erro">{financeiro.erro}</p>}
    {financeiro.producao && atual && !financeiro.gravavel && <p role="status" className="mensagem aviso">Gravação suspensa neste espaço.</p>}
    {geracao !== undefined && (financeiro.aberta !== geracao || geracoes.length > 1) && <form className="pilha compacta" onSubmit={evento => {
      evento.preventDefault();
      const segredo = new FormData(evento.currentTarget).get('segredo');
      evento.currentTarget.reset();
      if (typeof segredo === 'string') financeiro.desbloquear(segredo, geracao);
    }}>
      {geracoes.length > 1 && <label className="campo"><span>Geração da fila</span><select value={geracao} onChange={e => setSelecionada(Number(e.currentTarget.value))}>
        {geracoes.map(valor => <option key={valor} value={valor}>{valor}</option>)}
      </select></label>}
      {financeiro.aberta !== geracao && <>
        <label className="campo"><span>Senha local da fila</span><input type="password" name="segredo" minLength={16} autoComplete="off" required /></label>
        <p className="ajuda">{financeiro.producao ? 'Escolha uma senha exclusiva da fila, com pelo menos 16 caracteres.' : 'Use uma senha fictícia de pelo menos 16 caracteres.'} Guarde-a para reabrir esta fila no mesmo navegador.</p>
        <div><button className="botao primario" disabled={financeiro.ocupado}>Desbloquear fila</button></div>
      </>}
    </form>}
    {financeiro.aberta !== undefined && <>
      {financeiro.aberta !== atual?.generation && <p className="mensagem aviso">Fila da geração {financeiro.aberta}. Desbloqueie a geração atual para registrar novas operações.</p>}
      {financeiro.itens.length === 0 && <p className="ajuda">A fila está vazia.</p>}
      <span className="somente-leitor" role="status">{ultimo && rotulos[ultimo.estado]}</span>
      {financeiro.itens.slice().reverse().map(({ estado, comando, recibo, motivo }) => {
        const { tipo, descricao, data, valorCentavos, faturamentoCentavos, lancamentoId, nome, caixinhaId } = comando.alteracao;
        const valor = valorCentavos ?? faturamentoCentavos;
        const acao = tipo === 'turno' ? (lancamentoId ? 'Edição de turno' : 'Novo turno') : acoes.get(tipo) ?? 'Operação financeira';
        return <article className="custo-item" key={comando.operacaoId} data-estado-fila={estado}>
          <strong>{acao} · {rotulos[estado]}</strong>
          <p>{[descricao ?? nome ?? caixinhaId, data, typeof valor === 'number' ? moeda(valor / 100) : undefined].filter(v => typeof v === 'string').join(' · ')}</p>
          <p className="ajuda">Operação {comando.operacaoId} · Base {comando.revisao}
            {recibo && ` · Recibo na revisão ${recibo.revisao}${recibo.repetida ? ' (recuperado)' : ''}`}</p>
          {motivo && <p>{motivo}</p>}
          {(estado === 'conflito' || estado === 'rejeitado') && <><p>Confira os dados confirmados antes de registrar uma nova operação. O comando original fica na fila.</p>
            <details><summary>Consultar dados do comando</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(comando.alteracao, null, 2)}</pre></details></>}
        </article>;
      })}
      {pendente && <div><button type="button" className="botao primario" disabled={financeiro.ocupado}
        onClick={financeiro.tentarEnvio}>Retomar envio com o mesmo UUID</button></div>}
    </>}
  </section>;
}
