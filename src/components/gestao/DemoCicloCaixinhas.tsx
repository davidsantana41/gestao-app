'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { moeda } from '@/lib/gestao';
import { validarCicloCaixinha, type AcaoCaixinha, type CaixinhaCiclo, type EventoAuditoriaCaixinha } from '@/lib/cicloCaixinhas';
import type { CaixinhaDemonstracao } from '@/lib/demonstracaoLocal';

type CaixinhaDemo = CaixinhaCiclo & { saldo: number };
export type SelecaoCiclo<T = CaixinhaDemo> = { acao: 'criar' } | { acao: Exclude<AcaoCaixinha, 'criar'>; caixinha: T };

const exemplos: CaixinhaDemo[] = [
  { id: 'diaria:demo-zero', nome: 'Revisão', finalidade: 'Manutenção', estado: 'ativa', saldo: 0 },
  { id: 'diaria:demo-positivo', nome: 'Combustível', finalidade: 'Abastecimento', estado: 'ativa', saldo: 80 },
  { id: 'diaria:demo-negativo', nome: 'Imprevistos', finalidade: 'Emergências', estado: 'ativa', saldo: -15 },
  { id: 'diaria:demo-arquivada', nome: 'Viagem', finalidade: 'Deslocamentos', estado: 'arquivada', saldo: 0 },
];

const rotulos = { criar: 'Criar', renomear: 'Renomear', arquivar: 'Arquivar', reativar: 'Reativar' };

export function ConfirmacaoCiclo({ selecao, onCancelar, onConfirmar, persistente = false, ocupado = false }: {
  selecao: SelecaoCiclo<CaixinhaDemo | CaixinhaDemonstracao>;
  onCancelar: () => void;
  onConfirmar: (nome: string, finalidade: string, motivo: string) => void;
  persistente?: boolean;
  ocupado?: boolean;
}) {
  const { acao } = selecao;
  const caixinha = 'caixinha' in selecao ? selecao.caixinha : undefined;
  const [erro, setErro] = useState('');
  const titulo = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const anterior = document.activeElement;
    titulo.current?.focus();
    return () => { if (anterior instanceof HTMLElement && anterior.isConnected) anterior.focus(); };
  }, []);
  const saldo = caixinha ? caixinha.saldo ?? NaN : 0;
  const bloqueio = acao === 'arquivar' && saldo !== 0
    ? validarCicloCaixinha(acao, caixinha, { saldo, nome: '', motivo: '' })
    : undefined;

  function confirmar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const form = new FormData(evento.currentTarget);
    const nome = String(form.get('nome') ?? '').trim();
    const finalidade = String(form.get('finalidade') ?? '').trim();
    const motivo = String(form.get('motivo') ?? '').trim();
    const problema = validarCicloCaixinha(acao, caixinha, { nome, motivo, saldo });
    if (problema) setErro(problema);
    else onConfirmar(nome, finalidade, motivo);
  }

  return <section className="painel" aria-labelledby="confirmacao-ciclo-titulo">
    <h2 id="confirmacao-ciclo-titulo" ref={titulo} tabIndex={-1}>{rotulos[acao]} {caixinha?.nome ?? 'caixinha'}</h2>
    {caixinha && <p className="ajuda">{caixinha.id} · {Number.isFinite(saldo) ? `Saldo ${moeda(saldo)}` : 'Saldo pendente de conciliação'}</p>}
    {bloqueio ? <>
      <p className="mensagem aviso">{bloqueio}</p>
      <button type="button" className="botao secundario" onClick={onCancelar}>Voltar</button>
    </> : <form className="pilha compacta" onSubmit={confirmar}>
      {(acao === 'criar' || acao === 'renomear') && <label className="campo">
        <span>{acao === 'criar' ? 'Nome' : 'Novo nome'}</span><input name="nome" required />
      </label>}
      {acao === 'criar' ? <label className="campo"><span>Finalidade</span><input name="finalidade" /></label>
        : <label className="campo"><span>Motivo</span><textarea name="motivo" required /></label>}
      {erro && <p className="mensagem erro" role="alert">{erro}</p>}
      <div className="acoes">
        <button type="button" className="botao secundario" disabled={ocupado} onClick={onCancelar}>Cancelar</button>
        <button type="submit" className="botao primario" disabled={ocupado}>{persistente ? 'Confirmar' : 'Simular'} {rotulos[acao].toLowerCase()}</button>
      </div>
    </form>}
  </section>;
}

