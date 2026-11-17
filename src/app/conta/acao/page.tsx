'use client';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { applyActionCode, confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Campo } from '@/components/gestao/Campo';

function FormularioAcao() {
  const parametros = useSearchParams();
  const modo = parametros.get('mode') || '';
  const codigo = parametros.get('oobCode') || '';
  const valido = Boolean(codigo && ['verifyEmail', 'resetPassword'].includes(modo));
  const link = { modo, codigo };
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [mostrar, setMostrar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [pronto, setPronto] = useState(false);
  const [concluido, setConcluido] = useState('');
  const [erro, setErro] = useState('');
  useEffect(() => {
    let ativo = true;
    if (valido && modo === 'resetPassword') void verifyPasswordResetCode(auth, codigo).then(() => { if (ativo) setPronto(true); }).catch(() => {
      if (ativo) setErro('Não foi possível validar este link. Ele pode ter expirado ou já ter sido usado. Confira sua conexão ou solicite uma nova mensagem.');
    });
    return () => { ativo = false; };
  }, [modo, codigo, valido]);

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valido || ocupado || concluido) return;
    if (link.modo === 'resetPassword' && senha !== confirmacao) { setErro('As senhas não coincidem.'); return; }
    setOcupado(true); setErro('');
    try {
      if (link.modo === 'verifyEmail') await applyActionCode(auth, link.codigo);
      else await confirmPasswordReset(auth, link.codigo, senha);
      setSenha(''); setConfirmacao(''); setConcluido(link.modo);
      window.history.replaceState(null, '', window.location.pathname);
    } catch (falha) {
      const codigo = typeof falha === 'object' && falha !== null && 'code' in falha ? String(falha.code) : '';
      setErro(['auth/weak-password', 'auth/password-does-not-meet-requirements'].includes(codigo)
        ? 'A senha não atende à política da conta. Use uma senha mais longa, com letras maiúsculas e minúsculas, números e símbolos.'
        : 'Não foi possível concluir. Confira sua conexão. Se o link expirou ou já foi usado, solicite uma nova mensagem.');
    } finally { setOcupado(false); }
  }

  return <main className="acesso"><section className="painel auth-card">
    <div className="marca">A<span>APPCAR<small>Seu trabalho, suas contas.</small></span></div>
    <h1>{(concluido || link.modo) === 'verifyEmail' ? 'Confirme seu e-mail.' : 'Redefina sua senha.'}</h1>
    {concluido ? <p className="mensagem sucesso" role="status">{concluido === 'verifyEmail' ? 'E-mail confirmado. Volte ao aplicativo para continuar.' : 'Senha atualizada. Entre no aplicativo com sua nova senha.'}</p> : <form className="pilha" onSubmit={enviar} aria-busy={ocupado}>
      {!valido && <p role="alert" className="mensagem erro">Este link é inválido. Solicite uma nova mensagem no aplicativo.</p>}
      {valido && modo === 'resetPassword' && !pronto && !erro && <p role="status">Verificando link…</p>}
      {pronto && link?.modo === 'resetPassword' && <>
        <Campo label="Nova senha" name="password" type={mostrar ? 'text' : 'password'} required minLength={6} disabled={ocupado} autoComplete="new-password" value={senha} onChange={e => setSenha(e.currentTarget.value)} />
        <p className="nota">Use pelo menos 6 caracteres e respeite a política de segurança da sua conta. Prefira uma senha longa e exclusiva.</p>
        <Campo label="Confirmar nova senha" name="password-confirmation" type={mostrar ? 'text' : 'password'} required disabled={ocupado} autoComplete="new-password" value={confirmacao} onChange={e => setConfirmacao(e.currentTarget.value)} />
        <button className="botao secundario" type="button" aria-pressed={mostrar} disabled={ocupado} onClick={() => setMostrar(v => !v)}>{mostrar ? 'Ocultar senha' : 'Mostrar senha'}</button>
      </>}
      {erro && <p className="mensagem erro" role="alert">{erro}</p>}
      {valido && (pronto || modo === 'verifyEmail') && <button className="botao primario" type="submit" disabled={ocupado}>{ocupado ? 'Aguarde…' : link.modo === 'verifyEmail' ? 'Confirmar meu e-mail' : 'Salvar nova senha'}</button>}
    </form>}
    <div className="auth-links"><Link href="/">Voltar para o aplicativo</Link></div>
  </section></main>;
}

export default function AcaoConta() {
  return <Suspense fallback={<main className="acesso"><p role="status">Verificando link…</p></main>}><FormularioAcao /></Suspense>;
}
