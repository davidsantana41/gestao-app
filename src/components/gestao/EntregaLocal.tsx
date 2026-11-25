'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import AppcarLogo from '@/components/AppcarLogo';
import Relatorios from './Relatorios';
import PendenciasConciliacao from './PendenciasConciliacao';
import { ConfirmacaoCiclo, type SelecaoCiclo } from './DemoCicloCaixinhas';
import type { CaixinhaDemonstracao, EstadoDemonstracao } from '@/lib/demonstracaoLocal';
import { moeda, type DadosPersistidos } from '@/lib/gestao';
import ContaDemonstracao, { type TelaContaDemo } from './ContaDemonstracao';

const abas = ['Caixinhas', 'Histórico e relatórios', 'Espaço compartilhado'] as const;
const chaveSessao = 'appcar-demonstracao-encerrada';
const chaveTema = 'appcar-demonstracao-tema';
const rotulos: Record<string, string> = { criar: 'Criação', renomear: 'Renomeação', arquivar: 'Arquivamento', reativar: 'Reativação' };
const horario = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/Sao_Paulo' });

async function consultar<T>(sufixo = '', corpo?: unknown): Promise<T> {
  const resposta = await fetch('/api/demonstracao' + sufixo, corpo ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
  } : { cache: 'no-store' });
  const json = await resposta.json();
  if (!resposta.ok) throw new Error(json.erro || 'Emulador indisponível.');
  return json as T;
}

