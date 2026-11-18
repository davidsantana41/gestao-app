'use client';

import { useCallback, useEffect, useState } from 'react';
import { db } from './firebase';
import {
  aceitarConvite, criarConvite, observarCompartilhamentosAtivos, observarConviteDoProprietario,
  observarConvitesPendentes, revogarConvite, type ConviteCompartilhamento,
} from './compartilhamento';

export interface EstadoCompartilhamento {
  meuConvite: ConviteCompartilhamento | null;
  pendentes: ConviteCompartilhamento[];
  ativos: ConviteCompartilhamento[];
  erro: string;
  convidar: (email: string) => Promise<void>;
  revogar: () => Promise<void>;
  aceitar: (convite: ConviteCompartilhamento) => Promise<void>;
}
export function useCompartilhamento(uid: string, email: string | null): EstadoCompartilhamento {
  const [meuConvite, setMeuConvite] = useState<ConviteCompartilhamento | null>(null);
  const [pendentes, setPendentes] = useState<ConviteCompartilhamento[]>([]);
  const [ativos, setAtivos] = useState<ConviteCompartilhamento[]>([]);
  const [erro, setErro] = useState('');
  useEffect(() => {
    const falha = (error: unknown) => setErro(error instanceof Error ? error.message : 'Não foi possível verificar os compartilhamentos.');
    const unsub = [
      observarConviteDoProprietario(db, uid, setMeuConvite, falha),
      observarConvitesPendentes(db, email || '', setPendentes, falha),
      observarCompartilhamentosAtivos(db, uid, setAtivos, falha),
    ];
    return () => unsub.forEach(stop => stop());
  }, [uid, email]);
  const convidar = useCallback(async (partnerEmail: string) => {
    await criarConvite(db, uid, partnerEmail);
  }, [uid]);
  const revogar = useCallback(async () => {
    await revogarConvite(db, uid);
  }, [uid]);
  const aceitar = useCallback(async (convite: ConviteCompartilhamento) => {
    await aceitarConvite(db, convite.ownerUid, uid, email || '');
  }, [uid, email]);
  return { meuConvite, pendentes, ativos, erro, convidar, revogar, aceitar };
}