export default function DemoCicloCaixinhas() {
  const [caixinhas, setCaixinhas] = useState<readonly CaixinhaDemo[]>(exemplos);
  const [selecao, setSelecao] = useState<SelecaoCiclo>();
  const [eventos, setEventos] = useState<readonly EventoAuditoriaCaixinha[]>([]);

  function confirmar(nome: string, finalidade: string, motivo: string) {
    if (!selecao) return;
    const { acao } = selecao;
    const meta = { id: crypto.randomUUID(), autorUid: 'proprietario-ficticio', confirmadoEm: new Date().toISOString() };
    let evento: EventoAuditoriaCaixinha;
    if (acao === 'criar') {
      const caixinha: CaixinhaDemo = { id: `diaria:${crypto.randomUUID()}`, nome, finalidade, estado: 'ativa', saldo: 0 };
      setCaixinhas(atuais => [...atuais, caixinha]);
      evento = { ...meta, acao, caixinhaId: caixinha.id, nomeNovo: nome, finalidade };
    } else {
      const { caixinha } = selecao;
      const alvo = { ...meta, caixinhaId: caixinha.id, motivo };
      if (acao === 'renomear') evento = { ...alvo, acao, nomeAnterior: caixinha.nome, nomeNovo: nome };
      else if (acao === 'arquivar') evento = { ...alvo, acao, nomeAnterior: caixinha.nome };
      else evento = { ...alvo, acao, nomeNovo: caixinha.nome };
      setCaixinhas(atuais => atuais.map(item => item.id === caixinha.id
        ? { ...item, nome: acao === 'renomear' ? nome : item.nome, estado: acao === 'arquivar' ? 'arquivada' : 'ativa' }
        : item));
    }
    setEventos(atuais => [...atuais, evento]);
    setSelecao(undefined);
  }

  return <main className="app escuro">
    <div className="container conteudo pilha">
      <header><h1>Histórico e relatórios</h1><p>Demonstração do ciclo de vida com dados fictícios. As ações duram até recarregar a página.</p></header>
      {selecao && <ConfirmacaoCiclo selecao={selecao} onCancelar={() => setSelecao(undefined)} onConfirmar={confirmar} />}
      <section className="painel" aria-labelledby="caixinhas-ativas-demo">
        <h2 id="caixinhas-ativas-demo">Caixinhas ativas</h2>
        <div className="pilha compacta">
          <div><button type="button" className="botao primario" onClick={() => setSelecao({ acao: 'criar' })}>Criar caixinha</button></div>
          {caixinhas.filter(c => c.estado === 'ativa').map(c => <div className="custo-item" key={c.id}>
            <p><strong>{c.nome}</strong> · {moeda(c.saldo)}<br />{c.finalidade} · {c.id}</p>
            <div className="acoes">
              <button type="button" className="botao secundario" onClick={() => setSelecao({ acao: 'renomear', caixinha: c })}>Renomear {c.nome}</button>
              <button type="button" className="botao secundario" onClick={() => setSelecao({ acao: 'arquivar', caixinha: c })}>Arquivar {c.nome}</button>
            </div>
          </div>)}
        </div>
      </section>
      <section className="painel" aria-labelledby="caixinhas-arquivadas-demo">
        <h2 id="caixinhas-arquivadas-demo">Histórico de caixinhas arquivadas</h2>
        <div className="pilha compacta">{caixinhas.filter(c => c.estado === 'arquivada').map(c => <div className="custo-item" key={c.id}>
          <p><strong>{c.nome}</strong> · {moeda(c.saldo)}<br />{c.finalidade} · {c.id}</p>
          <div><button type="button" className="botao secundario" onClick={() => setSelecao({ acao: 'reativar', caixinha: c })}>Reativar {c.nome}</button></div>
        </div>)}</div>
        <h3>Eventos desta demonstração</h3>
        {eventos.length === 0 ? <p>Nenhum evento simulado.</p> : <ul>{eventos.map(e => <li key={e.id}>
          {e.acao} · {e.caixinhaId} · {e.autorUid} · <time dateTime={e.confirmadoEm}>{new Date(e.confirmadoEm).toLocaleString('pt-BR')}</time>
          {'nomeAnterior' in e && <> · {e.nomeAnterior}</>}{'nomeNovo' in e && <> · {e.nomeNovo}</>}
          {'motivo' in e && <> · {e.motivo}</>}
        </li>)}</ul>}
      </section>
    </div>
  </main>;
}
