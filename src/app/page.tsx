'use client';

import { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import Confirmacao from '@/components/Confirmacao';
import VerificarEmail from '@/components/VerificarEmail';
import Privacidade from '@/components/Privacidade';
import ReiniciarDados from '@/components/ReiniciarDados';
import AuthGate from '@/components/AuthGate';
import ModuloSelecao from '@/components/ModuloSelecao';
import GestaoFamiliar from '@/components/GestaoFamiliar';
import AppcarLogo from '@/components/AppcarLogo';
import CadastroMotorista from '@/components/gestao/CadastroMotorista';
import FilaNoPainel from '@/components/gestao/FilaNoPainel';
import TurnoForm from '@/components/gestao/TurnoForm';
import CustosFixos from '@/components/gestao/CustosFixos';
import AvulsoForm from '@/components/gestao/AvulsoForm';
import { sinalSaldo } from '@/components/gestao/saldo';
import Relatorios, { Historico } from '@/components/gestao/Relatorios';
import GestaoCaixinhas from '@/components/gestao/GestaoCaixinhas';
import { auth } from '@/lib/firebase';
import { useGestao } from '@/lib/useGestao';
import { useFinanceiroIntegrado, type SessaoFinanceiraLocal } from '@/lib/useFinanceiroIntegrado';
import { reaisParaCentavos } from '@/lib/centavosFinanceiros';
import { useCompartilhamento, type EstadoCompartilhamento } from '@/lib/useCompartilhamento';
import ContaCompartilhamento from '@/components/ContaCompartilhamento';
import type { EspacoSelecionado } from '@/components/Compartilhamento';
import { dataLocal, moeda, numero, resumir, type DadosPersistidos, type Lancamento } from '@/lib/gestao';

function Lembrete({ inicial, onSalvar, readOnly = false }: { inicial: string; onSalvar: (texto: string, base: string) => boolean | Promise<boolean>; readOnly?: boolean }) {
  const [base, setBase] = useState(inicial);
  const [texto, setTexto] = useState(inicial);
  const dirty = texto !== base;
  const visivel = dirty ? texto : inicial;
  return <section className="painel"><h2>Lembretes</h2><label className="campo"><span>O que você precisa lembrar?</span><textarea value={visivel} readOnly={readOnly} maxLength={500} placeholder="Manutenção, compromissos, metas…" onChange={e => { if (!dirty) setBase(inicial); setTexto(e.currentTarget.value); }} /></label>{!readOnly && <button className="botao secundario" type="button" onClick={async () => { if (await onSalvar(visivel, dirty ? base : inicial)) { setBase(visivel); setTexto(visivel); } }}>Salvar lembrete</button>}</section>;
}

function CabecalhoApp({ email, cadastroUid, readOnly, modoEscuro, saindo, convitePendente, contaAberta, onAbrirConta, onAlternarTema, onSair, onTrocarModulo }: {
  email: string | null;
  cadastroUid?: string;
  readOnly: boolean;
  modoEscuro: boolean;
  saindo: boolean;
  convitePendente: boolean;
  contaAberta: boolean;
  onAbrirConta?: () => void;
  onAlternarTema?: () => void;
  onSair?: () => Promise<void>;
  onTrocarModulo?: () => void;
}) {
  return <header className="cabecalho"><div className="container cabecalho-conteudo"><AppcarLogo subtitulo="Gestão do Motorista" /><div className="usuario">{cadastroUid ? <CadastroMotorista uid={cadastroUid} email={email} tema={modoEscuro ? 'escuro' : 'claro'} /> : <span>{email}</span>}{readOnly && <span className="selo">Somente visualização</span>}{onTrocarModulo && <button type="button" className="botao discreto" onClick={onTrocarModulo} title="Voltar à seleção de módulos">Módulos</button>}{onAbrirConta && <button type="button" className={`botao ${convitePendente && !contaAberta ? 'conta-acesso pendente' : 'conta-acesso'}`} onClick={onAbrirConta} aria-label={contaAberta ? 'Voltar ao painel principal' : 'Abrir conta e compartilhamento'}>{contaAberta ? 'Voltar ao painel' : 'Meus espaços'}{!contaAberta && convitePendente && <span className="selo convite-badge">Convite pendente</span>}</button>}{!readOnly && onAlternarTema && <button type="button" className="botao discreto" onClick={onAlternarTema}>{modoEscuro ? 'Modo claro' : 'Modo escuro'}</button>}{onSair && <button type="button" className="botao secundario" disabled={saindo} onClick={() => void onSair()}>{saindo ? 'Aguarde…' : 'Sair'}</button>}</div></div></header>;
}

type DashboardProps = {
  uid: string; email: string | null; readOnly?: boolean; viewerUid?: string;
  sharing?: EstadoCompartilhamento; espacoSelecionado?: EspacoSelecionado;
  onSelecionarEspaco?: (ownerUid: EspacoSelecionado) => void; contaAberta?: boolean; onAbrirConta?: () => void;
  onTrocarModulo?: () => void;
};

export function Dashboard(props: DashboardProps) {
  const { uid, readOnly, viewerUid } = props;
  const storage = useGestao(uid, { readOnly, storageNamespace: readOnly && viewerUid ? `shared-${viewerUid}-${uid}` : undefined });
  return <PainelMotorista {...props} storage={storage} />;
}

export function DashboardFinanceiroLocal({ sessao }: { sessao: SessaoFinanceiraLocal }) {
  const financeiro = useFinanceiroIntegrado(sessao);
  return <PainelMotorista uid={sessao.uid} email={sessao.email} financeiro={financeiro} />;
}

async function tokenFinanceiro(uid: string) {
  const usuario = auth.currentUser;
  return usuario?.uid === uid && !usuario.isAnonymous ? usuario.getIdToken() : null;
}

function DashboardFinanceiroReal({ espacoId, viewerUid, ...props }: DashboardProps & { espacoId: string; viewerUid: string }) {
  const financeiro = useFinanceiroIntegrado({
    uid: viewerUid, titular: props.uid, espacoId, readOnly: Boolean(props.readOnly),
    obterToken: () => tokenFinanceiro(viewerUid),
  });
  return <PainelMotorista {...props} viewerUid={viewerUid} financeiro={financeiro} />;
}

function ResolverDashboard({ viewerUid, ...props }: DashboardProps & { viewerUid: string }) {
  const [destino, setDestino] = useState<{ modo: 'legado' } | { modo: 'integrado'; espacoId: string }>();
  const [erro, setErro] = useState('');
  const [tentativa, setTentativa] = useState(0);
  useEffect(() => {
    const abortar = new AbortController();
    void (async () => {
      const token = await tokenFinanceiro(viewerUid);
      if (!token) throw new Error('Sessão indisponível.');
      const resposta = await fetch(`/api/financeiro?destino=1&titular=${encodeURIComponent(props.uid)}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', redirect: 'error',
        signal: AbortSignal.any([abortar.signal, AbortSignal.timeout(12000)]),
      });
      if (!resposta.ok) throw new Error('Destino financeiro indisponível.');
      const corpo = await resposta.json();
      if (abortar.signal.aborted) return;
      if (corpo.modo === 'legado') setDestino({ modo: 'legado' });
      else if (corpo.modo === 'integrado' && typeof corpo.espacoId === 'string') {
        setDestino({ modo: 'integrado', espacoId: corpo.espacoId });
      } else throw new Error('Destino financeiro inválido.');
    })().catch(() => {
      if (!abortar.signal.aborted) setErro('Não foi possível confirmar o destino financeiro. Tente novamente.');
    });
    return () => abortar.abort();
  }, [props.uid, viewerUid, tentativa]);

  if (destino?.modo === 'legado') return <Dashboard {...props} viewerUid={viewerUid} />;
  if (destino?.modo === 'integrado') return <DashboardFinanceiroReal {...props} viewerUid={viewerUid} espacoId={destino.espacoId} />;
  return <main className="acesso"><section className="painel pilha compacta">
    <AppcarLogo centralizado />
    <p role={erro ? 'alert' : 'status'}>{erro || 'Confirmando o espaço financeiro…'}</p>
    {erro && <button type="button" className="botao primario" onClick={() => { setErro(''); setTentativa(v => v + 1); }}>Tentar novamente</button>}
    {props.onTrocarModulo && <button type="button" className="botao secundario" onClick={props.onTrocarModulo}>Voltar aos módulos</button>}
  </section></main>;
}

type OrigemPainel = { storage: ReturnType<typeof useGestao>; financeiro?: never }
  | { financeiro: ReturnType<typeof useFinanceiroIntegrado>; storage?: never };

function PainelMotorista({ uid, email, readOnly = false, viewerUid, sharing, espacoSelecionado, onSelecionarEspaco, contaAberta = false, onAbrirConta, onTrocarModulo, storage, financeiro }: DashboardProps & OrigemPainel) {
  const dados = financeiro ? financeiro.dados : storage?.dados;
  const [aba, setAba] = useState('turno');
  const [editando, setEditando] = useState<Lancamento>();
  const [estorno, setEstorno] = useState<{ item: Lancamento; base: DadosPersistidos }>();
  const [formVersao, setFormVersao] = useState(0);
  const [recuperacaoVersao, setRecuperacaoVersao] = useState(0);
  const [mes, setMes] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [confirmacao, setConfirmacao] = useState<{ titulo: string; descricao: string; confirmar: string; executar: () => void }>();
  const [saindo, setSaindo] = useState(false);
  if (!dados && financeiro) return <main className="app"><div className="container conteudo pilha">
    {readOnly ? <section className="painel pilha compacta">
      <p role={financeiro.erro ? 'alert' : 'status'}>{financeiro.erro || 'Carregando espaço compartilhado…'}</p>
      {financeiro.erro && <button type="button" className="botao secundario" onClick={() => void financeiro.atualizar()}>Tentar novamente</button>}
    </section> : <FilaNoPainel financeiro={financeiro} />}
    {onTrocarModulo && <div><button type="button" className="botao secundario" onClick={onTrocarModulo}>Voltar aos módulos</button></div>}
  </div></main>;
  if (!dados && !storage) return null;
  if (!dados) return <main className="acesso"><section className="painel"><AppcarLogo subtitulo="Carregando..." centralizado /><h1>{storage?.erro ? 'Vamos recuperar seus dados' : 'Carregando seu painel'}</h1><p role={storage?.erro ? 'alert' : 'status'}>{storage?.erro || storage?.status}</p>{storage?.erro && <button className="botao primario" onClick={storage.tentarNovamente}>Tentar novamente</button>}</section></main>;
  const resumo = resumir(dados.historico);
  const bloquearEnvio = Boolean(financeiro && !financeiro.podeSalvar);
  const paraCentavos = (valor: string) => reaisParaCentavos(numero(valor));
  const registrar = async (base: typeof dados, criarComando: () => Record<string, unknown>) => {
    setMensagem('');
    try { return await financeiro?.registrar(base, criarComando()) ?? false; }
    catch (erro) { setMensagem(erro instanceof Error ? erro.message : 'Confira os valores da operação.'); return false; }
  };
  const editar = (item: Lancamento) => { setEditando(item); setFormVersao(v => v + 1); setAba('turno'); setMensagem(''); window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); };
  const excluir = async (item: Lancamento) => {
    const salvo = financeiro
      ? await financeiro.registrar(dados, { tipo: 'excluir', lancamentoId: item.id })
      : storage?.atualizar(d => ({ ...d, historico: d.historico.filter(h => h.id !== item.id) }), dados);
    if (!salvo) return;
    if (editando?.id === item.id) { setEditando(undefined); setFormVersao(v => v + 1); }
    if (!financeiro) setMensagem('Lançamento excluído. Relatórios atualizados.');
  };
  const pedirExclusao = (item: Lancamento) => setConfirmacao({ titulo: 'Excluir lançamento?', descricao: `Registro de ${item.data}: ${item.descricao || 'Turno de trabalho'}. Ele será removido do histórico e os relatórios serão recalculados.`, confirmar: 'Excluir lançamento', executar: () => excluir(item) });
  const abrirEstorno = financeiro && !readOnly && !bloquearEnvio
    ? (item: Lancamento) => setEstorno({ item, base: dados }) : undefined;
  const alternarTema = storage ? () => { storage.atualizar(d => ({ ...d, modoEscuro: !d.modoEscuro })); }
    : financeiro?.producao && !bloquearEnvio
      ? () => { void registrar(dados, () => ({ tipo: 'preferencias', modoEscuro: !dados.modoEscuro })); } : undefined;
  const salvarLembrete = (lembrete: string, base: string) => {
    if (financeiro?.producao) {
      if (dados.lembrete === base) return registrar(dados, () => ({ tipo: 'preferencias', lembrete }));
      setMensagem('O lembrete mudou em outro dispositivo. Confira a versão atual antes de salvar.');
      return false;
    }
    const salvo = storage?.atualizar(d => ({ ...d, lembrete }), { ...dados, lembrete: base });
    if (salvo) setMensagem('Lembrete salvo localmente. Confira o estado da sincronização.');
    return Boolean(salvo);
  };
  const escolher = (origem: 'local' | 'nuvem') => {
    if (!storage) return;
    const versaoNuvem = storage.versaoNuvem;
    setConfirmacao({ titulo: origem === 'local' ? 'Usar a versão deste navegador?' : 'Usar a versão da nuvem?', descricao: origem === 'local' ? 'Os dados deste navegador substituirão a versão da nuvem. As versões não serão mescladas. Antes da troca, as duas cópias serão preservadas neste navegador.' : 'Os dados da nuvem substituirão os dados em uso neste navegador. As versões não serão mescladas. Antes da troca, as duas cópias serão preservadas neste navegador.', confirmar: 'Confirmar escolha', executar: async () => { if (await storage.resolver(origem, versaoNuvem)) { setRecuperacaoVersao(v => v + 1); setEditando(undefined); setFormVersao(v => v + 1); } } });
  };
  const exportar = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `appcar-backup-${dataLocal()}.json`; link.click(); URL.revokeObjectURL(url);
  };
  const contaView = contaAberta && sharing && espacoSelecionado !== undefined && onSelecionarEspaco && onAbrirConta
    ? <ContaCompartilhamento estado={sharing} selecionado={espacoSelecionado} onSelecionar={onSelecionarEspaco} onVoltar={onAbrirConta} />
    : null;
  return <main className={`app ${dados.modoEscuro ? 'escuro' : 'claro'}`}>
    {confirmacao && <Confirmacao titulo={confirmacao.titulo} descricao={confirmacao.descricao} confirmar={confirmacao.confirmar} onCancelar={() => setConfirmacao(undefined)} onConfirmar={() => { confirmacao.executar(); setConfirmacao(undefined); }} />}
    {estorno && <div className="overlay-modal" role="dialog" aria-modal="true" aria-labelledby="titulo-estorno">
      <form className="painel modal-conteudo pilha" onSubmit={evento => {
        evento.preventDefault();
        const motivo = String(new FormData(evento.currentTarget).get('motivo') ?? '').trim();
        if (!motivo) return;
        void registrar(estorno.base, () => ({ tipo: 'estornar', lancamentoId: estorno.item.id, motivo }))
          .then(enviado => { if (enviado) setEstorno(undefined); });
      }}>
        <h2 id="titulo-estorno">Estornar lançamento</h2>
        <p>O lançamento de {estorno.item.data} será preservado no histórico. O estorno retira seu efeito dos saldos e relatórios.</p>
        <label className="campo"><span>Motivo do estorno</span><textarea name="motivo" required maxLength={300} /></label>
        <div className="acoes">
          <button type="button" className="botao secundario" onClick={() => setEstorno(undefined)}>Cancelar</button>
          <button type="submit" className="botao perigo" disabled={bloquearEnvio}>Confirmar estorno</button>
        </div>
      </form>
    </div>}
    <CabecalhoApp email={email} cadastroUid={!readOnly && viewerUid === uid ? uid : undefined} readOnly={readOnly} modoEscuro={dados.modoEscuro} saindo={saindo} convitePendente={Boolean(sharing?.pendentes.length || sharing?.meuConvite?.status === 'pending')} contaAberta={contaAberta} onAbrirConta={onAbrirConta} onAlternarTema={alternarTema} onTrocarModulo={onTrocarModulo} onSair={storage || financeiro?.producao ? async () => {
      setSaindo(true); try { await storage?.aguardar(); await signOut(auth); } catch { setMensagem('Não foi possível sair. Tente novamente em instantes.'); } finally { setSaindo(false); }
    } : undefined} />
    {contaView ? <div className="container conteudo">{contaView}</div> : <div className="container conteudo">
      {(storage || financeiro?.producao) && <VerificarEmail />}
      <div className="boas-vindas"><div><p className="sobretitulo">{readOnly ? 'ESPAÇO COMPARTILHADO' : 'GESTÃO DO MOTORISTA'}</p><h1>{readOnly ? 'Dados do proprietário' : 'Seu painel de trabalho'}</h1><p>{readOnly ? 'Você está consultando este espaço em modo Somente visualização.' : 'Acompanhe cada turno e dê um destino ao seu dinheiro.'}</p></div><div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>{!readOnly && <button className="botao secundario" type="button" onClick={exportar}>Exportar backup</button>}</div></div>
      {onAbrirConta && <div className="espaco-atual" role="status"><span>Espaço atual</span><strong>{readOnly ? 'Compartilhado · Somente visualização' : 'Meus dados'}</strong><button type="button" className="botao discreto" onClick={onAbrirConta}>Espaços compartilhados</button></div>}
      {financeiro && (readOnly
        ? <div className="barra-status"><p role={financeiro.erro ? 'alert' : 'status'}>{financeiro.erro || 'Espaço compartilhado · dados confirmados'}</p>
          <button type="button" className="botao discreto" onClick={() => void financeiro.atualizar()}>Atualizar</button></div>
        : <FilaNoPainel financeiro={financeiro} />)}
      {storage && <div className="barra-status"><span className="ponto" /><p role="status">{storage.status}</p><button type="button" className="botao discreto" onClick={storage.tentarNovamente}>Verificar sincronização</button></div>}
      {!readOnly && storage && storage.recuperacoes.length > 0 && <section className="painel aviso"><h2>Cópias locais de outras sessões</h2><p>Há cópias com alterações pendentes neste navegador. Recuperar uma cópia preserva os dados atuais e exige comparação com a nuvem.</p>{storage.recuperacoes.map((copia, indice) => <button key={copia.key} type="button" className="botao secundario" onClick={() => setConfirmacao({ titulo: 'Recuperar cópia local?', descricao: 'Os dados atuais serão preservados antes da recuperação. Nenhuma gravação na nuvem será feita automaticamente.', confirmar: 'Recuperar cópia', executar: () => { if (storage.recuperar(copia.key)) { setRecuperacaoVersao(v => v + 1); setEditando(undefined); setFormVersao(v => v + 1); } } })}>Recuperar cópia {indice + 1} ({copia.data.historico.length} lançamentos)</button>)}</section>}
      {storage?.erro && <p role="alert" className="mensagem erro">{storage.erro}</p>}
      {!readOnly && storage?.conflito && <section className="painel aviso" aria-labelledby="titulo-conflito"><h2 id="titulo-conflito">Escolha a versão dos seus dados</h2><p>Este navegador e a nuvem têm dados diferentes. Compare as versões antes de escolher. Elas não serão mescladas.</p><div className="comparacao-versoes">{[['Neste navegador', dados], ['Na nuvem', storage.dadosNuvem]].map(([nome, versao]) => {
        if (!versao || typeof versao === 'string') return null;
        const resumoVersao = resumir(versao.historico);
        return <div key={String(nome)}><h3>{String(nome)}</h3><p>{versao.historico.length} lançamentos</p><p>Saldo principal: <strong data-saldo={sinalSaldo(resumoVersao.liquido)}>{moeda(resumoVersao.liquido)}</strong></p></div>;
      })}</div><p>As duas cópias serão guardadas neste navegador antes da troca. A quantidade de lançamentos não indica qual versão é mais recente. Você também pode exportar um backup dos dados em uso.</p>{storage.geracaoAnterior && <p className="mensagem aviso">Esta cópia pertence a uma geração anterior à reinicialização. Exporte-a se precisar consultar os registros antigos. Ela não pode substituir os dados atuais.</p>}<div className="acoes"><button type="button" className="botao primario" disabled={storage.geracaoAnterior} onClick={() => escolher('local')}>Usar dados deste navegador</button><button type="button" className="botao secundario" onClick={() => escolher('nuvem')}>Usar dados da nuvem</button></div></section>}
      <div className="grade-metricas"><div className="metrica"><span>Faturamento acumulado</span><strong>{moeda(resumo.faturamento)}</strong><small>Todo o histórico</small></div><div className="metrica destaque" data-saldo={sinalSaldo(resumo.liquido)}><span>Saldo principal</span><strong>{moeda(resumo.liquido)}</strong><small>Após despesas e reservas</small></div><div className="metrica"><span>Combustível acumulado</span><strong>{moeda(resumo.combustivel)}</strong><small>Todos os abastecimentos</small></div><div className="metrica"><span>Dias trabalhados</span><strong>{resumo.dias}</strong><small>{dados.historico.length} lançamentos salvos</small></div></div>
      <nav className="abas" aria-label="Seções do painel">{[['turno','Registrar turno'], ['caixinhas','Caixinhas'], ['relatorios','Histórico e relatórios'], ['configuracoes','Custos fixos'], ['privacidade','Privacidade']].map(([id, nome]) => <button type="button" key={id} aria-current={aba === id ? 'page' : undefined} onClick={() => setAba(id)}>{nome}</button>)}</nav>
      {mensagem && <p role={financeiro ? 'alert' : 'status'} className={`mensagem ${financeiro ? 'erro' : 'sucesso'}`}>{mensagem}</p>}
      <div hidden={aba !== 'turno'} className="pilha">
        {!readOnly && <TurnoForm key={`${editando?.id || 'novo'}-${formVersao}-${financeiro ? 'servico' : dados._sync?.generation ?? 0}`} dados={dados} original={editando} bloquearEnvio={bloquearEnvio}
          onComando={financeiro && ((form, base) => {
            void registrar(base, () => ({
              tipo: 'turno', ...(editando && { lancamentoId: editando.id }), data: form.data,
              faturamentoCentavos: paraCentavos(form.faturamento), combustivelCentavos: paraCentavos(form.combustivel),
              litrosCentesimos: paraCentavos(form.litros), kmTrabalhadoCentesimos: paraCentavos(form.kmTrabalhado),
              kmTotalCentesimos: paraCentavos(form.kmTotal), reserva1Centavos: paraCentavos(form.reserva1),
              reserva2Centavos: paraCentavos(form.reserva2),
              reservas: form.reservas.map(reserva => ({ id: reserva.id, nome: reserva.nome, valorCentavos: paraCentavos(reserva.valor) })),
            })).then(salvo => { if (salvo) { setEditando(undefined); setFormVersao(v => v + 1); } });
          })}
          onCancelar={() => { setEditando(undefined); setFormVersao(v => v + 1); }} onSalvar={(item, base) => {
          const salvo = storage?.atualizar(d => ({ ...d, historico: editando ? d.historico.map(h => h.id === item.id ? item : h) : [item, ...d.historico],
            reservasDiarias: editando ? d.reservasDiarias : (item.reservasDiariasDia ?? []).map(r => ({ ...r, valor: 0 })) }), base);
          if (salvo) { setMensagem(editando ? 'Alterações salvas no turno original.' : 'Turno registrado com sucesso.'); setEditando(undefined); setFormVersao(v => v + 1); }
        }} />}
        {!readOnly && <AvulsoForm key={`avulso-${recuperacaoVersao}-${financeiro ? 'servico' : dados._sync?.generation ?? 0}`} dados={dados} caixinhas={financeiro?.caixinhas?.relatorio.caixinhas} bloquearEnvio={bloquearEnvio}
          onComando={financeiro && ((form, base) => registrar(base, () => ({
            tipo: form.tipo === 'entrada' ? 'entrada' : 'retirada', data: form.data, descricao: form.nome.trim(),
            valorCentavos: paraCentavos(form.valor), ...(form.tipo !== 'entrada' && { origem: form.origem }),
          })))}
          onSalvar={(item, base) => { const salvo = storage?.atualizar(d => ({ ...d, historico: [item, ...d.historico] }), base); if (salvo) setMensagem('Movimentação registrada.'); return Boolean(salvo); }} />}
        <Lembrete key={`lembrete-${recuperacaoVersao}-${dados._sync?.generation ?? 0}`} inicial={dados.lembrete} readOnly={readOnly || Boolean(financeiro && (!financeiro.producao || bloquearEnvio))} onSalvar={salvarLembrete} />
        <Historico itens={dados.historico.slice(0, 10)} onEditar={readOnly ? undefined : editar} onExcluir={readOnly || financeiro ? undefined : pedirExclusao} onEstornar={abrirEstorno} />
      </div>
      {aba === 'caixinhas' && (
        <GestaoCaixinhas
          dados={dados}
          readOnly={readOnly || !financeiro?.caixinhas?.acoes.length}
          bloquearEnvio={bloquearEnvio}
          leitura={financeiro?.caixinhas}
          onComando={financeiro?.caixinhas ? (alteracao, base) => registrar(base, () => alteracao) : undefined}
        />
      )}
      {aba === 'relatorios' && <Relatorios dados={dados} caixinhas={financeiro?.caixinhas?.relatorio} onVerCaixinhas={() => setAba('caixinhas')} mes={mes} onMes={setMes} onEditar={readOnly ? undefined : editar} onExcluir={readOnly || financeiro ? undefined : pedirExclusao} onEstornar={abrirEstorno} />}
      {aba === 'configuracoes' && <CustosFixos key={`${recuperacaoVersao}-${financeiro ? 'servico' : dados._sync?.generation ?? 0}`}
        itens={dados.custosFixos} versao={dados._sync} readOnly={readOnly || Boolean(financeiro && !financeiro.producao)}
        bloquearEnvio={bloquearEnvio} onComando={financeiro?.producao ? (itens, base) => registrar({ ...dados, _sync: base }, () => ({
          tipo: 'custos-fixos',
          itens: itens.map(({ id, nome, valorMensal, cor }) => ({ id, nome, valorMensalCentavos: reaisParaCentavos(valorMensal), ...(cor && { cor }) })),
        })) : undefined}
        onSalvar={(custosFixos, base) => { const salvo = storage?.atualizar(d => ({ ...d, custosFixos }), { ...dados, custosFixos: base }); if (salvo) setMensagem('Custos salvos localmente. Os turnos antigos mantêm o rateio original.'); return Boolean(salvo); }} />}
      {aba === 'privacidade' && <div className="pilha"><Privacidade uid={uid} email={email} dados={dados} dadosNuvem={storage?.dadosNuvem ?? (financeiro?.producao ? dados : null)} readOnly={readOnly || Boolean(financeiro && !financeiro.producao)} />{!readOnly && storage && <ReiniciarDados uid={uid} email={email} plan={storage.reinicio} prepare={storage.prepararReinicio} backup={storage.backupReinicio} exported={storage.marcarBackupExportado} execute={storage.executarReinicio} check={storage.verificarReinicio} onComplete={() => { setRecuperacaoVersao(v => v + 1); setEditando(undefined); setFormVersao(v => v + 1); }} />}</div>}
      <footer>APPCAR · Gestão do seu trabalho · Versão reconstruída</footer>
    </div>}
  </main>;
}

export default function Home() {
  const [sessao, setSessao] = useState<{ uid: string; email: string | null } | null>();
  const [erro, setErro] = useState('');
  useEffect(() => onAuthStateChanged(auth, (usuario: User | null) => {
    setSessao(usuario && !usuario.isAnonymous ? { uid: usuario.uid, email: usuario.email } : null);
  }, (falha: Error) => { setErro(falha.message); setSessao(null); }), []);
  if (sessao === undefined) return <main className="acesso"><p role="status">Verificando sua conta…</p></main>;
  if (!sessao) return <>{erro && <p role="alert" className="mensagem erro">Não foi possível verificar a sessão. Tente entrar novamente.</p>}<AuthGate /></>;
  return <AuthenticatedApp key={sessao.uid} sessao={sessao} />;
}

function AuthenticatedApp({ sessao }: { sessao: { uid: string; email: string | null } }) {
  const sharing = useCompartilhamento(sessao.uid, sessao.email);
  const [espaco, setEspaco] = useState<EspacoSelecionado>('proprio');
  const [verificacaoFinanceiro, setVerificacaoFinanceiro] = useState<{
    uid: string; hashEsperado: string; autorizado: boolean;
  } | null>(null);
  const [contaAberta, setContaAberta] = useState(false);
  const [modulo, setModulo] = useState<'selecao' | 'motorista' | 'familiar'>('selecao');

  const espacoAtivo = espaco !== 'proprio' && sharing.ativos.some(convite => convite.ownerUid === espaco) ? espaco : 'proprio';
  const compartilhado = espacoAtivo !== 'proprio' ? sharing.ativos.find(convite => convite.ownerUid === espacoAtivo) : undefined;

  useEffect(() => {
    let vigente = true;
    const esperado = process.env.NEXT_PUBLIC_APPCAR_FINANCEIRO_UID_SHA256?.toLowerCase();
    if (espacoAtivo !== 'proprio' || !esperado || !/^[a-f0-9]{64}$/.test(esperado) || !globalThis.crypto?.subtle) {
      return () => { vigente = false; };
    }
    void globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(sessao.uid))
      .then(hash => {
        if (!vigente) return;
        const atual = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
        setVerificacaoFinanceiro({ uid: sessao.uid, hashEsperado: esperado, autorizado: atual === esperado });
      })
      .catch(() => { if (vigente) setVerificacaoFinanceiro({ uid: sessao.uid, hashEsperado: esperado, autorizado: false }); });
    return () => { vigente = false; };
  }, [espacoAtivo, sessao.uid]);

  const handleSair = async () => {
    await signOut(auth);
  };

  if (modulo === 'selecao') {
    return (
      <ModuloSelecao
        email={sessao.email}
        onSelecionar={(mod) => setModulo(mod)}
        onSair={handleSair}
      />
    );
  }

  if (modulo === 'familiar') {
    return (
      <GestaoFamiliar
        email={sessao.email}
        onVoltar={() => setModulo('selecao')}
        onSair={handleSair}
      />
    );
  }

  const hashFinanceiroConfigurado = process.env.NEXT_PUBLIC_APPCAR_FINANCEIRO_UID_SHA256?.toLowerCase();
  const financeiroAutorizado = espacoAtivo === 'proprio'
    && verificacaoFinanceiro?.uid === sessao.uid
    && verificacaoFinanceiro.hashEsperado === hashFinanceiroConfigurado
    && verificacaoFinanceiro.autorizado;
  const Painel = financeiroAutorizado ? ResolverDashboard : Dashboard;
  return (
    <Painel
      key={`${sessao.uid}-${espacoAtivo}`}
      uid={compartilhado?.ownerUid || sessao.uid}
      email={sessao.email}
      readOnly={Boolean(compartilhado)}
      viewerUid={sessao.uid}
      sharing={sharing}
      espacoSelecionado={espacoAtivo}
      onSelecionarEspaco={valor => { setVerificacaoFinanceiro(null); setEspaco(valor); }}
      contaAberta={contaAberta}
      onAbrirConta={() => setContaAberta(value => !value)}
      onTrocarModulo={() => setModulo('selecao')}
    />
  );
}
