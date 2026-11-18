'use client';

import { useEffect, useRef, useState } from 'react';
import { db, auth } from './firebase';
import { dadosPadrao, lerDados, type DadosPersistidos } from './gestao';
import { SyncSession, version, type Recovery, type ResetPlan, type ResetConfirmation, type SyncSessionOptions } from './syncSession';

export function useGestao(uid: string, options: SyncSessionOptions = {}) {
  const readOnly = options.readOnly === true;
  const storageNamespace = options.storageNamespace;
  const session = useRef<SyncSession<DadosPersistidos> | null>(null);
  const [view, setView] = useState({ dados: null as DadosPersistidos | null,
    dadosNuvem: null as DadosPersistidos | null, status: 'Carregando seus dados…',
    erro: '', conflito: false, geracaoAnterior: false, versaoNuvem: version(null),
    reinicio: null as ResetPlan | null, recuperacoes: [] as Recovery<DadosPersistidos>[] });
  useEffect(() => {
    const current = new SyncSession(db, uid, localStorage, sessionStorage, lerDados, dadosPadrao, undefined, { readOnly, storageNamespace });
    session.current = current;
    current.onChange = () => {
      let dadosNuvem: DadosPersistidos | null = null;
      let erro = current.error;
      try { if (current.remote) dadosNuvem = lerDados(current.remote); }
      catch { erro = 'A versão da nuvem tem formato inválido. Exporte as cópias antes de escolher uma versão.'; }
      setView({ dados: current.data, dadosNuvem,
        status: current.status, erro, conflito: current.conflict, geracaoAnterior: current.oldGeneration, reinicio: current.resetPlan,
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
  }, [uid, readOnly, storageNamespace]);
  return { ...view, somenteLeitura: readOnly,
    atualizar: (transform: (data: DadosPersistidos) => DadosPersistidos, formBase?: DadosPersistidos) => session.current?.update(transform, formBase) ?? false,
    resolver: (source: 'local' | 'nuvem', expectedVersion?: string) => session.current?.resolve(source, expectedVersion),
    recuperar: (key: string) => session.current?.recover(key),
    tentarNovamente: () => session.current?.retry(),
    prepararReinicio: async () => {
      if (auth.currentUser?.uid !== uid || !session.current) throw new Error('Confirme sua sessão antes de preparar a reinicialização.');
      return session.current.prepareReset();
    },
    backupReinicio: (id: string) => session.current?.resetBackup(id),
    marcarBackupExportado: (id: string) => session.current?.markResetExported(id),
    executarReinicio: async (id: string, confirmation: ResetConfirmation) => {
      if (auth.currentUser?.uid !== uid || !session.current) throw new Error('A sessão mudou. Nenhum dado será reinicializado.');
      return session.current.executeReset(id, confirmation);
    },
    verificarReinicio: () => session.current?.checkReset(),
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
