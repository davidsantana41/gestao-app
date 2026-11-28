'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import AppcarLogo from '@/components/AppcarLogo';
import IndicadorConexao, { type EstadoConexao } from './IndicadorConexao';

export type SecaoApp = 'visao-geral' | 'turno' | 'caixinhas' | 'relatorios' | 'custos-fixos' | 'espacos' | 'configuracoes' | 'privacidade';

const secoes: Array<{ id: SecaoApp; nome: string; icone: string; grupo: 'gestao' | 'conta' }> = [
  { id: 'visao-geral', nome: 'Visão geral', icone: 'overview', grupo: 'gestao' },
  { id: 'turno', nome: 'Registrar turno', icone: 'turno', grupo: 'gestao' },
  { id: 'caixinhas', nome: 'Caixinhas', icone: 'caixinhas', grupo: 'gestao' },
  { id: 'relatorios', nome: 'Histórico e relatórios', icone: 'relatorios', grupo: 'gestao' },
  { id: 'custos-fixos', nome: 'Custos fixos', icone: 'custos', grupo: 'gestao' },
  { id: 'espacos', nome: 'Meus espaços', icone: 'espacos', grupo: 'conta' },
  { id: 'configuracoes', nome: 'Configurações', icone: 'configuracoes', grupo: 'conta' },
  { id: 'privacidade', nome: 'Privacidade', icone: 'privacidade', grupo: 'conta' },
];

function Icone({ nome }: { nome: string }) {
  const comum = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const desenhos: Record<string, ReactNode> = {
    menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
    fechar: <><path d="m6 6 12 12M18 6 6 18" /></>,
    overview: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
    turno: <><path d="M4 19.5h16M6 16l3.6-4 2.8 2.3 5.8-7.1" /><path d="M15.5 7.2h2.8V10" /></>,
    caixinhas: <><path d="M3.5 8.5 12 4l8.5 4.5v9L12 22l-8.5-4.5z" /><path d="M12 22v-9.5m8.5-4L12 13l-8.5-4.5" /></>,
    relatorios: <><path d="M5 3.5h10l4 4v13H5z" /><path d="M14.5 3.5v4h4M8 12h8M8 16h8" /></>,
    custos: <><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M8 5V3.5h8V5M7.5 10h9M7.5 14h2m3 0h4" /></>,
    espacos: <><path d="M3 20.5V7l9-4 9 4v13.5" /><path d="M8 20.5v-7h8v7M7 8.5h.01M12 8.5h.01M17 8.5h.01" /></>,
    configuracoes: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.2 1-1.5 2.6-1.5-.5a7.8 7.8 0 0 1-1.3.8l-.3 1.6h-3l-.3-1.6a7.8 7.8 0 0 1-1.3-.8l-1.5.5-1.5-2.6 1.2-1a7.8 7.8 0 0 1 0-1.6l-1.2-1 1.5-2.6 1.5.5a7.8 7.8 0 0 1 1.3-.8l.3-1.6h3l.3 1.6a7.8 7.8 0 0 1 1.3.8l1.5-.5 1.5 2.6-1.2 1a7.8 7.8 0 0 1 0 1.5Z" transform="translate(-1 -1) scale(1.08)" /></>,
    privacidade: <><path d="M12 3.5 19 6v5.5c0 4.2-2.8 7.5-7 9-4.2-1.5-7-4.8-7-9V6z" /><path d="m9 12 2 2 4-4" /></>,
    perfil: <><circle cx="12" cy="8" r="3.3" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
    sair: <><path d="M10 4H5v16h5M14 8l4 4-4 4M8 12h10" /></>,
    modulos: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
  };
  return <svg className="app-shell-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...comum}>{desenhos[nome] ?? desenhos.overview}</svg>;
}

