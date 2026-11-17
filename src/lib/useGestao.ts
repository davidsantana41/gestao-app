'use client';

import { useEffect, useRef, useState } from 'react';
import { db } from './firebase';
import { dadosPadrao, lerDados, type DadosPersistidos } from './gestao';
import { SyncSession, version, type Recovery } from './syncSession';

export function useGestao(uid: string) {
  const session = useRef<SyncSession<DadosPersistidos> | null>(null);
  const [view, setView] = useState({ dados: null as DadosPersistidos | null,
    dadosNuvem: null as DadosPersistidos | null, status: 'Carregando seus dados…',
    erro: '', conflito: false, versaoNuvem: version(null), recuperacoes: [] as Recovery<DadosPersistidos>[] });
  useEffect(() => {
    const current = new SyncSession(db, uid, localStorage, sessionStorage, lerDados, dadosPadrao);
    session.current = current;
    current.onChange = () => {
      let dadosNuvem: DadosPersistidos | null = null;
      let erro = current.error;
      try { if (current.remote) dadosNuvem = lerDados(current.remote); }
      catch { erro = 'A versão da nuvem tem formato inválido. Exporte as cópias antes de escolher uma versão.'; }
      setView({ dados: current.data, dadosNuvem,
        status: current.status, erro, conflito: current.conflict,
        versaoNuvem: version(current.remote), recuperacoes: current.recoveries });
    };
    void current.start();
    const online = () => { void current.retry(); };
    const storage = (event: StorageEvent) => { if (event.key === current.prefix) void current.refresh(); };
    window.addEventListener('online', online);
    window.addEventListener('storage', storage);
    return () => {
      current.close(); window.removeEventListener('online', online); window.removeEventListener('storage', storage);
    };
  }, [uid]);
  return { ...view,
    atualizar: (transform: (data: DadosPersistidos) => DadosPersistidos) => session.current?.update(transform) ?? false,
    resolver: (source: 'local' | 'nuvem', expectedVersion?: string) => session.current?.resolve(source, expectedVersion),
    recuperar: (key: string) => session.current?.recover(key),
    tentarNovamente: () => session.current?.retry(),
    aguardar: async () => {
      const active = session.current;
      if (!active) throw new Error('Dados indisponíveis');
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([active.wait(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Sincronização pendente')), 10000);
      })]); } finally { clearTimeout(timer); }
    },
  };
}
