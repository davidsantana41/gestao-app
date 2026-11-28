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
import IndicadorConexao, { type EstadoConexao } from '@/components/gestao/IndicadorConexao';
import AppShell, { definirSecaoInicial, useNavegacaoApp } from '@/components/gestao/AppShell';
import RecuperacaoFilaLegada from '@/components/gestao/RecuperacaoFilaLegada';
import TurnoForm from '@/components/gestao/TurnoForm';
import CustosFixos from '@/components/gestao/CustosFixos';
import AvulsoForm from '@/components/gestao/AvulsoForm';
import { sinalSaldo } from '@/components/gestao/saldo';
import Relatorios from '@/components/gestao/Relatorios';
import GestaoCaixinhas from '@/components/gestao/GestaoCaixinhas';
import { auth } from '@/lib/firebase';
import { useGestao } from '@/lib/useGestao';
import { useFinanceiroIntegrado, type SessaoFinanceiraLocal } from '@/lib/useFinanceiroIntegrado';
import { reaisParaCentavos } from '@/lib/centavosFinanceiros';
import { useCompartilhamento, type EstadoCompartilhamento } from '@/lib/useCompartilhamento';
import ContaCompartilhamento from '@/components/ContaCompartilhamento';
import type { EspacoSelecionado } from '@/components/Compartilhamento';
import { calcularSaldosFinanceiros, dataLocal, moeda, numero, resumir, type DadosPersistidos, type Lancamento } from '@/lib/gestao';

function Lembrete({ inicial, onSalvar, readOnly = false }: { inicial: string; onSalvar: (texto: string, base: string) => boolean | Promise<boolean>; readOnly?: boolean }) {
  const [base, setBase] = useState(inicial);
  const [texto, setTexto] = useState(inicial);
  const dirty = texto !== base;
  const visivel = dirty ? texto : inicial;
  return <section className="painel"><h2>Lembretes</h2><label className="campo"><span>O que você precisa lembrar?</span><textarea value={visivel} readOnly={readOnly} maxLength={500} placeholder="Manutenção, compromissos, metas…" onChange={e => { if (!dirty) setBase(inicial); setTexto(e.currentTarget.value); }} /></label>{!readOnly && <button className="botao secundario" type="button" onClick={async () => { if (await onSalvar(visivel, dirty ? base : inicial)) { setBase(visivel); setTexto(visivel); } }}>Salvar lembrete</button>}</section>;
}

type DashboardProps = {
  uid: string; email: string | null; readOnly?: boolean; viewerUid?: string;
  sharing?: EstadoCompartilhamento; espacoSelecionado?: EspacoSelecionado;
  onSelecionarEspaco?: (ownerUid: EspacoSelecionado) => void;
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

  useEffect(() => {
    if (!erro || destino) return;
    const repetir = window.setTimeout(() => { setErro(''); setTentativa(v => v + 1); }, 15000);
    return () => window.clearTimeout(repetir);
  }, [erro, destino]);

  if (destino?.modo === 'legado') return <Dashboard {...props} viewerUid={viewerUid} />;
  if (destino?.modo === 'integrado') return <DashboardFinanceiroReal {...props} viewerUid={viewerUid} espacoId={destino.espacoId} />;
  return <main className="app">
    <header className="cabecalho"><div className="container cabecalho-conteudo"><AppcarLogo subtitulo="Gestão do Motorista" /><div className="usuario"><IndicadorConexao estado={erro ? 'indisponivel' : 'sincronizando'} />{props.onTrocarModulo && <button type="button" className="botao discreto" onClick={props.onTrocarModulo}>Módulos</button>}</div></div></header>
    <div className="container conteudo"><section className="painel painel-carregando" aria-busy="true">
      <h1>Painel do motorista</h1><p role={erro ? 'alert' : 'status'}>{erro ? 'Não foi possível carregar os dados confirmados. Tentando novamente…' : 'Carregando dados financeiros confirmados…'}</p>
    </section></div>
  </main>;
}

type OrigemPainel = { storage: ReturnType<typeof useGestao>; financeiro?: never }
  | { financeiro: ReturnType<typeof useFinanceiroIntegrado>; storage?: never };

