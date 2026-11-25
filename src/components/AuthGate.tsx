'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  linkWithCredential,
  linkWithPopup,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  validatePassword,
} from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Campo, CampoSenha } from './gestao/Campo';
import AppcarLogo from './AppcarLogo';

type Modo = 'entrar' | 'cadastrar' | 'recuperar';
type ModuloInicial = 'motorista' | 'familiar';

export default function AuthGate() {
  const [modo, setModo] = useState<Modo>('entrar');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [mostrarConfirmar, setMostrarConfirmar] = useState(false);
  const [moduloCadastro, setModuloCadastro] = useState<ModuloInicial>('motorista');
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');

  const mudarModo = (proximo: Modo) => {
    setModo(proximo);
    setErro('');
    setMensagem('');
    setSenha('');
    setConfirmarSenha('');
    setMostrarSenha(false);
    setMostrarConfirmar(false);
  };

  async function entrarGoogle() {
    if (ocupado) return;
    setOcupado(true);
    setErro('');
    setMensagem('');
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
    } finally {
      setOcupado(false);
    }
  }

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (ocupado) return;
    if (modo === 'cadastrar' && senha !== confirmarSenha) {
      setErro('As senhas não coincidem. Confira a confirmação da senha.');
      return;
    }
    setOcupado(true);
    setErro('');
    setMensagem('');
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

        try {
          localStorage.setItem('appcar-modulo-inicial', moduloCadastro);
        } catch {
          // Armazenamento local seguro e tolerante a falhas
        }

        const atual = auth.currentUser;
        const credencial = atual?.isAnonymous
          ? await linkWithCredential(atual, EmailAuthProvider.credential(email.trim(), senha))
          : await createUserWithEmailAndPassword(auth, email.trim(), senha);
        try {
          await sendEmailVerification(credencial.user);
        } catch {
          // O painel permite reenviar a confirmação.
        }
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), senha);
      }
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
    } finally {
      setOcupado(false);
    }
  }

  return (
    <main className="acesso">
      <section className="painel auth-card" aria-labelledby="auth-titulo">
        <header className="auth-header centralizado">
          <AppcarLogo tamanho="grande" centralizado />
          <p className="auth-slogan">Sua gestão financeira em um só lugar.</p>
          <h1 id="auth-titulo">
            {modo === 'entrar' && 'Acesse sua conta'}
            {modo === 'cadastrar' && 'Crie sua conta'}
            {modo === 'recuperar' && 'Recupere seu acesso'}
          </h1>
          <p className="ajuda auth-descricao">
            {modo === 'entrar' && 'Entre com seu e-mail ou continue com o Google.'}
            {modo === 'cadastrar' && 'Escolha como deseja começar e crie seu acesso.'}
            {modo === 'recuperar' && 'Enviaremos as instruções para o e-mail da sua conta.'}
          </p>
        </header>

        {modo === 'cadastrar' && (
          <div className="escolha-modulo-cadastro" role="group" aria-label="Como você deseja começar a usar o APPCAR?">
            <span className="escolha-rotulo">Como você deseja começar a usar o APPCAR?</span>
            <div className="escolha-opcoes">
              <button
                type="button"
                className={`escolha-card ${moduloCadastro === 'motorista' ? 'selecionado' : ''}`}
                onClick={() => setModuloCadastro('motorista')}
                aria-pressed={moduloCadastro === 'motorista'}
              >
                <div className="escolha-card-topo">
                  <span className="escolha-icone" aria-hidden="true">🚗</span>
                  <span className="escolha-badge badge-ativo">Disponível</span>
                </div>
                <strong>Motorista</strong>
                <small>Turnos, combustível e relatórios</small>
              </button>
              <button
                type="button"
                className={`escolha-card ${moduloCadastro === 'familiar' ? 'selecionado' : ''}`}
                onClick={() => setModuloCadastro('familiar')}
                aria-pressed={moduloCadastro === 'familiar'}
              >
                <div className="escolha-card-topo">
                  <span className="escolha-icone" aria-hidden="true">🏠</span>
                  <span className="escolha-badge badge-breve">Em breve</span>
                </div>
                <strong>Gestão Familiar</strong>
                <small>Orçamento e contas da residência</small>
              </button>
            </div>
          </div>
        )}

        <form onSubmit={enviar} className="pilha compacta" aria-busy={ocupado}>
          <Campo
            label="E-mail"
            name="email"
            type="email"
            required
            disabled={ocupado}
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={e => setEmail(e.currentTarget.value)}
          />

          {modo !== 'recuperar' && (
            <CampoSenha
              label="Senha"
              name="password"
              required
              disabled={ocupado}
              minLength={modo === 'cadastrar' ? 6 : undefined}
              aria-describedby={modo === 'cadastrar' ? 'ajuda-senha' : undefined}
              autoComplete={modo === 'cadastrar' ? 'new-password' : 'current-password'}
              value={senha}
              onChange={e => setSenha(e.currentTarget.value)}
              mostrar={mostrarSenha}
              onAlternarMostrar={() => setMostrarSenha(v => !v)}
            />
          )}

          {modo === 'cadastrar' && (
            <>
              <p id="ajuda-senha" className="nota">
                Use pelo menos 6 caracteres. Prefira uma senha longa e exclusiva. Os requisitos de segurança da conta também serão verificados.
              </p>
              <CampoSenha
                label="Confirmar senha"
                name="password-confirmation"
                required
                disabled={ocupado}
                autoComplete="new-password"
                value={confirmarSenha}
                onChange={e => setConfirmarSenha(e.currentTarget.value)}
                mostrar={mostrarConfirmar}
                onAlternarMostrar={() => setMostrarConfirmar(v => !v)}
              />
            </>
          )}

          {erro && <p role="alert" className="mensagem erro">{erro}</p>}
          {mensagem && <p role="status" className="mensagem sucesso">{mensagem}</p>}
          {modo === 'recuperar' && mensagem && (
            <p className="nota">
              Confira também o spam. Abra o link recebido para escolher uma nova senha. Se não receber, confira o endereço informado e tente novamente mais tarde.
            </p>
          )}

          <button type="submit" className="botao primario largo" disabled={ocupado}>
            {ocupado ? 'Aguarde…' : modo === 'entrar' ? 'Entrar na minha conta' : modo === 'cadastrar' ? 'Criar conta' : 'Enviar instruções'}
          </button>
        </form>

        {modo !== 'recuperar' && (
          <div className="auth-social">
            <div className="separador-ou"><span>ou</span></div>
            <button
              type="button"
              className="botao google largo"
              disabled={ocupado}
              onClick={entrarGoogle}
            >
              <svg className="icone-google" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z" />
                <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24z" />
                <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.16 0 9.98 0 12c0 2.02.45 3.84 1.25 5.42l4.03-3.15z" />
                <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
              </svg>
              <span>Continuar com Google</span>
            </button>
          </div>
        )}

        <div className="auth-links">
          {modo !== 'entrar' && (
            <button type="button" disabled={ocupado} onClick={() => mudarModo('entrar')}>
              Voltar para entrar
            </button>
          )}
          {modo !== 'cadastrar' && (
            <button type="button" disabled={ocupado} onClick={() => mudarModo('cadastrar')}>
              Criar conta
            </button>
          )}
          {modo !== 'recuperar' && (
            <button type="button" disabled={ocupado} onClick={() => mudarModo('recuperar')}>
              Esqueci minha senha
            </button>
          )}
        </div>

        <div className="auth-legal">
          <p className="nota">
            Consulte nossa <Link href="/privacidade">Política de Privacidade</Link> e de <Link href="/cookies">Cookies</Link>.
          </p>
        </div>
      </section>
    </main>
  );
}