export default function EntregaLocal() {
  const [dados, setDados] = useState<EstadoDemonstracao>();
  const [compartilhado, setCompartilhado] = useState<DadosPersistidos>();
  const [aba, setAba] = useState<(typeof abas)[number]>('Caixinhas');
  const [selecao, setSelecao] = useState<SelecaoCiclo<CaixinhaDemonstracao>>();
  const [mes, setMes] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');
  const tentativa = useRef<{ chave: string; id: string; idNovo: string } | null>(null);
  const [telaConta, setTelaConta] = useState<TelaContaDemo>();
  const [sessao, setSessao] = useState<'ativa' | 'encerrada'>();
  const [tema, setTema] = useState<'escuro' | 'claro'>('escuro');
  const menu = useRef<HTMLDetailsElement>(null);

  function carregar() {
    setErro('');
    void consultar<EstadoDemonstracao>().then(setDados).catch(falha => setErro(falha.message));
  }
  useEffect(() => {
    let ativa = true;
    void Promise.resolve().then(() => {
      if (!ativa) return;
      if (localStorage.getItem(chaveTema) === 'claro') setTema('claro');
      const encerrada = sessionStorage.getItem(chaveSessao) === 'sim';
      setSessao(encerrada ? 'encerrada' : 'ativa');
      if (!encerrada) return consultar<EstadoDemonstracao>().then(estado => { if (ativa) setDados(estado); });
    })
      .catch(falha => { if (ativa) setErro(falha.message); });
    return () => { ativa = false; };
  }, []);

  function navegar(proxima: (typeof abas)[number]) {
    setAba(proxima);
    setSelecao(undefined);
    setErro('');
    setMensagem('');
    if (proxima === 'Espaço compartilhado') {
      setCompartilhado(undefined);
      void consultar<DadosPersistidos>('?compartilhado=1').then(setCompartilhado)
        .catch(falha => setErro(falha.message));
    }
  }

  async function salvar(corpo: unknown, confirmacao: string) {
    setOcupado(true);
    setErro('');
    setMensagem('');
    try {
      setDados(await consultar<EstadoDemonstracao>('', corpo));
      tentativa.current = null;
      setSelecao(undefined);
      setMensagem(confirmacao);
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não foi possível confirmar a operação.');
    } finally { setOcupado(false); }
  }

  function confirmar(nome: string, finalidade: string, motivo: string) {
    if (!selecao || !dados || ocupado) return;
    const alvo = 'caixinha' in selecao ? selecao.caixinha : undefined;
    const chave = JSON.stringify([selecao.acao, alvo?.id, alvo?.versao, dados.financeiro._sync, nome, finalidade, motivo]);
    if (tentativa.current?.chave !== chave) tentativa.current = { chave, id: crypto.randomUUID(), idNovo: crypto.randomUUID() };
    const operacao = tentativa.current;
    void salvar({ tipo: 'ciclo', comando: {
      id: operacao.id, caixinhaId: alvo?.id ?? `diaria:${operacao.idNovo}`,
      acao: selecao.acao, versao: alvo?.versao ?? 0, geracao: dados.financeiro._sync?.generation,
      revisaoFinanceira: dados.financeiro._sync?.revision, nome, finalidade, motivo,
    } }, 'Alteração confirmada no emulador.');
  }

  function salvarFormulario(evento: FormEvent<HTMLFormElement>, tipo: 'perfil' | 'veiculo') {
    evento.preventDefault();
    const campos = Object.fromEntries(new FormData(evento.currentTarget));
    void salvar({ ...campos, tipo, ...(tipo === 'veiculo' && {
      km: Number(campos.km), anoFabricacao: Number(campos.anoFabricacao), anoModelo: Number(campos.anoModelo),
    }) },
      tipo === 'perfil' ? 'Perfil fictício salvo.' : 'Veículo fictício salvo.');
  }

  const nome = dados?.perfil.nome?.trim() || 'Motorista de demonstração';
  function escolherConta(tela: TelaContaDemo) {
    if (menu.current) menu.current.open = false;
    setMensagem('');
    setErro('');
    setTelaConta(tela);
  }
  function fecharConta() {
    setTelaConta(undefined);
    setMensagem('');
    setErro('');
    requestAnimationFrame(() => menu.current?.querySelector('summary')?.focus());
  }
  function sair() {
    sessionStorage.setItem(chaveSessao, 'sim');
    setSessao('encerrada');
    setDados(undefined);
    setCompartilhado(undefined);
    setSelecao(undefined);
    setTelaConta(undefined);
    setAba('Caixinhas');
    setErro('');
    setMensagem('');
    tentativa.current = null;
  }

  return <main className={`app ${tema}`}>
    <header className="cabecalho"><div className="container cabecalho-conteudo">
      <AppcarLogo subtitulo="Primeira entrega · Demonstração local" tamanho="pequeno" />
      {sessao === 'ativa' && <div className="usuario">
        <details ref={menu} className="demo-conta-menu" onKeyDown={evento => {
          if (evento.key === 'Escape' && menu.current?.open) {
            menu.current.open = false;
            menu.current.querySelector('summary')?.focus();
          }
        }}>
          <summary className="botao secundario" aria-label={`Menu da conta: ${nome}`}>{nome} <span aria-hidden="true">▾</span></summary>
          <div className="painel demo-conta-opcoes">
            {(['Meu perfil', 'Meus veículos', 'Configurações'] as const).map(tela =>
              <button type="button" className="botao secundario" key={tela} disabled={!dados || ocupado} onClick={() => escolherConta(tela)}>{tela}</button>)}
            <button type="button" className="botao secundario" disabled={ocupado} onClick={sair}>Sair</button>
          </div>
        </details>
        <span className="selo">Firebase Emulator Suite</span>
      </div>}
    </div></header>
    {sessao === 'encerrada' && <div className="container conteudo">
      <section className="painel pilha compacta"><h1>Sessão de demonstração encerrada</h1>
        <p>Os dados fictícios continuam no emulador. Esta saída vale para a aba atual.</p>
        <div><button type="button" className="botao primario" onClick={() => {
          sessionStorage.removeItem(chaveSessao);
          setSessao('ativa');
          carregar();
        }}>Entrar na demonstração</button></div>
      </section>
    </div>}
    {sessao !== 'encerrada' && <div className="container conteudo pilha">
      <p className="mensagem aviso">Espaço fictício de demonstração. Use dados inventados. O histórico financeiro está disponível para consulta.</p>
      <nav aria-label="Seções da demonstração" className="acoes">
        {abas.map(item => <button key={item} type="button" aria-pressed={item === aba} disabled={ocupado}
          className={`botao ${item === aba ? 'primario' : 'secundario'}`} onClick={() => navegar(item)}>{item}</button>)}
      </nav>
      {erro && !telaConta && <p className="mensagem erro" role="alert">{erro}</p>}
      {mensagem && !telaConta && <p className="mensagem sucesso" role="status">{mensagem}</p>}
      {!dados && <section className="painel"><p>Consultando o Firestore Emulator…</p>{erro && <button className="botao secundario" onClick={carregar}>Tentar novamente</button>}</section>}
      {dados && aba === 'Caixinhas' && <>
        {selecao && <ConfirmacaoCiclo key={selecao.acao + ('caixinha' in selecao ? selecao.caixinha.id : '')}
          selecao={selecao} onCancelar={() => setSelecao(undefined)} onConfirmar={confirmar} persistente ocupado={ocupado} />}
        {(['ativa', 'arquivada'] as const).map(estado => <section className="painel pilha compacta" key={estado}>
          <div className="titulo-linha"><h2>{estado === 'ativa' ? 'Caixinhas ativas' : 'Caixinhas arquivadas'}</h2>
            {estado === 'ativa' && <button className="botao primario" disabled={ocupado} onClick={() => setSelecao({ acao: 'criar' })}>Criar caixinha</button>}</div>
          {!dados.caixinhas.some(c => c.estado === estado) && <p className="vazio">Nenhuma caixinha nesta seção.</p>}
          {dados.caixinhas.filter(c => c.estado === estado).map(c => <article className="custo-item" key={c.id}>
            <strong>{c.nome}</strong> · {c.saldo === null ? 'Saldo pendente' : moeda(c.saldo)}
            {c.finalidade && <p>{c.finalidade}</p>}<p className="ajuda">{c.id}</p>
            <div className="acoes">{(estado === 'ativa' ? ['renomear', 'arquivar'] as const : ['reativar'] as const).map(acao =>
              <button key={acao} className="botao secundario" disabled={ocupado} onClick={() => setSelecao({ acao, caixinha: c })}>
                {acao === 'renomear' ? 'Renomear' : acao === 'arquivar' ? 'Arquivar' : 'Reativar'} {c.nome}
              </button>)}</div>
          </article>)}
        </section>)}
        <section className="painel pilha compacta"><h2>Histórico de alterações</h2>
          {!dados.eventos.length && <p className="vazio">Nenhuma alteração registrada nesta sessão do emulador.</p>}
          {dados.eventos.map(e => <article className="custo-item" key={e.id}>
            <strong>{rotulos[e.acao] ?? e.acao}</strong> · {e.antes && `${e.antes.nome} → `}{e.depois.nome}
            <p className="ajuda">{e.caixinhaId}</p>
            <p><time dateTime={e.confirmadoEm}>{horario.format(new Date(e.confirmadoEm))}</time> · Autor {e.autorUid}</p>
            <p>Motivo {e.motivo ?? '—'}</p>
          </article>)}
        </section>
        <PendenciasConciliacao dados={dados.financeiro} />
      </>}
      {dados && aba === 'Histórico e relatórios' && <Relatorios dados={dados.financeiro} mes={mes} onMes={setMes} />}
      {dados && telaConta && <ContaDemonstracao key={telaConta} tela={telaConta} dados={dados} ocupado={ocupado}
        fechar={fecharConta} salvar={salvarFormulario} tema={tema} erro={erro} mensagem={mensagem} mudarTema={novo => {
          localStorage.setItem(chaveTema, novo);
          setTema(novo);
        }} />}
      {dados && aba === 'Espaço compartilhado' && <>
        <section className="painel"><h2>Espaço do motorista</h2><p className="selo">Somente visualização</p>
          <p>A consulta usa a perspectiva do parceiro fictício nas regras do Firestore Emulator. Gerenciamento de convites indisponível nesta entrega.</p></section>
        {compartilhado && <Relatorios dados={compartilhado} mes={mes} onMes={setMes} />}
      </>}
    </div>}
  </main>;
}
