'use client';

import { useRef, useState } from 'react';
import { reload, sendEmailVerification } from 'firebase/auth';
import { auth } from '@/lib/firebase';

export default function VerificarEmail() {
  const [verificado, setVerificado] = useState(auth.currentUser?.emailVerified ?? true);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');
  const proximoEnvio = useRef(0);
  if (verificado) return null;

  async function executar(acao: 'enviar' | 'verificar') {
    const usuario = auth.currentUser;
    if (!usuario || ocupado) return;
    if (acao === 'enviar' && Date.now() < proximoEnvio.current) {
      setErro('Aguarde um minuto entre os envios e confira também a pasta de spam.'); return;
    }
    setOcupado(true); setErro(''); setMensagem('');
    try {
      await reload(usuario);
      if (usuario.emailVerified) {
        await usuario.getIdToken(true);
        setVerificado(true);
        return;
      }
      if (acao === 'enviar') {
        await sendEmailVerification(usuario);
        proximoEnvio.current = Date.now() + 60000;
        setMensagem('E-mail de confirmação enviado. Abra o link recebido e depois clique em “Já confirmei meu e-mail”.');
      } else setMensagem('A confirmação ainda não foi identificada. Abra o link recebido no e-mail e tente novamente.');
    } catch (falha) {
      const codigo = typeof falha === 'object' && falha !== null && 'code' in falha ? String(falha.code) : '';
      setErro(codigo === 'auth/too-many-requests' ? 'Muitas tentativas. Aguarde alguns minutos antes de reenviar.' : 'Não foi possível concluir. Verifique sua conexão e tente novamente.');
    } finally { setOcupado(false); }
  }

  return <section className="painel aviso" aria-labelledby="confirmar-email-titulo" aria-busy={ocupado}>
    <h2 id="confirmar-email-titulo">Confirme seu e-mail</h2>
    <p>Para confirmar que este endereço é seu, abra o link enviado para <strong>{auth.currentUser?.email}</strong>. Se acabou de criar a conta, aguarde a mensagem e confira também o spam.</p>
    <div className="acoes"><button className="botao primario" type="button" disabled={ocupado} onClick={() => executar('verificar')}>Já confirmei meu e-mail</button><button className="botao secundario" type="button" disabled={ocupado} onClick={() => executar('enviar')}>Enviar confirmação de e-mail</button></div>
    {mensagem && <p className="mensagem sucesso" role="status">{mensagem}</p>}
    {erro && <p className="mensagem erro" role="alert">{erro}</p>}
  </section>;
}