export function useNavegacaoApp(mostrarEspacos = true) {
  const [secao, setSecao] = useState<SecaoApp>('visao-geral');
  useEffect(() => {
    const ler = () => {
      const valor = new URLSearchParams(window.location.search).get('secao');
      setSecao(secoes.some(item => item.id === valor && (mostrarEspacos || item.id !== 'espacos')) ? valor as SecaoApp : 'visao-geral');
    };
    ler();
    window.addEventListener('popstate', ler);
    return () => window.removeEventListener('popstate', ler);
  }, [mostrarEspacos]);
  function navegar(destino: SecaoApp) {
    if (new URLSearchParams(window.location.search).get('secao') !== destino) {
      const url = new URL(window.location.href);
      url.searchParams.set('secao', destino);
      window.history.pushState({ appcarSection: destino }, '', `${url.pathname}${url.search}${url.hash}`);
    }
    setSecao(destino);
  }
  return { secao, navegar };
}

export function definirSecaoInicial(destino: SecaoApp = 'visao-geral') {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set('secao', destino);
  window.history.replaceState({ appcarSection: destino }, '', `${url.pathname}${url.search}${url.hash}`);
}

export default function AppShell({ children, modoEscuro, secao, onNavegar, email, somenteLeitura, conexao,
  onPerfil, onModulos, onSair, mostrarEspacos = true, convitePendente = false }: {
  children: ReactNode; modoEscuro: boolean; secao: SecaoApp; onNavegar: (secao: SecaoApp) => void;
  email: string | null; somenteLeitura: boolean; conexao?: EstadoConexao;
  onPerfil?: () => void; onModulos?: () => void; onSair?: () => Promise<void>; mostrarEspacos?: boolean; convitePendente?: boolean;
}) {
  const [recolhida, setRecolhida] = useState(false);
  const [menuMobile, setMenuMobile] = useState(false);
  const [viewportMobile, setViewportMobile] = useState(false);
  const [saindo, setSaindo] = useState(false);
  const menuRef = useRef<HTMLElement>(null);
  const botaoMenuRef = useRef<HTMLButtonElement>(null);
  const secoesVisiveis = secoes.filter(item => (mostrarEspacos || item.id !== 'espacos')
    && (!somenteLeitura || item.id !== 'turno'));

  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const atualizar = () => { setViewportMobile(media.matches); if (!media.matches) setMenuMobile(false); };
    atualizar();
    media.addEventListener('change', atualizar);
    return () => media.removeEventListener('change', atualizar);
  }, []);

  useEffect(() => {
    if (!menuMobile) return;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('.app-shell-nav-item')?.focus());
    const escapar = (evento: globalThis.KeyboardEvent) => {
      if (evento.key === 'Escape') {
        setMenuMobile(false);
        requestAnimationFrame(() => botaoMenuRef.current?.focus());
      }
    };
    document.addEventListener('keydown', escapar);
    return () => {
      document.body.style.overflow = anterior;
      document.removeEventListener('keydown', escapar);
    };
  }, [menuMobile]);

  function selecionar(destino: SecaoApp) {
    onNavegar(destino);
    setMenuMobile(false);
    requestAnimationFrame(() => document.getElementById(`pagina-${destino}`)?.focus());
  }

  function fecharMenu() {
    setMenuMobile(false);
    requestAnimationFrame(() => botaoMenuRef.current?.focus());
  }

  function conterFoco(evento: KeyboardEvent<HTMLElement>) {
    if (!menuMobile || evento.key !== 'Tab') return;
    const alvos = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])') ?? []);
    if (!alvos.length) return;
    const primeiro = alvos[0], ultimo = alvos[alvos.length - 1];
    if (evento.shiftKey && document.activeElement === primeiro) { evento.preventDefault(); ultimo.focus(); }
    else if (!evento.shiftKey && document.activeElement === ultimo) { evento.preventDefault(); primeiro.focus(); }
  }

  async function sair() {
    if (!onSair) return;
    setSaindo(true);
    try { await onSair(); } finally { setSaindo(false); }
  }

  return <main className={`app app-shell ${modoEscuro ? 'escuro' : 'claro'}${recolhida ? ' app-shell-recolhido' : ''}`}>
    {menuMobile && <div className="app-shell-scrim" aria-hidden="true" onClick={fecharMenu} />}
    <aside id="appcar-sidebar" ref={menuRef} role={menuMobile ? 'dialog' : undefined} className={`app-shell-sidebar${menuMobile ? ' app-shell-mobile-aberto' : ''}`} aria-label="Menu principal" aria-modal={menuMobile || undefined} onKeyDown={conterFoco}>
      <div className="app-shell-mobile-topo"><strong>Navegação</strong><button type="button" className="app-shell-mobile-fechar" aria-label="Fechar menu" onClick={fecharMenu}><Icone nome="fechar" /></button></div>
      <nav className="app-shell-nav" aria-label="Navegação do aplicativo">
        <p className="app-shell-grupo">Gestão do motorista</p>
        {secoesVisiveis.filter(item => item.grupo === 'gestao').map(item => <button key={item.id} type="button"
          className={`app-shell-nav-item${secao === item.id ? ' ativo' : ''}`} aria-current={secao === item.id ? 'page' : undefined}
          aria-label={item.nome} title={item.nome} onClick={() => selecionar(item.id)}>
          <Icone nome={item.icone} /><span className="app-shell-nav-label">{item.nome}</span>
        </button>)}
        <p className="app-shell-grupo">Conta e preferências</p>
        {secoesVisiveis.filter(item => item.grupo === 'conta').map(item => <button key={item.id} type="button"
          className={`app-shell-nav-item${secao === item.id ? ' ativo' : ''}`} aria-current={secao === item.id ? 'page' : undefined}
          aria-label={item.id === 'espacos' && convitePendente ? `${item.nome} — convite pendente` : item.nome}
          title={item.id === 'espacos' && convitePendente ? `${item.nome} · Convite pendente` : item.nome} onClick={() => selecionar(item.id)}>
          <Icone nome={item.icone} /><span className="app-shell-nav-label">{item.nome}</span>
          {item.id === 'espacos' && convitePendente && <span className="app-shell-pending" aria-hidden="true" />}
        </button>)}
      </nav>
      <div className="app-shell-sidebar-rodape">
        {onModulos && <button type="button" className="app-shell-nav-item" title="Voltar aos módulos" aria-label="Voltar aos módulos" onClick={() => { setMenuMobile(false); onModulos(); }}><Icone nome="modulos" /><span className="app-shell-nav-label">Voltar aos módulos</span></button>}
        {onSair && <button type="button" className="app-shell-nav-item" title="Sair" aria-label="Sair" disabled={saindo} onClick={() => void sair()}><Icone nome="sair" /><span className="app-shell-nav-label">{saindo ? 'Saindo…' : 'Sair'}</span></button>}
      </div>
    </aside>
    <div className="app-shell-main">
      <header className="cabecalho app-shell-header"><div className="container cabecalho-conteudo">
        <button ref={botaoMenuRef} type="button" className="app-shell-menu-toggle" aria-label={viewportMobile ? (menuMobile ? 'Fechar menu' : 'Abrir menu') : (recolhida ? 'Expandir menu' : 'Recolher menu')}
          aria-controls="appcar-sidebar" aria-expanded={viewportMobile ? menuMobile : !recolhida}
          onClick={() => viewportMobile ? setMenuMobile(atual => !atual) : setRecolhida(atual => !atual)}><Icone nome="menu" /></button>
        <div className="app-shell-header-logo"><AppcarLogo subtitulo="Gestão do Motorista" /></div>
        <div className="app-shell-header-controles">
          {conexao && <IndicadorConexao estado={conexao} />}
          <span className="app-shell-email" title={email ?? undefined}>{email}</span>
          {somenteLeitura && <span className="selo app-shell-readonly">Somente visualização</span>}
          {onPerfil && <button type="button" className="app-shell-profile" aria-label="Abrir perfil e configurações" title="Perfil e configurações" onClick={onPerfil}><Icone nome="perfil" /><span>Perfil</span></button>}
        </div>
      </div></header>
      <div className="app-shell-content">{children}</div>
    </div>
  </main>;
}
