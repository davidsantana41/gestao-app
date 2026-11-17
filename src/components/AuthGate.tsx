'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { EmailAuthProvider, GoogleAuthProvider, createUserWithEmailAndPassword, linkWithCredential, linkWithPopup, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, validatePassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Campo } from './gestao/Campo';

type Modo = 'entrar' | 'cadastrar' | 'recuperar';
export default function AuthGate() {
  const [modo, setModo] = useState<Modo>('entrar');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');
  const mudarModo = (proximo: Modo) => { setModo(proximo); setErro(''); setMensagem(''); setSenha(''); setConfirmarSenha(''); setMostrarSenha(false); };
  async function entrarGoogle() {
    if (ocupado) return;
    setOcupado(true); setErro(''); setMensagem('');
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      if (auth.currentUser?.isAnonymous) await linkWithPopup(auth.currentUser, provider);
      else await signInWithPopup(auth, provider);
    } catch (falha) {
      const codigo = typeof falha === 'object' && falha !== null && 'code' in falha ? String(falha.code) : '';
      const mensagens: Record<string, string> = {
        'auth/popup-closed-by-user': 'A janela do Google foi fechada. Você pode tentar novamente.',
        'auth/cancelled-popup-request': 'O acesso foi interrompido. Tente novamente.',
        'auth/popup-blocked': 'Permita a janela de login do Google neste navegador e tente novamente.',
        'auth/operation-not-allowed': 'O acesso com Google ainda precisa ser habilitado no Firebase.',
        'auth/unauthorized-domain': 'Este domínio ainda precisa ser autorizado para o login com Google.',
        'auth/account-exists-with-different-credential': 'Este e-mail já usa outra forma de acesso. Entre pelo método usado anteriormente. Seus dados não foram transferidos para outra conta.',
        'auth/credential-already-in-use': 'Esta conta Google já tem cadastro. Entre com ela separadamente para acessar seus registros.',
        'auth/network-request-failed': 'Não foi possível conectar ao Google. Confira sua conexão.',
        'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos.',
        'auth/user-disabled': 'O acesso a esta conta está desativado.',
      };
      setErro(mensagens[codigo] || 'Não foi possível entrar com Google. Tente novamente ou use e-mail e senha.');
    } finally { setOcupado(false); }
  }
  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (ocupado) return;
    if (modo === 'cadastrar' && senha !== confirmarSenha) { setErro('As senhas não coincidem. Confira a confirmação da senha.'); return; }
    setOcupado(true); setErro(''); setMensagem('');
    try {
      if (modo === 'recuperar') {
        await sendPasswordResetEmail(auth, email.trim());
        setMensagem('Se houver uma conta com este e-mail, você receberá as instruções para recuperar a senha.');
      } else if (modo === 'cadastrar') {
        const politica = await validatePassword(auth, senha);
        if (!politica.isValid) {
          const requisitos = [];
          const opcoes = politica.passwordPolicy.customStrengthOptions;
          if (politica.meetsMinPasswordLength === false) requisitos.push(`pelo menos ${opcoes.minPasswordLength} caracteres`);
          if (politica.meetsMaxPasswordLength === false) requisitos.push(`no máximo ${opcoes.maxPasswordLength} caracteres`);
          if (politica.containsLowercaseLetter === false) requisitos.push('uma letra minúscula');
          if (politica.containsUppercaseLetter === false) requisitos.push('uma letra maiúscula');
          if (politica.containsNumericCharacter === false) requisitos.push('um número');
          if (politica.containsNonAlphanumericCharacter === false) requisitos.push('um símbolo');
          setErro(`Sua senha precisa ter ${requisitos.join(', ') || 'os requisitos definidos para esta conta'}.`);
          return;
        }
        const atual = auth.currentUser;
        const credencial = atual?.isAnonymous
          ? await linkWithCredential(atual, EmailAuthProvider.credential(email.trim(), senha))
          : await createUserWithEmailAndPassword(auth, email.trim(), senha);
        // O cadastro já foi concluído mesmo se o serviço de e-mail falhar.
        try { await sendEmailVerification(credencial.user); } catch { /* O painel permite reenviar a confirmação. */ }
      } else await signInWithEmailAndPassword(auth, email.trim(), senha);
    } catch (falha: unknown) {
      const codigo = typeof falha === 'object' && falha !== null && 'code' in falha ? String(falha.code) : '';
      const mensagens: Record<string, string> = {
        'auth/email-already-in-use': 'Este e-mail já está cadastrado. Entre com sua conta.',
        'auth/weak-password': 'Escolha uma senha com pelo menos 6 caracteres.',
        'auth/invalid-email': 'Informe um e-mail válido.',
        'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco e tente novamente.',
        'auth/network-request-failed': 'Não foi possível conectar. Verifique sua conexão.',
        'auth/operation-not-allowed': 'Habilite o acesso por e-mail e senha no Firebase Authentication.',
        'auth/unauthorized-domain': 'Este domínio precisa ser autorizado no Firebase Authentication.',
        'auth/invalid-credential': 'E-mail ou senha incorretos. Confira os dados e tente novamente.',
        'auth/invalid-login-credentials': 'E-mail ou senha incorretos. Confira os dados e tente novamente.',
        'auth/wrong-password': 'E-mail ou senha incorretos. Confira os dados e tente novamente.',
        'auth/password-does-not-meet-requirements': 'A senha não atende à política de segurança. Revise os requisitos e tente novamente.',
        'auth/user-disabled': 'O acesso a esta conta está desativado.',
      };
      if (codigo === 'auth/user-not-found') {
        if (modo === 'recuperar') setMensagem('Se houver uma conta com este e-mail, você receberá as instruções para recuperar a senha.');
        else setErro('E-mail ou senha incorretos. Confira os dados e tente novamente.');
        return;
      }
      setErro(mensagens[codigo] || 'Não foi possível concluir. Confira os dados e tente novamente.');
    } finally { setOcupado(false); }
  }
  return <main className="acesso"><section className="painel auth-card">
    <div className="marca">A<span>APPCAR<small>Seu trabalho, suas contas.</small></span></div>
    <p className="sobretitulo">GESTÃO FINANCEIRA PARA QUEM DIRIGE</p>
    <h1>{modo === 'entrar' ? 'Bom ter você aqui.' : modo === 'cadastrar' ? 'Comece sua organização.' : 'Recupere seu acesso.'}</h1>
    <p className="ajuda">{modo === 'entrar' ? 'Entre com sua conta para acompanhar turnos, despesas e reservas.' : modo === 'cadastrar' ? 'Crie uma conta para guardar seus lançamentos e acessar de outros dispositivos.' : 'Enviaremos as instruções para o e-mail da sua conta.'}</p>
    {modo !== 'recuperar' && <div className="acesso-google"><button type="button" className="botao google" disabled={ocupado} onClick={entrarGoogle}>Continuar com Google</button><p className="nota">Ou use seu e-mail e senha abaixo.</p></div>}
    <form onSubmit={enviar} className="pilha" aria-busy={ocupado}>
      <Campo label="E-mail" name="email" type="email" required disabled={ocupado} autoComplete="email" autoCapitalize="none" spellCheck={false} value={email} onChange={e => setEmail(e.currentTarget.value)} />
      {modo !== 'recuperar' && <>
        <Campo label="Senha" name="password" type={mostrarSenha ? 'text' : 'password'} required disabled={ocupado} minLength={modo === 'cadastrar' ? 6 : undefined} aria-describedby={modo === 'cadastrar' ? 'ajuda-senha' : undefined} autoComplete={modo === 'cadastrar' ? 'new-password' : 'current-password'} value={senha} onChange={e => setSenha(e.currentTarget.value)} />
        {modo === 'cadastrar' && <><p id="ajuda-senha" className="nota">Use pelo menos 6 caracteres. Prefira uma senha longa e exclusiva. Os requisitos de segurança da conta também serão verificados.</p><Campo label="Confirmar senha" name="password-confirmation" type={mostrarSenha ? 'text' : 'password'} required disabled={ocupado} autoComplete="new-password" value={confirmarSenha} onChange={e => setConfirmarSenha(e.currentTarget.value)} /></>}
        <button type="button" className="botao secundario" aria-pressed={mostrarSenha} disabled={ocupado} onClick={() => setMostrarSenha(v => !v)}>{mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}</button>
      </>}
      {erro && <p role="alert" className="mensagem erro">{erro}</p>}
      {mensagem && <p role="status" className="mensagem sucesso">{mensagem}</p>}
      {modo === 'recuperar' && mensagem && <p className="nota">Confira também o spam. Abra o link recebido para escolher uma nova senha. Se não receber, confira o endereço informado e tente novamente mais tarde.</p>}
      <button type="submit" className="botao primario largo" disabled={ocupado}>{ocupado ? 'Aguarde…' : modo === 'entrar' ? 'Entrar na minha conta' : modo === 'cadastrar' ? 'Criar conta' : 'Enviar instruções'}</button>
    </form>
    <p className="nota">Antes de criar sua conta, consulte as <Link href="/privacidade">informações de privacidade</Link> e saiba como seus dados são usados.</p>
    <p className="nota"><Link href="/cookies">Cookies e armazenamento</Link></p>
    <div className="auth-links">
      {modo !== 'entrar' && <button type="button" disabled={ocupado} onClick={() => mudarModo('entrar')}>Voltar para entrar</button>}
      {modo !== 'cadastrar' && <button type="button" disabled={ocupado} onClick={() => mudarModo('cadastrar')}>Criar conta</button>}
      {modo !== 'recuperar' && <button type="button" disabled={ocupado} onClick={() => mudarModo('recuperar')}>Esqueci minha senha</button>}
    </div>
  </section></main>;
}
