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
  const proprioSelecionado = selecionado === 'proprio';
  const conviteDoProprietario = estado.meuConvite;
  const acaoCompartilhamento = conviteDoProprietario?.status === 'pending' || conviteDoProprietario?.status === 'active'
    ? 'Gerenciar parceira'
    : 'Convidar parceira';
  const aceitar = async (convite: ConviteCompartilhamento) => {
    setAceitando(convite.ownerUid); setErro('');
    try { await estado.aceitar(convite); }
    catch (error) { setErro(error instanceof Error ? error.message : 'Não foi possível aceitar o convite.'); }
    finally { setAceitando(''); }
  };
  return <section className="painel espacos" aria-labelledby="espacos-titulo">
    <div><p className="sobretitulo">ESPAÇOS APPCAR</p><h2 id="espacos-titulo">Escolha qual espaço consultar</h2><p className="ajuda">Escolha apenas os dados que deseja ver. Cada conta continua separada e os dados compartilhados ficam disponíveis somente para leitura.</p></div>
    <div className="espacos-opcoes">
      {proprioSelecionado
        ? <div className="espaco-opcao selecionado" role="status" aria-label="Meus dados, espaço selecionado"><span className="espaco-opcao-titulo"><strong>Meus dados</strong><span className="espaco-status">Selecionado</span></span><small>Conta atual · Seus lançamentos e configurações</small></div>
        : <button type="button" className="botao secundario espaco-opcao" onClick={() => onSelecionar('proprio')}><span className="espaco-opcao-titulo"><strong>Meus dados</strong></span><small>Conta atual · Voltar para seus dados</small></button>}
      {estado.ativos.map(convite => selecionado === convite.ownerUid
        ? <div className="espaco-opcao selecionado" role="status" aria-label="Espaço compartilhado, espaço selecionado" key={convite.ownerUid}><span className="espaco-opcao-titulo"><strong>Espaço compartilhado</strong><span className="espaco-status">Selecionado</span></span><small>Dados do proprietário · Somente visualização</small></div>
        : <button type="button" className="botao secundario espaco-opcao" key={convite.ownerUid} onClick={() => onSelecionar(convite.ownerUid)}><span className="espaco-opcao-titulo"><strong>Espaço compartilhado</strong></span><small>Dados do proprietário · Somente visualização</small></button>)}
    </div>
    {proprioSelecionado && <div className="espacos-proximo-passo"><div><strong>{estado.ativos.length === 0 ? 'Este é o único espaço disponível nesta conta.' : 'Quer compartilhar sua própria conta?'}</strong><p>Convide uma parceira para consultar seus dados. Ela precisará entrar ou criar a própria conta com o e-mail verificado do convite.</p></div><a className="botao primario" href="#compartilhamento-painel">{acaoCompartilhamento}</a></div>}
    {estado.pendentes.length > 0 && <div className="convites-pendentes" aria-labelledby="convites-pendentes-titulo"><h3 id="convites-pendentes-titulo">Convites recebidos</h3>{estado.pendentes.map(convite => <div className="convite-linha" key={convite.ownerUid}><div className="convite-conteudo"><strong>Convite para visualizar um espaço APPCAR</strong><p>Confirme que esta sessão usa o e-mail convidado e que sua conta está verificada. O convite não envia e-mail automaticamente; aceite aqui para liberar o espaço.</p></div><button type="button" className="botao secundario" disabled={aceitando === convite.ownerUid} onClick={() => void aceitar(convite)}>{aceitando === convite.ownerUid ? 'Aceitando…' : 'Aceitar convite'}</button></div>)}</div>}
    {(estado.erro || erro) && <p role="alert" className="mensagem erro">{erro || estado.erro}</p>}
  </section>;
}
export default function Compartilhamento({ estado }: { estado: EstadoCompartilhamento }) {
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
  return <section className="painel pilha" id="compartilhamento-painel" aria-labelledby="compartilhamento-titulo">
    <div><p className="sobretitulo">ACESSO CONTROLADO</p><h2 id="compartilhamento-titulo">Convidar ou gerenciar parceira</h2><p className="ajuda">Este painel administra o compartilhamento da sua própria conta. A parceira entra com a própria conta verificada; nenhuma senha, sessão ou permissão administrativa é compartilhada.</p><p className="nota">O APPCAR cria o convite no próprio aplicativo, mas não envia e-mail automaticamente. Depois de criar, compartilhe o endereço do site e peça que a pessoa entre ou crie a conta usando o mesmo e-mail.</p></div>
    {convite?.status === 'active' ? <div className="mensagem sucesso"><strong>Parceria ativa · Somente visualização</strong><p>{convite.email} aceitou com a própria conta e pode ler os dados atuais e futuros desta conta, sem criar, editar, apagar, restaurar ou reiniciar informações.</p><p className="nota">Revogar bloqueia novas leituras. Isso não apaga informações já vistas, copiadas ou capturadas pela parceira.</p><button type="button" className="botao discreto perigo" disabled={busy} onClick={() => void revogar()}>{busy ? 'Atualizando…' : 'Revogar acesso'}</button></div>
      : convite?.status === 'pending' ? <div className="mensagem aviso"><strong>Convite pendente</strong><p>O convite para <strong>{convite.email}</strong> está aguardando a pessoa entrar ou criar a própria conta verificada com este mesmo e-mail.</p><p className="nota">O APPCAR não enviou uma mensagem automática. Compartilhe o endereço do site e peça que ela aceite o convite na área de convites recebidos.</p><button type="button" className="botao discreto perigo" disabled={busy} onClick={() => void revogar()}>{busy ? 'Atualizando…' : 'Cancelar convite'}</button></div>
        : <>{convite?.status === 'revoked' && <div className="mensagem aviso"><strong>Acesso revogado</strong><p>O convite anterior não permite novas leituras. Revogar bloqueia novos acessos, mas não apaga informações que já foram vistas ou copiadas.</p></div>}<form className="pilha" onSubmit={enviar}><label className="campo"><span>E-mail da conta da parceira</span><input type="email" value={email} required autoComplete="off" placeholder="parceira@exemplo.com" disabled={busy} onChange={event => setEmail(event.currentTarget.value)} /></label><button type="submit" className="botao primario" disabled={busy}>{busy ? 'Criando convite…' : 'Convidar parceira'}</button><p className="nota">É permitido um parceiro ativo por conta. Criar o convite não libera acesso até a própria pessoa aceitar com o e-mail verificado.</p></form></>}
    {erro && <p role="alert" className="mensagem erro">{erro}</p>}
  </section>;
}
