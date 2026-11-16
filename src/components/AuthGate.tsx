'use client';

import { useState, type FormEvent } from 'react';
import { EmailAuthProvider, createUserWithEmailAndPassword, linkWithCredential, sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Campo } from './gestao/Campo';

type Modo = 'entrar' | 'cadastrar' | 'recuperar';
export default function AuthGate() {
  const [modo, setModo] = useState<Modo>('entrar');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');
  const mudarModo = (proximo: Modo) => { setModo(proximo); setErro(''); setMensagem(''); };
  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOcupado(true); setErro(''); setMensagem('');
    try {
      if (modo === 'recuperar') {
        await sendPasswordResetEmail(auth, email.trim());
        setMensagem('Se houver uma conta com este e-mail, você receberá as instruções para recuperar a senha.');
      } else if (modo === 'cadastrar') {
        const atual = auth.currentUser;
        if (atual?.isAnonymous) await linkWithCredential(atual, EmailAuthProvider.credential(email.trim(), senha));
        else await createUserWithEmailAndPassword(auth, email.trim(), senha);
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
      };
      setErro(mensagens[codigo] || 'Não foi possível concluir. Confira os dados e tente novamente.');
    } finally { setOcupado(false); }
  }
  return <main className="acesso"><section className="painel auth-card">
    <div className="marca">A<span>APPCAR<small>Seu trabalho, suas contas.</small></span></div>
    <p className="sobretitulo">GESTÃO FINANCEIRA PARA QUEM DIRIGE</p>
    <h1>{modo === 'entrar' ? 'Bom ter você aqui.' : modo === 'cadastrar' ? 'Comece sua organização.' : 'Recupere seu acesso.'}</h1>
    <p className="ajuda">{modo === 'entrar' ? 'Entre com sua conta para acompanhar turnos, despesas e reservas.' : modo === 'cadastrar' ? 'Crie uma conta para guardar seus lançamentos e acessar de outros dispositivos.' : 'Enviaremos as instruções para o e-mail da sua conta.'}</p>
    <form onSubmit={enviar} className="pilha">
      <Campo label="E-mail" type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.currentTarget.value)} />
      {modo !== 'recuperar' && <Campo label="Senha" type="password" required minLength={6} autoComplete={modo === 'cadastrar' ? 'new-password' : 'current-password'} value={senha} onChange={e => setSenha(e.currentTarget.value)} />}
      {erro && <p role="alert" className="mensagem erro">{erro}</p>}
      {mensagem && <p role="status" className="mensagem sucesso">{mensagem}</p>}
      <button type="submit" className="botao primario largo" disabled={ocupado}>{ocupado ? 'Aguarde…' : modo === 'entrar' ? 'Entrar na minha conta' : modo === 'cadastrar' ? 'Criar conta' : 'Enviar instruções'}</button>
    </form>
    <div className="auth-links">
      {modo !== 'entrar' && <button type="button" disabled={ocupado} onClick={() => mudarModo('entrar')}>Voltar para entrar</button>}
      {modo !== 'cadastrar' && <button type="button" disabled={ocupado} onClick={() => mudarModo('cadastrar')}>Criar conta</button>}
      {modo !== 'recuperar' && <button type="button" disabled={ocupado} onClick={() => mudarModo('recuperar')}>Esqueci minha senha</button>}
    </div>
  </section></main>;
}