function PainelMotorista({ uid, email, readOnly = false, viewerUid, sharing, espacoSelecionado, onSelecionarEspaco, onTrocarModulo, storage, financeiro }: DashboardProps & OrigemPainel) {
  const dados = financeiro ? financeiro.dados : storage?.dados;
  const { secao, navegar } = useNavegacaoApp(Boolean(sharing && onSelecionarEspaco));
  const [editando, setEditando] = useState<Lancamento>();
  const [estorno, setEstorno] = useState<{ item: Lancamento; base: DadosPersistidos }>();
  const [formVersao, setFormVersao] = useState(0);
  const [recuperacaoVersao, setRecuperacaoVersao] = useState(0);
  const [mes, setMes] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [confirmacao, setConfirmacao] = useState<{ titulo: string; descricao: string; confirmar: string; executar: () => void }>();
  const estadoConexao: EstadoConexao | undefined = financeiro
    ? !financeiro.conectada ? 'offline'
      : financeiro.servicoDisponivel === false ? 'indisponivel'
        : financeiro.sincronizando || financeiro.ocupado || financeiro.servicoDisponivel === null ? 'sincronizando' : 'conectado'
    : undefined;
  if (!dados && financeiro) return <main className="app">
    <header className="cabecalho"><div className="container cabecalho-conteudo"><AppcarLogo subtitulo="Gestão do Motorista" /><div className="usuario">{estadoConexao && <IndicadorConexao estado={estadoConexao} />}{onTrocarModulo && <button type="button" className="botao discreto" onClick={onTrocarModulo}>Módulos</button>}</div></div></header>
    <div className="container conteudo"><section className="painel painel-carregando" aria-busy="true"><h1>{readOnly ? 'Espaço compartilhado' : 'Painel do motorista'}</h1><p role={financeiro.erro ? 'alert' : 'status'}>{financeiro.erro ? 'Não foi possível carregar os dados confirmados. Tentando novamente…' : 'Carregando dados financeiros confirmados…'}</p></section></div>
  </main>;
  if (!dados && !storage) return null;
  if (!dados) return <main className="acesso"><section className="painel"><AppcarLogo subtitulo="Carregando..." centralizado /><h1>{storage?.erro ? 'Vamos recuperar seus dados' : 'Carregando seu painel'}</h1><p role={storage?.erro ? 'alert' : 'status'}>{storage?.erro || storage?.status}</p>{storage?.erro && <button className="botao primario" onClick={storage.tentarNovamente}>Tentar novamente</button>}</section></main>;
  const resumo = resumir(dados.historico);
    const relatorioCaixinhas = financeiro?.caixinhas?.relatorio;
    const saldos = calcularSaldosFinanceiros(dados.historico,
      relatorioCaixinhas?.caixinhas.every(caixa => caixa.saldoAtestado) ? relatorioCaixinhas.totalSaldoCentavos : null);
  const bloquearEnvio = Boolean(financeiro && !financeiro.podeSalvar);
  const paraCentavos = (valor: string) => reaisParaCentavos(numero(valor));
  const registrar = async (base: typeof dados, criarComando: () => Record<string, unknown>) => {
    setMensagem('');
    try { return await financeiro?.registrar(base, criarComando()) ?? false; }
    catch (erro) { setMensagem(erro instanceof Error ? erro.message : 'Confira os valores da operação.'); return false; }
  };
  const editar = (item: Lancamento) => { setEditando(item); setFormVersao(v => v + 1); navegar('turno'); setMensagem(''); window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); };
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
  const emailCompartilhado = email ?? 'Conta APPCAR';
  return <AppShell modoEscuro={dados.modoEscuro} secao={secao} onNavegar={navegar} email={emailCompartilhado}
    somenteLeitura={readOnly} conexao={estadoConexao} onPerfil={(viewerUid || storage) ? () => navegar('configuracoes') : undefined}
    mostrarEspacos={Boolean(sharing && onSelecionarEspaco)} convitePendente={Boolean(sharing?.pendentes.length || sharing?.meuConvite?.status === 'pending')} onModulos={onTrocarModulo}
    onSair={storage || financeiro?.producao ? async () => {
      try { await storage?.aguardar(); await signOut(auth); }
      catch { setMensagem('Não foi possível sair. Tente novamente em instantes.'); }
    } : undefined}>
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
    <div className="container conteudo app-pages">
      {(storage || financeiro?.producao) && <VerificarEmail />}
      {financeiro && (!financeiro.conectada || financeiro.servicoDisponivel === false) && <p className="barra-status" role="status">
        {!financeiro.conectada ? 'Sem conexão. Os campos serão preservados e novas gravações estão bloqueadas.' : 'Serviço financeiro indisponível. Reconectando automaticamente…'}
      </p>}
      {storage?.erro && <p role="alert" className="mensagem erro">{storage.erro}</p>}
      {!readOnly && storage?.conflito && <section className="painel aviso" aria-labelledby="titulo-conflito"><h2 id="titulo-conflito">Escolha a versão dos seus dados</h2><p>Este navegador e a nuvem têm dados diferentes. Compare as versões antes de escolher. Elas não serão mescladas.</p><div className="comparacao-versoes">{[['Neste navegador', dados], ['Na nuvem', storage.dadosNuvem]].map(([nome, versao]) => {
        if (!versao || typeof versao === 'string') return null;
        const resumoVersao = resumir(versao.historico);
        return <div key={String(nome)}><h3>{String(nome)}</h3><p>{versao.historico.length} lançamentos</p><p>Saldo principal: <strong data-saldo={sinalSaldo(resumoVersao.liquido)}>{moeda(resumoVersao.liquido)}</strong></p></div>;
      })}</div><p>As duas cópias serão guardadas neste navegador antes da troca. A quantidade de lançamentos não indica qual versão é mais recente. Você também pode exportar um backup dos dados em uso.</p>{storage.geracaoAnterior && <p className="mensagem aviso">Esta cópia pertence a uma geração anterior à reinicialização. Exporte-a se precisar consultar os registros antigos. Ela não pode substituir os dados atuais.</p>}<div className="acoes"><button type="button" className="botao primario" disabled={storage.geracaoAnterior} onClick={() => escolher('local')}>Usar dados deste navegador</button><button type="button" className="botao secundario" onClick={() => escolher('nuvem')}>Usar dados da nuvem</button></div></section>}
      {mensagem && <p role={financeiro ? 'alert' : 'status'} className={`mensagem ${financeiro ? 'erro' : 'sucesso'}`}>{mensagem}</p>}

      <section id="pagina-visao-geral" className="app-page" tabIndex={-1} hidden={secao !== 'visao-geral'} aria-labelledby="titulo-visao-geral">
        <div className="boas-vindas"><div><p className="sobretitulo">GESTÃO DO MOTORISTA</p><h1 id="titulo-visao-geral">Visão geral</h1><p>{readOnly ? 'Resumo do espaço em modo somente visualização.' : 'Acompanhe seus resultados e acesse as principais tarefas.'}</p></div></div>
                <div className="grade-metricas"><div className="metrica"><span>Faturamento acumulado</span><strong>{moeda(resumo.faturamento)}</strong><small>Todo o histórico</small></div><div className="metrica destaque" data-saldo={sinalSaldo(resumo.liquido)}><span>Saldo principal</span><strong>{moeda(resumo.liquido)}</strong><small>Após despesas e reservas</small></div><div className="metrica"><span>Total reservado nas caixinhas</span><strong>{saldos.reservadoCentavos === null ? 'Em revisão' : moeda(saldos.reservadoCentavos / 100)}</strong><small>Saldos atestados</small></div><div className="metrica"><span>Saldo financeiro consolidado</span><strong>{saldos.consolidadoCentavos === null ? 'Em revisão' : moeda(saldos.consolidadoCentavos / 100)}</strong><small>Principal + caixinhas</small></div><div className="metrica"><span>Combustível acumulado</span><strong>{moeda(resumo.combustivel)}</strong><small>Todos os abastecimentos</small></div><div className="metrica"><span>Dias trabalhados</span><strong>{resumo.dias}</strong><small>{dados.historico.length} lançamentos salvos</small></div></div>
        <section className="painel atalhos-painel"><h2>Acesso rápido</h2><div className="atalhos-grade">
          {!readOnly && <button type="button" className="botao primario" onClick={() => navegar('turno')}>Registrar turno</button>}
          <button type="button" className="botao secundario" onClick={() => navegar('caixinhas')}>Acessar caixinhas</button>
          <button type="button" className="botao secundario" onClick={() => navegar('relatorios')}>Consultar relatórios</button>
        </div></section>
      </section>

      <section id="pagina-turno" className="app-page pilha" tabIndex={-1} hidden={secao !== 'turno'} aria-labelledby="titulo-turno">
        <div className="boas-vindas"><div><p className="sobretitulo">GESTÃO DO MOTORISTA</p><h1 id="titulo-turno">Registrar turno</h1><p>Lançamento, abastecimento, quilometragem e reservas do turno.</p></div></div>
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
          const salvo = storage?.atualizar(d => {
            const reservasDiarias = (d.reservasDiarias ?? []).map(r => ({ ...r, valor: 0 }));
            if (!editando) for (const reserva of item.reservasDiariasDia ?? []) {
              const indices = reservasDiarias.flatMap((atual, indice) => atual.id === reserva.id ? [indice] : []);
              if (indices.length === 1) reservasDiarias[indices[0]] = { ...reservasDiarias[indices[0]], nome: reserva.nome };
              else if (indices.length === 0) reservasDiarias.push({ id: reserva.id, nome: reserva.nome, valor: 0 });
            }
            return { ...d, historico: editando ? d.historico.map(h => h.id === item.id ? item : h) : [item, ...d.historico], reservasDiarias };
          }, base);
          if (salvo) { setMensagem(editando ? 'Alterações salvas no turno original.' : 'Turno registrado com sucesso.'); setEditando(undefined); setFormVersao(v => v + 1); }
        }} />}
        {!readOnly && <AvulsoForm key={`avulso-${recuperacaoVersao}-${financeiro ? 'servico' : dados._sync?.generation ?? 0}`} dados={dados} caixinhas={financeiro?.caixinhas?.relatorio.caixinhas} bloquearEnvio={bloquearEnvio}
          onComando={financeiro && ((form, base) => registrar(base, () => ({
            tipo: form.tipo === 'entrada' ? 'entrada' : 'retirada', data: form.data, descricao: form.nome.trim(),
            valorCentavos: paraCentavos(form.valor), ...(form.tipo !== 'entrada' && { origem: form.origem }),
          })))}
          onSalvar={(item, base) => { const salvo = storage?.atualizar(d => ({ ...d, historico: [item, ...d.historico] }), base); if (salvo) setMensagem('Movimentação registrada.'); return Boolean(salvo); }} />}

      </section>

      <section id="pagina-caixinhas" className="app-page" tabIndex={-1} hidden={secao !== 'caixinhas'} aria-labelledby="titulo-caixinhas">
        <div className="boas-vindas"><div><p className="sobretitulo">GESTÃO DO MOTORISTA</p><h1 id="titulo-caixinhas">Caixinhas</h1></div></div>
                <GestaoCaixinhas
          dados={dados}
          readOnly={readOnly || !financeiro?.caixinhas?.acoes.length}
          motivoSomenteLeitura={readOnly ? 'Este espaço está em modo somente visualização.'
            : financeiro?.caixinhas && financeiro.caixinhas.acoes.length === 0
              ? 'O servidor não liberou comandos para este espaço. A consulta continua disponível; fale com o titular para revisar as permissões.' : undefined}
          bloquearEnvio={bloquearEnvio}
          motivoBloqueioEnvio={financeiro?.motivoBloqueio}
          leitura={financeiro?.caixinhas}
          onComando={financeiro?.caixinhas ? async (alteracao, base) => {
            const enviado = await registrar(base, () => alteracao);
            return enviado ? 'confirmada' : false;
          } : undefined}
        />
      </section>

      <section id="pagina-relatorios" className="app-page" tabIndex={-1} hidden={secao !== 'relatorios'} aria-labelledby="titulo-relatorios">
        <div className="boas-vindas"><div><p className="sobretitulo">GESTÃO DO MOTORISTA</p><h1 id="titulo-relatorios">Histórico e relatórios</h1></div></div>
        <Relatorios dados={dados} caixinhas={financeiro?.caixinhas?.relatorio} onVerCaixinhas={() => navegar('caixinhas')} mes={mes} onMes={setMes} onEditar={readOnly ? undefined : editar} onExcluir={readOnly || financeiro ? undefined : pedirExclusao} onEstornar={abrirEstorno} />
      </section>

      <section id="pagina-custos-fixos" className="app-page" tabIndex={-1} hidden={secao !== 'custos-fixos'} aria-labelledby="titulo-custos-fixos">
        <div className="boas-vindas"><div><p className="sobretitulo">GESTÃO DO MOTORISTA</p><h1 id="titulo-custos-fixos">Custos fixos</h1></div></div>
        <CustosFixos key={`${recuperacaoVersao}-${financeiro ? 'servico' : dados._sync?.generation ?? 0}`}
        itens={dados.custosFixos} versao={dados._sync} readOnly={readOnly || Boolean(financeiro && !financeiro.producao)}
        bloquearEnvio={bloquearEnvio} onComando={financeiro?.producao ? (itens, base) => registrar({ ...dados, _sync: base }, () => ({
          tipo: 'custos-fixos',
          itens: itens.map(({ id, nome, valorMensal, cor }) => ({ id, nome, valorMensalCentavos: reaisParaCentavos(valorMensal), ...(cor && { cor }) })),
        })) : undefined}
        onSalvar={(custosFixos, base) => { const salvo = storage?.atualizar(d => ({ ...d, custosFixos }), { ...dados, custosFixos: base }); if (salvo) setMensagem('Custos salvos localmente. Os turnos antigos mantêm o rateio original.'); return Boolean(salvo); }} />
      </section>

      {sharing && espacoSelecionado !== undefined && onSelecionarEspaco && <section id="pagina-espacos" className="app-page" tabIndex={-1} hidden={secao !== 'espacos'} aria-labelledby="titulo-espacos">
        <div className="boas-vindas"><div><p className="sobretitulo">CONTA E PREFERÊNCIAS</p><h1 id="titulo-espacos">Meus espaços</h1><p>Gerencie espaços pessoais e compartilhados sem misturar seus dados.</p></div></div>
        <div className="espaco-atual" role="status"><span>Espaço selecionado</span><strong>{readOnly ? 'Compartilhado · Somente visualização' : 'Meus dados'}</strong></div>
        <ContaCompartilhamento estado={sharing} selecionado={espacoSelecionado} onSelecionar={onSelecionarEspaco} onVoltar={() => navegar('visao-geral')} />
      </section>}

      <section id="pagina-configuracoes" className="app-page pilha" tabIndex={-1} hidden={secao !== 'configuracoes'} aria-labelledby="titulo-configuracoes">
        <div className="boas-vindas"><div><p className="sobretitulo">CONTA E PREFERÊNCIAS</p><h1 id="titulo-configuracoes">Configurações</h1></div></div>
        {(!readOnly && alternarTema || readOnly) && <section className="painel pilha compacta" aria-labelledby="titulo-aparencia"><h2 id="titulo-aparencia">Aparência</h2><p>Escolha como o APPCAR aparece neste espaço.</p>{!readOnly && alternarTema
          ? <button type="button" className="botao secundario" onClick={alternarTema}>Ativar modo {dados.modoEscuro ? 'claro' : 'escuro'}</button>
          : <p className="nota">A aparência deste espaço compartilhado é controlada pelo proprietário.</p>}</section>}
        {!readOnly && <section className="painel pilha compacta" aria-labelledby="titulo-backup"><h2 id="titulo-backup">Backup</h2><p>Exporte uma cópia dos dados financeiros em uso.</p><button className="botao secundario" type="button" onClick={exportar}>Exportar backup</button></section>}
        {!readOnly && (viewerUid || storage) && <section className="painel pilha compacta" aria-labelledby="titulo-perfil"><h2 id="titulo-perfil">Perfil e veículo</h2><CadastroMotorista uid={viewerUid ?? uid} email={email} tema={dados.modoEscuro ? 'escuro' : 'claro'} /></section>}
        <Lembrete key={`lembrete-${recuperacaoVersao}-${dados._sync?.generation ?? 0}`} inicial={dados.lembrete} readOnly={readOnly || Boolean(financeiro && (!financeiro.producao || bloquearEnvio))} onSalvar={salvarLembrete} />
        {financeiro?.producao && !readOnly && <RecuperacaoFilaLegada financeiro={financeiro} />}
        {storage && <div className="barra-status"><span className="ponto" /><p role="status">{storage.status}</p><button type="button" className="botao discreto" onClick={storage.tentarNovamente}>Verificar sincronização</button></div>}
      </section>

      <section id="pagina-privacidade" className="app-page pilha" tabIndex={-1} hidden={secao !== 'privacidade'} aria-labelledby="titulo-privacidade">
        <div className="boas-vindas"><div><p className="sobretitulo">CONTA E PREFERÊNCIAS</p><h1 id="titulo-privacidade">Privacidade</h1></div></div>
        <div className="pilha"><Privacidade uid={uid} email={email} dados={dados} dadosNuvem={storage?.dadosNuvem ?? (financeiro?.producao ? dados : null)} readOnly={readOnly || Boolean(financeiro && !financeiro.producao)} />{!readOnly && storage && <ReiniciarDados uid={uid} email={email} plan={storage.reinicio} prepare={storage.prepararReinicio} backup={storage.backupReinicio} exported={storage.marcarBackupExportado} execute={storage.executarReinicio} check={storage.verificarReinicio} onComplete={() => { setRecuperacaoVersao(v => v + 1); setEditando(undefined); setFormVersao(v => v + 1); }} />}</div>
        {!readOnly && storage && storage.recuperacoes.length > 0 && <section className="painel aviso"><h2>Cópias locais de outras sessões</h2><p>Há cópias com alterações pendentes neste navegador. Recuperar uma cópia preserva os dados atuais e exige comparação com a nuvem.</p>{storage.recuperacoes.map((copia, indice) => <button key={copia.key} type="button" className="botao secundario" onClick={() => setConfirmacao({ titulo: 'Recuperar cópia local?', descricao: 'Os dados atuais serão preservados antes da recuperação. Nenhuma gravação na nuvem será feita automaticamente.', confirmar: 'Recuperar cópia', executar: () => { if (storage.recuperar(copia.key)) { setRecuperacaoVersao(v => v + 1); setEditando(undefined); setFormVersao(v => v + 1); } } })}>Recuperar cópia {indice + 1} ({copia.data.historico.length} lançamentos)</button>)}</section>}
      </section>
      <footer>APPCAR · Gestão do seu trabalho</footer>
    </div>
  </AppShell>;
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

  const escolherModulo = (valor: 'motorista' | 'familiar') => {
    definirSecaoInicial();
    setModulo(valor);
  };
  const voltarModulos = () => {
    definirSecaoInicial();
    setModulo('selecao');
  };
  const selecionarEspaco = (valor: EspacoSelecionado) => {
    definirSecaoInicial();
    setVerificacaoFinanceiro(null);
    setEspaco(valor);
  };

  if (modulo === 'selecao') {
    return (
      <ModuloSelecao
        email={sessao.email}
        onSelecionar={escolherModulo}
        onSair={handleSair}
      />
    );
  }

  if (modulo === 'familiar') {
    return (
      <GestaoFamiliar
        email={sessao.email}
        onVoltar={voltarModulos}
        onSair={handleSair}
      />
    );
  }

  const hashFinanceiroConfigurado = process.env.NEXT_PUBLIC_APPCAR_FINANCEIRO_UID_SHA256?.toLowerCase();
  const verificarUidFinanceiro = Boolean(hashFinanceiroConfigurado && /^[a-f0-9]{64}$/.test(hashFinanceiroConfigurado));
  const financeiroAutorizado = espacoAtivo === 'proprio'
    && verificacaoFinanceiro?.uid === sessao.uid
    && verificacaoFinanceiro.hashEsperado === hashFinanceiroConfigurado
    && verificacaoFinanceiro.autorizado;
  const validandoFinanceiro = espacoAtivo === 'proprio' && verificarUidFinanceiro
    && verificacaoFinanceiro?.uid !== sessao.uid;
  if (validandoFinanceiro) return <main className="app claro">
    <header className="cabecalho"><div className="container cabecalho-conteudo"><AppcarLogo subtitulo="Gestão do Motorista" /><div className="usuario"><IndicadorConexao estado="sincronizando" /><button type="button" className="botao discreto" onClick={() => setModulo('selecao')}>Módulos</button></div></div></header>
    <div className="container conteudo"><section className="painel painel-carregando" aria-busy="true"><h1>Painel do motorista</h1><p role="status">Validando acesso e carregando dados confirmados…</p></section></div>
  </main>;
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
      onSelecionarEspaco={selecionarEspaco}
      onTrocarModulo={voltarModulos}
    />
  );
}
