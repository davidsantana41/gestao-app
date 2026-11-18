'use client';

import { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import Confirmacao from '@/components/Confirmacao';
import VerificarEmail from '@/components/VerificarEmail';
import Privacidade from '@/components/Privacidade';
import ReiniciarDados from '@/components/ReiniciarDados';
import AuthGate from '@/components/AuthGate';
import TurnoForm from '@/components/gestao/TurnoForm';
import CustosFixos from '@/components/gestao/CustosFixos';
import AvulsoForm from '@/components/gestao/AvulsoForm';
import Relatorios, { Historico } from '@/components/gestao/Relatorios';
import { auth } from '@/lib/firebase';
import { useGestao } from '@/lib/useGestao';
import type { EstadoCompartilhamento } from '@/lib/useCompartilhamento';
import { useCompartilhamento } from '@/lib/useCompartilhamento';
import Compartilhamento, { SeletorEspacos, type EspacoSelecionado } from '@/components/Compartilhamento';
import { dataLocal, moeda, resumir, type Lancamento } from '@/lib/gestao';

function Lembrete({ inicial, onSalvar, readOnly = false }: { inicial: string; onSalvar: (texto: string, base: string) => boolean; readOnly?: boolean }) {
  const [base, setBase] = useState(inicial);
  const [texto, setTexto] = useState(inicial);
  const dirty = texto !== base;
  const visivel = dirty ? texto : inicial;
  return <section className="painel"><h2>Lembretes</h2><label className="campo"><span>O que você precisa lembrar?</span><textarea value={visivel} readOnly={readOnly} placeholder="Manutenção, compromissos, metas…" onChange={e => { if (!dirty) setBase(inicial); setTexto(e.currentTarget.value); }} /></label>{!readOnly && <button className="botao secundario" type="button" onClick={() => { if (onSalvar(visivel, dirty ? base : inicial)) { setBase(visivel); setTexto(visivel); } }}>Salvar lembrete</button>}</section>;
}

export function Dashboard({ uid, email, readOnly = false, viewerUid, sharing }: {
  uid: string; email: string | null; readOnly?: boolean; viewerUid?: string; sharing?: EstadoCompartilhamento;
}) {
  const storage = useGestao(uid, { readOnly, storageNamespace: readOnly && viewerUid ? `shared-${viewerUid}-${uid}` : undefined });
  const { dados } = storage;
  const [aba, setAba] = useState('turno');
  const [editando, setEditando] = useState<Lancamento>();
  const [formVersao, setFormVersao] = useState(0);
  const [recuperacaoVersao, setRecuperacaoVersao] = useState(0);
  const [mes, setMes] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [confirmacao, setConfirmacao] = useState<{ titulo: string; descricao: string; confirmar: string; executar: () => void }>();
  const [saindo, setSaindo] = useState(false);
  if (!dados) return <main className="acesso"><section className="painel"><div className="marca">A<span>APPCAR</span></div><h1>{storage.erro ? 'Vamos recuperar seus dados' : 'Carregando seu painel'}</h1><p role={storage.erro ? 'alert' : 'status'}>{storage.erro || storage.status}</p>{storage.erro && <button className="botao primario" onClick={storage.tentarNovamente}>Tentar novamente</button>}</section></main>;
  const resumo = resumir(dados.historico);
  const editar = (item: Lancamento) => { setEditando(item); setFormVersao(v => v + 1); setAba('turno'); setMensagem(''); window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); };
  const excluir = (item: Lancamento) => {
    const salvo = storage.atualizar(d => ({ ...d, historico: d.historico.filter(h => h.id !== item.id) }), dados);
    if (!salvo) return;
    if (editando?.id === item.id) { setEditando(undefined); setFormVersao(v => v + 1); }
    setMensagem('Lançamento excluído. Relatórios atualizados.');
  };
  const pedirExclusao = (item: Lancamento) => setConfirmacao({ titulo: 'Excluir lançamento?', descricao: `Registro de ${item.data}: ${item.descricao || 'Turno de trabalho'}. Ele será removido do histórico e os relatórios serão recalculados.`, confirmar: 'Excluir lançamento', executar: () => excluir(item) });
  const escolher = (origem: 'local' | 'nuvem') => {
    const versaoNuvem = storage.versaoNuvem;
    setConfirmacao({ titulo: origem === 'local' ? 'Usar a versão deste navegador?' : 'Usar a versão da nuvem?', descricao: origem === 'local' ? 'Os dados deste navegador substituirão a versão da nuvem. As versões não serão mescladas. Antes da troca, as duas cópias serão preservadas neste navegador.' : 'Os dados da nuvem substituirão os dados em uso neste navegador. As versões não serão mescladas. Antes da troca, as duas cópias serão preservadas neste navegador.', confirmar: 'Confirmar escolha', executar: async () => { if (await storage.resolver(origem, versaoNuvem)) { setRecuperacaoVersao(v => v + 1); setEditando(undefined); setFormVersao(v => v + 1); } } });
  };
  const exportar = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `appcar-backup-${dataLocal()}.json`; link.click(); URL.revokeObjectURL(url);
  };
  return <main className={`app ${dados.modoEscuro ? 'escuro' : 'claro'}`}>
    {confirmacao && <Confirmacao titulo={confirmacao.titulo} descricao={confirmacao.descricao} confirmar={confirmacao.confirmar} onCancelar={() => setConfirmacao(undefined)} onConfirmar={() => { confirmacao.executar(); setConfirmacao(undefined); }} />}
    <header className="cabecalho"><div className="container cabecalho-conteudo"><div className="marca">A<span>APPCAR<small>Seu trabalho, suas contas.</small></span></div><div className="usuario"><span>{email}</span>{readOnly && <span className="selo">Somente visualização</span>}{!readOnly && <button type="button" className="botao discreto" onClick={() => storage.atualizar(d => ({ ...d, modoEscuro: !d.modoEscuro }))}>{dados.modoEscuro ? 'Modo claro' : 'Modo escuro'}</button>}<button type="button" className="botao secundario" disabled={saindo} onClick={async () => {
      setSaindo(true); try { await storage.aguardar(); await signOut(auth); } catch { setMensagem('A sincronização ainda está pendente. Tente sair novamente em instantes.'); } finally { setSaindo(false); }
    }}>{saindo ? 'Aguarde…' : 'Sair'}</button></div></div></header>
    <div className="container conteudo">
      <VerificarEmail />
      <div className="boas-vindas"><div><p className="sobretitulo">{readOnly ? 'ESPAÇO COMPARTILHADO' : 'GESTÃO FINANCEIRA'}</p><h1>{readOnly ? 'Dados do proprietário' : 'Seu painel de trabalho'}</h1><p>{readOnly ? 'Você está consultando este espaço em modo Somente visualização.' : 'Acompanhe cada turno e dê um destino ao seu dinheiro.'}</p></div>{!readOnly && <button className="botao secundario" type="button" onClick={exportar}>Exportar backup</button>}</div>
      <div className="barra-status"><span className="ponto" /><p role="status">{storage.status}</p><button type="button" className="botao discreto" onClick={storage.tentarNovamente}>Verificar sincronização</button></div>
      {!readOnly && storage.recuperacoes.length > 0 && <section className="painel aviso"><h2>Cópias locais de outras sessões</h2><p>Há cópias com alterações pendentes neste navegador. Recuperar uma cópia preserva os dados atuais e exige comparação com a nuvem.</p>{storage.recuperacoes.map((copia, indice) => <button key={copia.key} type="button" className="botao secundario" onClick={() => setConfirmacao({ titulo: 'Recuperar cópia local?', descricao: 'Os dados atuais serão preservados antes da recuperação. Nenhuma gravação na nuvem será feita automaticamente.', confirmar: 'Recuperar cópia', executar: () => { if (storage.recuperar(copia.key)) { setRecuperacaoVersao(v => v + 1); setEditando(undefined); setFormVersao(v => v + 1); } } })}>Recuperar cópia {indice + 1} ({copia.data.historico.length} lançamentos)</button>)}</section>}
      {storage.erro && <p role="alert" className="mensagem erro">{storage.erro}</p>}
      {!readOnly && storage.conflito && <section className="painel aviso" aria-labelledby="titulo-conflito"><h2 id="titulo-conflito">Escolha a versão dos seus dados</h2><p>Este navegador e a nuvem têm dados diferentes. Compare as versões antes de escolher. Elas não serão mescladas.</p><div className="comparacao-versoes">{[['Neste navegador', dados], ['Na nuvem', storage.dadosNuvem]].map(([nome, versao]) => {
        if (!versao || typeof versao === 'string') return null;
        const resumoVersao = resumir(versao.historico);
        return <div key={String(nome)}><h3>{String(nome)}</h3><p>{versao.historico.length} lançamentos</p><p>Saldo principal: <strong>{moeda(resumoVersao.liquido)}</strong></p></div>;
      })}</div><p>As duas cópias serão guardadas neste navegador antes da troca. A quantidade de lançamentos não indica qual versão é mais recente. Você também pode exportar um backup dos dados em uso.</p>{storage.geracaoAnterior && <p className="mensagem aviso">Esta cópia pertence a uma geração anterior à reinicialização. Exporte-a se precisar consultar os registros antigos. Ela não pode substituir os dados atuais.</p>}<div className="acoes"><button type="button" className="botao primario" disabled={storage.geracaoAnterior} onClick={() => escolher('local')}>Usar dados deste navegador</button><button type="button" className="botao secundario" onClick={() => escolher('nuvem')}>Usar dados da nuvem</button></div></section>}
      <div className="grade-metricas"><div className="metrica"><span>Faturamento acumulado</span><strong>{moeda(resumo.faturamento)}</strong><small>Todo o histórico</small></div><div className="metrica destaque"><span>Saldo principal</span><strong>{moeda(resumo.liquido)}</strong><small>Após despesas e reservas</small></div><div className="metrica"><span>Combustível acumulado</span><strong>{moeda(resumo.combustivel)}</strong><small>Todos os abastecimentos</small></div><div className="metrica"><span>Dias trabalhados</span><strong>{resumo.dias}</strong><small>{dados.historico.length} lançamentos salvos</small></div></div>
      <nav className="abas" aria-label="Seções do painel">{[['turno','Registrar turno'], ['relatorios','Histórico e relatórios'], ['configuracoes','Custos fixos'], ['privacidade','Privacidade']].map(([id, nome]) => <button type="button" key={id} aria-current={aba === id ? 'page' : undefined} onClick={() => setAba(id)}>{nome}</button>)}</nav>
      {mensagem && <p role="status" className="mensagem sucesso">{mensagem}</p>}
      <div hidden={aba !== 'turno'} className="pilha">
        {!readOnly && <TurnoForm key={`${editando?.id || 'novo'}-${formVersao}-${dados._sync?.generation ?? 0}`} dados={dados} original={editando} onCancelar={() => { setEditando(undefined); setFormVersao(v => v + 1); }} onSalvar={(item, base) => {
          const salvo = storage.atualizar(d => ({ ...d, historico: editando ? d.historico.map(h => h.id === item.id ? item : h) : [item, ...d.historico],
            reservasDiarias: editando ? d.reservasDiarias : (item.reservasDiariasDia ?? []).map(r => ({ ...r, valor: 0 })) }), base);
          if (salvo) { setMensagem(editando ? 'Alterações salvas no turno original.' : 'Turno registrado com sucesso.'); setEditando(undefined); setFormVersao(v => v + 1); }
        }} />}
        {!readOnly && <AvulsoForm key={`avulso-${recuperacaoVersao}-${dados._sync?.generation ?? 0}`} dados={dados} onSalvar={(item, base) => { const salvo = storage.atualizar(d => ({ ...d, historico: [item, ...d.historico] }), base); if (salvo) setMensagem('Movimentação registrada.'); return salvo; }} />}
        <Lembrete key={`lembrete-${recuperacaoVersao}-${dados._sync?.generation ?? 0}`} inicial={dados.lembrete} readOnly={readOnly} onSalvar={(lembrete, base) => { const salvo = storage.atualizar(d => ({ ...d, lembrete }), { ...dados, lembrete: base }); if (salvo) setMensagem('Lembrete salvo localmente. Confira o estado da sincronização.'); return salvo; }} />
        <Historico itens={dados.historico.slice(0, 10)} onEditar={readOnly ? undefined : editar} onExcluir={readOnly ? undefined : pedirExclusao} />
      </div>
      {aba === 'relatorios' && <Relatorios dados={dados} mes={mes} onMes={setMes} onEditar={readOnly ? undefined : editar} onExcluir={readOnly ? undefined : pedirExclusao} />}
      {aba === 'configuracoes' && <CustosFixos key={`${recuperacaoVersao}-${dados._sync?.generation ?? 0}`} itens={dados.custosFixos} readOnly={readOnly} onSalvar={(custosFixos, base) => { const salvo = storage.atualizar(d => ({ ...d, custosFixos }), { ...dados, custosFixos: base }); if (salvo) setMensagem('Custos salvos localmente. Os turnos antigos mantêm o rateio original.'); return salvo; }} />}
      {aba === 'privacidade' && <div className="pilha"><Privacidade uid={uid} email={email} dados={dados} dadosNuvem={storage.dadosNuvem} readOnly={readOnly} />{!readOnly && <>{sharing && <Compartilhamento uid={uid} estado={sharing} />}<ReiniciarDados uid={uid} email={email} plan={storage.reinicio} prepare={storage.prepararReinicio} backup={storage.backupReinicio} exported={storage.marcarBackupExportado} execute={storage.executarReinicio} check={storage.verificarReinicio} onComplete={() => { setRecuperacaoVersao(v => v + 1); setEditando(undefined); setFormVersao(v => v + 1); }} /></>}</div>}
      <footer>APPCAR · Gestão do seu trabalho · Versão reconstruída</footer>
    </div>
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
  const espacoAtivo = espaco !== 'proprio' && sharing.ativos.some(convite => convite.ownerUid === espaco) ? espaco : 'proprio';
  const compartilhado = espacoAtivo !== 'proprio' ? sharing.ativos.find(convite => convite.ownerUid === espacoAtivo) : undefined;
  return <>
    <div className="container seletor-espacos"><SeletorEspacos estado={sharing} selecionado={espacoAtivo} onSelecionar={setEspaco} /></div>
    <Dashboard key={`${sessao.uid}-${espacoAtivo}`} uid={compartilhado?.ownerUid || sessao.uid} email={sessao.email} readOnly={Boolean(compartilhado)} viewerUid={sessao.uid} sharing={sharing} />
  </>;
}
