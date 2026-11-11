'use client';

import { useState, type FormEvent } from 'react';
import { EmailAuthProvider, createUserWithEmailAndPassword, linkWithCredential, sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';

export default function AuthGate() {
  const [modo, setModo] = useState<'entrar' | 'cadastrar' | 'recuperar'>('entrar');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOcupado(true); setErro(''); setMensagem('');
    try {
      if (modo === 'recuperar') {
        await sendPasswordResetEmail(auth, email.trim());
        setMensagem('Se houver uma conta com este e-mail, você receberá instruções para recuperar a senha.');
      } else if (modo === 'cadastrar') {
        // Vincular a conta preserva o UID e os dados Firestore de uma sessão anônima existente.
        const atual = auth.currentUser;
        if (atual?.isAnonymous) {
          await linkWithCredential(atual, EmailAuthProvider.credential(email.trim(), senha));
        } else {
          await createUserWithEmailAndPassword(auth, email.trim(), senha);
        }
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), senha);
      }
    } catch (e: unknown) {
      const codigo = typeof e === 'object' && e !== null && 'code' in e ? String(e.code) : '';
      if (codigo === 'auth/email-already-in-use') setErro('Este e-mail já está cadastrado. Entre com sua conta.');
      else if (codigo === 'auth/weak-password') setErro('Escolha uma senha mais forte, com pelo menos 6 caracteres.');
      else if (codigo === 'auth/invalid-email') setErro('Informe um e-mail válido.');
      else if (codigo === 'auth/too-many-requests') setErro('Muitas tentativas. Aguarde um pouco e tente novamente.');
      else setErro('Não foi possível concluir. Confira os dados e tente novamente.');
    } finally { setOcupado(false); }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-5">
      <section className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-7 shadow-xl">
        <h1 className="text-3xl font-bold text-center">APPCAR</h1>
        <p className="text-center text-slate-400 mt-2 mb-7">Gestão financeira do seu trabalho</p>
        <h2 className="text-xl font-semibold mb-5">{modo === 'entrar' ? 'Entrar na conta' : modo === 'cadastrar' ? 'Criar conta' : 'Recuperar senha'}</h2>
        <form onSubmit={enviar} className="space-y-4">
          <label className="block text-sm">E-mail
            <input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-600 p-3 text-white" />
          </label>
          {modo !== 'recuperar' && <label className="block text-sm">Senha
            <input type="password" required minLength={6} autoComplete={modo === 'cadastrar' ? 'new-password' : 'current-password'} value={senha} onChange={e => setSenha(e.target.value)} className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-600 p-3 text-white" />
          </label>}
          {erro && <p role="alert" className="text-sm text-rose-400">{erro}</p>}
          {mensagem && <p role="status" className="text-sm text-emerald-400">{mensagem}</p>}
          <button type="submit" disabled={ocupado} className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 p-3 font-semibold">{ocupado ? 'Aguarde...' : modo === 'entrar' ? 'Entrar' : modo === 'cadastrar' ? 'Cadastrar' : 'Enviar e-mail'}</button>
        </form>
        <div className="mt-5 flex flex-wrap justify-center gap-4 text-sm text-blue-300">
          {modo !== 'entrar' && <button type="button" onClick={() => {setModo('entrar');setErro('');setMensagem('');}}>Voltar ao login</button>}
          {modo !== 'cadastrar' && <button type="button" onClick={() => {setModo('cadastrar');setErro('');setMensagem('');}}>Criar conta</button>}
          {modo !== 'recuperar' && <button type="button" onClick={() => {setModo('recuperar');setErro('');setMensagem('');}}>Esqueci minha senha</button>}
        </div>
      </section>
    </main>
  );
}
