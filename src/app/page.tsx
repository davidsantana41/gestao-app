'use client';

import { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import AuthGate from '@/components/AuthGate';
import TurnoForm from '@/components/gestao/TurnoForm';
import CustosFixos from '@/components/gestao/CustosFixos';
import AvulsoForm from '@/components/gestao/AvulsoForm';
import Relatorios, { Historico } from '@/components/gestao/Relatorios';
import { auth } from '@/lib/firebase';
import { useGestao } from '@/lib/useGestao';
import { dataLocal, moeda, resumir, type Lancamento } from '@/lib/gestao';

function Lembrete({ inicial, onSalvar }: { inicial: string; onSalvar: (texto: string) => void }) {
  const [texto, setTexto] = useState(inicial);
  return <section className="painel"><h2>Lembretes</h2><label className="campo"><span>O que você precisa lembrar?</span><textarea value={texto} placeholder="Manutenção, compromissos, metas…" onChange={e => setTexto(e.currentTarget.value)} /></label><button className="botao secundario" type="button" onClick={() => onSalvar(texto)}>Salvar lembrete</button></section>;
}

export function Dashboard({ uid, email }: { uid: string; email: string | null }) {
  const storage = useGestao(uid);
  const { dados } = storage;
  const [aba, setAba] = useState('turno');
  const [editando, setEditando] = useState<Lancamento>();
  const [formVersao, setFormVersao] = useState(0);
  const [mes, setMes] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [saindo, setSaindo] = useState(false);
  if (!dados) return <main className="acesso"><section className="painel"><div className="marca">A<span>APPCAR</span></div><h1>{storage.erro ? 'Vamos recuperar seus dados' : 'Carregando seu painel'}</h1><p role={storage.erro ? 'alert' : 'status'}>{storage.erro || storage.status}</p>{storage.erro && <button className="botao primario" onClick={storage.tentarNovamente}>Tentar novamente</button>}</section></main>;
  const resumo = resumir(dados.historico);
  const editar = (item: Lancamento) => { setEditando(item); setFormVersao(v => v + 1); setAba('turno'); setMensagem(''); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const excluir = (item: Lancamento) => {
    if (!window.confirm(`Excluir o lançamento de ${item.data}?\n\n${item.descricao || 'Turno de trabalho'}\nEsta ação remove o registro do histórico.`)) return;
    storage.atualizar(d => ({ ...d, historico: d.historico.filter(h => h.id !== item.id) }));
    if (editando?.id === item.id) { setEditando(undefined); setFormVersao(v => v + 1); }
    setMensagem('Lançamento excluído. Relatórios atualizados.');
  };
  const exportar = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `appcar-backup-${dataLocal()}.json`; link.click(); URL.revokeObjectURL(url);
  };
  return <main className={`app ${dados.modoEscuro ? 'escuro' : 'claro'}`}>
    <header className="cabecalho"><div className="container cabecalho-conteudo"><div className="marca">A<span>APPCAR<small>Seu trabalho, suas contas.</small></span></div><div className="usuario"><span>{email}</span><button type="button" className="botao discreto" onClick={() => storage.atualizar(d => ({ ...d, modoEscuro: !d.modoEscuro }))}>{dados.modoEscuro ? 'Modo claro' : 'Modo escuro'}</button><button type="button" className="botao secundario" disabled={saindo} onClick={async () => {
      setSaindo(true); try { await storage.aguardar(); await signOut(auth); } catch { setMensagem('A sincronização ainda está pendente. Tente sair novamente em instantes.'); } finally { setSaindo(false); }
    }}>{saindo ? 'Aguarde…' : 'Sair'}</button></div></div></header>
    <div className="container conteudo">
      <div className="boas-vindas"><div><p className="sobretitulo">GESTÃO FINANCEIRA</p><h1>Seu painel de trabalho</h1><p>Acompanhe cada turno e dê um destino ao seu dinheiro.</p></div><button className="botao secundario" type="button" onClick={exportar}>Exportar backup</button></div>
      <div className="barra-status"><span className="ponto" /><p role="status">{storage.status}</p><button type="button" className="botao discreto" onClick={storage.tentarNovamente}>Verificar sincronização</button></div>
      {storage.erro && <p role="alert" className="mensagem erro">{storage.erro}</p>}
      {storage.conflito && <section className="painel aviso"><h2>Escolha a versão dos seus dados</h2><p>Há alterações neste navegador que ainda não estão na nuvem. As duas cópias serão guardadas antes da escolha.</p><div className="acoes"><button type="button" className="botao primario" onClick={() => { if (window.confirm('Usar as alterações deste navegador na nuvem?')) storage.resolver('local'); }}>Usar dados deste navegador</button><button type="button" className="botao secundario" onClick={() => storage.resolver('nuvem')}>Usar dados da nuvem</button></div></section>}
      <div className="grade-metricas"><div className="metrica"><span>Faturamento acumulado</span><strong>{moeda(resumo.faturamento)}</strong><small>Todo o histórico</small></div><div className="metrica destaque"><span>Saldo principal</span><strong>{moeda(resumo.liquido)}</strong><small>Após despesas e reservas</small></div><div className="metrica"><span>Combustível acumulado</span><strong>{moeda(resumo.combustivel)}</strong><small>Todos os abastecimentos</small></div><div className="metrica"><span>Dias trabalhados</span><strong>{resumo.dias}</strong><small>{dados.historico.length} lançamentos salvos</small></div></div>
      <nav className="abas" aria-label="Seções do painel">{[['turno','Registrar turno'], ['relatorios','Histórico e relatórios'], ['configuracoes','Custos fixos']].map(([id, nome]) => <button type="button" key={id} aria-current={aba === id ? 'page' : undefined} onClick={() => setAba(id)}>{nome}</button>)}</nav>
      {mensagem && <p role="status" className="mensagem sucesso">{mensagem}</p>}
      <div hidden={aba !== 'turno'} className="pilha">
        <TurnoForm key={`${editando?.id || 'novo'}-${formVersao}`} dados={dados} original={editando} onCancelar={() => { setEditando(undefined); setFormVersao(v => v + 1); }} onSalvar={item => {
          const salvo = storage.atualizar(d => ({ ...d, historico: editando ? d.historico.map(h => h.id === item.id ? item : h) : [item, ...d.historico],
            reservasDiarias: editando ? d.reservasDiarias : (item.reservasDiariasDia ?? []).map(r => ({ ...r, valor: 0 })) }));
          if (salvo) { setMensagem(editando ? 'Alterações salvas no turno original.' : 'Turno registrado com sucesso.'); setEditando(undefined); setFormVersao(v => v + 1); }
        }} />
        <AvulsoForm dados={dados} onSalvar={item => { const salvo = storage.atualizar(d => ({ ...d, historico: [item, ...d.historico] })); if (salvo) setMensagem('Movimentação registrada.'); return salvo; }} />
        <Lembrete inicial={dados.lembrete} onSalvar={lembrete => { storage.atualizar(d => ({ ...d, lembrete })); setMensagem('Lembrete salvo.'); }} />
        <Historico itens={dados.historico.slice(0, 10)} onEditar={editar} onExcluir={excluir} />
      </div>
      {aba === 'relatorios' && <Relatorios dados={dados} mes={mes} onMes={setMes} onEditar={editar} onExcluir={excluir} />}
      {aba === 'configuracoes' && <CustosFixos itens={dados.custosFixos} onSalvar={custosFixos => { storage.atualizar(d => ({ ...d, custosFixos })); setMensagem('Custos atualizados. Os turnos antigos mantêm o rateio original.'); }} />}
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
  return <Dashboard key={sessao.uid} uid={sessao.uid} email={sessao.email} />;
}
