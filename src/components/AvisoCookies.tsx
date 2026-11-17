'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const chave = 'appcar-aviso-armazenamento-v1';

export default function AvisoCookies() {
  const [visivel, setVisivel] = useState(false);
  useEffect(() => {
    // A preferência é lida após a hidratação; não contém dados de conta.
    const carregar = () => {
      try { setVisivel(localStorage.getItem(chave) !== 'lido'); }
      catch { setVisivel(true); }
    };
    const timer = setTimeout(carregar, 0);
    return () => clearTimeout(timer);
  }, []);
  if (!visivel) return null;
  return <aside className="aviso-cookies" aria-label="Cookies e armazenamento">
    <div><h2>Cookies e armazenamento</h2><p>Usamos armazenamento para manter seu acesso, preservar registros e recuperar cópias neste navegador. O APPCAR não ativa ferramentas de publicidade ou análise de audiência nesta versão.</p><Link href="/cookies">Consultar política de cookies e armazenamento</Link></div>
    <button type="button" className="botao secundario" onClick={() => {
      try { localStorage.setItem(chave, 'lido'); } catch { /* O aviso pode reaparecer na próxima visita. */ }
      setVisivel(false);
    }}>Fechar aviso</button>
  </aside>;
}
