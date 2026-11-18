'use client';

import {
  collection, doc, getDoc, onSnapshot, query, runTransaction, updateDoc, where,
  type DocumentSnapshot, type Firestore, type FirestoreError, type Unsubscribe,
} from 'firebase/firestore';
import { auth } from './firebase';

export type ConviteStatus = 'pending' | 'active' | 'revoked';

export interface ConviteCompartilhamento {
  ownerUid: string;
  email: string;
  status: ConviteStatus;
  partnerUid: string | null;
  createdAt: string;
  updatedAt: string;
  acceptedAt?: string;
  revokedAt?: string;
}
export function normalizarEmail(value: string | null | undefined) {
  return (value || '').trim().toLowerCase();
}

function agora() { return new Date().toISOString(); }

function conviteDaSnapshot(snapshot: DocumentSnapshot): ConviteCompartilhamento | null {
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  if (!data || typeof data.ownerUid !== 'string' || typeof data.email !== 'string' || typeof data.status !== 'string') return null;
  if (!['pending', 'active', 'revoked'].includes(data.status)) return null;
  return {
    ownerUid: data.ownerUid,
    email: data.email,
    status: data.status as ConviteStatus,
    partnerUid: typeof data.partnerUid === 'string' ? data.partnerUid : null,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
    ...(typeof data.acceptedAt === 'string' ? { acceptedAt: data.acceptedAt } : {}),
    ...(typeof data.revokedAt === 'string' ? { revokedAt: data.revokedAt } : {}),
  };
}

function exigirSessao(uid: string) {
  if (auth.currentUser?.uid !== uid || auth.currentUser.isAnonymous) throw new Error('Confirme sua conta antes de alterar o compartilhamento.');
}

export async function criarConvite(db: Firestore, ownerUid: string, email: string) {
  exigirSessao(ownerUid);
  const normalized = normalizarEmail(email);
  if (!normalized || !normalized.includes('@')) throw new Error('Informe um e-mail válido para o convite.');
  if (normalizarEmail(auth.currentUser?.email) === normalized) throw new Error('Use o e-mail de outra conta para criar a parceria.');
  const ref = doc(db, 'shareInvites', ownerUid);
  const now = agora();
  let criado: ConviteCompartilhamento;
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref);
    const anterior = conviteDaSnapshot(snapshot);
    if (anterior?.status === 'pending') throw new Error('Já existe um convite pendente para esta conta.');
    if (anterior?.status === 'active') throw new Error('Já existe uma parceira ativa. Revogue o acesso antes de convidar outra pessoa.');
    criado = {
      ownerUid, email: normalized, status: 'pending', partnerUid: null,
      createdAt: anterior?.createdAt || now, updatedAt: agora(),
    };
    transaction.set(ref, criado);
  });
  return criado!;
}

export async function revogarConvite(db: Firestore, ownerUid: string) {
  exigirSessao(ownerUid);
  const ref = doc(db, 'shareInvites', ownerUid);
  const snapshot = await getDoc(ref);
  const anterior = conviteDaSnapshot(snapshot);
  if (!anterior || !['pending', 'active'].includes(anterior.status)) throw new Error('Não há convite pendente ou parceria ativa para revogar.');
  const now = agora();
  await updateDoc(ref, { status: 'revoked', partnerUid: null, revokedAt: now, updatedAt: now });
}

export async function aceitarConvite(db: Firestore, ownerUid: string, partnerUid: string, email: string) {
  if (auth.currentUser?.uid !== partnerUid || auth.currentUser.isAnonymous) throw new Error('Entre na sua própria conta para aceitar o convite.');
  const normalized = normalizarEmail(email);
  if (!normalized || normalizarEmail(auth.currentUser.email) !== normalized) throw new Error('O e-mail autenticado não corresponde ao convite.');
  if (!auth.currentUser.emailVerified) throw new Error('Confirme seu e-mail antes de aceitar o convite.');
  await updateDoc(doc(db, 'shareInvites', ownerUid), {
    status: 'active', partnerUid, acceptedAt: agora(), updatedAt: agora(),
  });
}

export function observarConviteDoProprietario(db: Firestore, ownerUid: string,
  onValue: (value: ConviteCompartilhamento | null) => void, onError: (error: FirestoreError) => void): Unsubscribe {
  return onSnapshot(doc(db, 'shareInvites', ownerUid), snapshot => onValue(conviteDaSnapshot(snapshot)), error => onError(error));
}

export function observarConvitesPendentes(db: Firestore, email: string,
  onValue: (value: ConviteCompartilhamento[]) => void, onError: (error: FirestoreError) => void): Unsubscribe {
  const normalized = normalizarEmail(email);
  if (!normalized) { onValue([]); return () => {}; }
  const pending = query(collection(db, 'shareInvites'), where('email', '==', normalized), where('status', '==', 'pending'));
  return onSnapshot(pending, snapshot => onValue(snapshot.docs.map(conviteDaSnapshot).filter((item): item is ConviteCompartilhamento => Boolean(item))), error => onError(error));
}

export function observarCompartilhamentosAtivos(db: Firestore, partnerUid: string,
  onValue: (value: ConviteCompartilhamento[]) => void, onError: (error: FirestoreError) => void): Unsubscribe {
  const active = query(collection(db, 'shareInvites'), where('partnerUid', '==', partnerUid), where('status', '==', 'active'));
  return onSnapshot(active, snapshot => onValue(snapshot.docs.map(conviteDaSnapshot).filter((item): item is ConviteCompartilhamento => Boolean(item))), error => onError(error));
}
