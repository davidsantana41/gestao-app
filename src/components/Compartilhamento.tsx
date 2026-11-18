'use client';

import { useState } from 'react';
import type { EstadoCompartilhamento } from '@/lib/useCompartilhamento';
import type { ConviteCompartilhamento } from '@/lib/compartilhamento';

export type EspacoSelecionado = 'proprio' | string;

export function SeletorEspacos({ estado, selecionado, onSelecionar }: {
  estado: EstadoCompartilhamento; selecionado: EspacoSelecionado; onSelecionar: (ownerUid: EspacoSelecionado) => void;
}) {
  const [aceitando, setAceitando] = useState('');
  const [erro, setErro] = useState('');
  const aceitar = async (convite: ConviteCompartilhamento) => {
    setAceitando(convite.ownerUid); setErro('');
    try { await estado.aceitar(convite); }
    catch (error) { setErro(error instanceof Error ? error.message : 'Não foi possível aceitar o convite.'); }
    finally { setAceitando(''); }
  };
  return <section className="painel espacos" aria-labelledby="espacos-titulo">
    <div><p className="sobretitulo">ESPAÇOS APPCAR</p><h2 id="espacos-titulo">Escolha os dados que deseja consultar</h2><p className="ajuda">Cada espaço usa uma sessão autenticada separada. Dados compartilhados ficam disponíveis somente para leitura.</p></div>
    <div className="espacos-opcoes">
      <button type="button" className={`botao ${selecionado === 'proprio' ? 'primario' : 'secundario'}`} onClick={() => onSelecionar('proprio')}>
        Meus dados <small>Conta atual</small>
      </button>
      {estado.ativos.map(convite => <button type="button" className={`botao ${selecionado === convite.ownerUid ? 'primario' : 'secundario'}`} key={convite.ownerUid} onClick={() => onSelecionar(convite.ownerUid)}>
        Espaço compartilhado <small>Somente visualização · {convite.ownerUid.slice(0, 8)}</small>
      </button>)}
    </div>
    {estado.pendentes.length > 0 && <div className="convites-pendentes"><h3>Convites para visualizar</h3>{estado.pendentes.map(convite => <div className="convite-linha" key={convite.ownerUid}><span>Uma conta APPCAR convidou este e-mail para visualizar os dados.</span><button type="button" className="botao secundario" disabled={aceitando === convite.ownerUid} onClick={() => void aceitar(convite)}>{aceitando === convite.ownerUid ? 'Aceitando…' : 'Aceitar convite'}</button></div>)}</div>}
    {(estado.erro || erro) && <p role="alert" className="mensagem erro">{erro || estado.erro}</p>}
  </section>;
}
export default function Compartilhamento({ estado }: { uid: string; estado: EstadoCompartilhamento }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');
  const convite = estado.meuConvite;
  const enviar = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setErro('');
    try { await estado.convidar(email); setEmail(''); }
    catch (error) { setErro(error instanceof Error ? error.message : 'Não foi possível criar o convite.'); }
    finally { setBusy(false); }
  };
  const revogar = async () => {
    if (!window.confirm(convite?.status === 'pending' ? 'Cancelar este convite?' : 'Revogar o acesso da parceira? As leituras futuras serão bloqueadas; os dados já visualizados não serão apagados.')) return;
    setBusy(true); setErro('');
    try { await estado.revogar(); }
    catch (error) { setErro(error instanceof Error ? error.message : 'Não foi possível revogar o acesso.'); }
    finally { setBusy(false); }
  };
  return <section className="painel pilha" aria-labelledby="compartilhamento-titulo">
    <div><p className="sobretitulo">ACESSO CONTROLADO</p><h2 id="compartilhamento-titulo">Parceira de visualização</h2><p className="ajuda">A parceira entra com a própria conta autenticada. Nenhuma senha, sessão ou permissão administrativa é compartilhada.</p></div>
    {convite?.status === 'active' ? <div className="mensagem sucesso"><strong>Parceria ativa</strong><br />{convite.email} pode ler os dados atuais e futuros desta conta, sem criar, editar, apagar, restaurar ou reiniciar informações.<br /><button type="button" className="botao discreto perigo" disabled={busy} onClick={() => void revogar()}>{busy ? 'Atualizando…' : 'Revogar acesso'}</button></div>
      : convite?.status === 'pending' ? <div className="mensagem aviso"><strong>Convite pendente</strong><br />Aguardando {convite.email} aceitar usando a conta autenticada com este mesmo e-mail.<br /><button type="button" className="botao discreto perigo" disabled={busy} onClick={() => void revogar()}>{busy ? 'Atualizando…' : 'Cancelar convite'}</button></div>
        : <>{convite?.status === 'revoked' && <div className="mensagem aviso"><strong>Acesso revogado</strong><br />O convite anterior não permite novas leituras. Você pode enviar um novo convite para outra conta.</div>}<form className="pilha" onSubmit={enviar}><label className="campo"><span>E-mail da conta da parceira</span><input type="email" value={email} required autoComplete="off" placeholder="parceira@exemplo.com" disabled={busy} onChange={event => setEmail(event.currentTarget.value)} /></label><button type="submit" className="botao primario" disabled={busy}>{busy ? 'Enviando…' : 'Enviar convite'}</button><p className="nota">É permitido um parceiro ativo por conta. O convite não dá acesso até ser aceito pela própria pessoa.</p></form></>}
    {erro && <p role="alert" className="mensagem erro">{erro}</p>}
  </section>;
}
