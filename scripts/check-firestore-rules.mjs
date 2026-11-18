import { readFile } from 'node:fs/promises';
import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where } from 'firebase/firestore';

// Never import the application's Firebase initialization or use a real project ID.
const projectId = 'demo-appcar-isolation';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8088') {
  throw new Error('Tests require FIRESTORE_EMULATOR_HOST=127.0.0.1:8088. No production fallback.');
}
let env;
const data = () => ({ custosFixos: [], reservasDiarias: [], nomeReserva1: 'A', nomeReserva2: 'B', nomeReserva3: 'C', lembrete: '', historico: [], modoEscuro: true });
const own = (db, uid) => doc(db, 'users', uid, 'appData', 'main');
const invite = (ownerUid, email, status = 'pending', partnerUid = null) => ({
  ownerUid, email, status, partnerUid, createdAt: '2026-11-17T10:00:00.000Z', updatedAt: '2026-11-17T10:00:00.000Z',
  ...(status === 'active' ? { acceptedAt: '2026-11-17T11:00:00.000Z' } : {}),
  ...(status === 'revoked' ? { revokedAt: '2026-11-17T12:00:00.000Z' } : {}),
});
const share = (db, ownerUid) => doc(db, 'shareInvites', ownerUid);
before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: {
    host: '127.0.0.1', port: 8088,
    rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
  } });
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    for (const uid of ['alice', 'bob', 'anonymous']) await setDoc(own(ctx.firestore(), uid), data());
  });
});
after(async () => { await env?.cleanup(); });

for (const [label, uid, token] of [
  ['password verified', 'alice', { email_verified: true, firebase: { sign_in_provider: 'password' } }],
  ['password unverified', 'alice', { email_verified: false, firebase: { sign_in_provider: 'password' } }],
  ['Google', 'bob', { email_verified: true, firebase: { sign_in_provider: 'google.com' } }],
  ['anonymous', 'anonymous', { firebase: { sign_in_provider: 'anonymous' } }],
]) {
  test(`${label}: own read/create/update allowed; own delete denied`, async () => {
    const db = env.authenticatedContext(uid, token).firestore();
    const ref = own(db, uid);
    const snapshot = await assertSucceeds(getDoc(ref));
    assert.equal(snapshot.exists(), true);
    await assertSucceeds(updateDoc(ref, { lembrete: 'changed' }));
    await assertFails(deleteDoc(ref));
    await env.withSecurityRulesDisabled(ctx => deleteDoc(own(ctx.firestore(), uid)));
    await assertSucceeds(setDoc(ref, data()));
    await assertFails(setDoc(ref, { ...data(), extra: true }));
    await assertFails(updateDoc(ref, { extra: true }));
  });
  test(`${label}: other users and other paths denied`, async () => {
    const db = env.authenticatedContext(uid, token).firestore();
    const otherUid = uid === 'alice' ? 'bob' : 'alice';
    const other = own(db, otherUid);
    await assertFails(getDoc(other));
    await assertFails(setDoc(other, data()));
    await assertFails(updateDoc(other, { lembrete: 'unauthorized' }));
    await assertFails(deleteDoc(other));
    await env.withSecurityRulesDisabled(ctx => deleteDoc(own(ctx.firestore(), otherUid)));
    await assertFails(setDoc(other, data()));
    for (const path of [`users/${uid}`, `users/${uid}/appData/other`, 'other/main']) {
      const ref = doc(db, path);
      await assertFails(getDoc(ref));
      await assertFails(setDoc(ref, data()));
      await assertFails(deleteDoc(ref));
    }
    await assertFails(getDocs(collection(db, 'users')));
  });
}
test('unauthenticated: read/create/update/delete denied', async () => {
  const db = env.unauthenticatedContext().firestore();
  const ref = own(db, 'alice');
  await assertFails(getDoc(ref));
  await assertFails(setDoc(ref, data()));
  await assertFails(updateDoc(ref, { lembrete: 'unauthorized' }));
  await assertFails(deleteDoc(ref));
  await env.withSecurityRulesDisabled(ctx => deleteDoc(own(ctx.firestore(), 'alice')));
  await assertFails(setDoc(ref, data()));
});

test('compartilhamento: owner creates, reads, cancels and re-invites without touching financial data', async () => {
  const db = env.authenticatedContext('alice', { email: 'alice@example.com', email_verified: true }).firestore();
  const ref = share(db, 'alice');
  await assertSucceeds(setDoc(ref, invite('alice', 'partner@example.com')));
  assert.equal((await assertSucceeds(getDoc(ref))).data().status, 'pending');
  await assertFails(setDoc(ref, invite('alice', 'other@example.com')));
  await assertSucceeds(updateDoc(ref, { status: 'revoked', partnerUid: null, revokedAt: '2026-11-17T12:00:00.000Z', updatedAt: '2026-11-17T12:00:00.000Z' }));
  await assertSucceeds(setDoc(ref, invite('alice', 'new-partner@example.com')));
  assert.equal((await assertSucceeds(getDoc(own(db, 'alice')))).data().historico.length, 0);
});

test('compartilhamento: pending invite is visible only to the invited email and cannot be accepted by another account', async () => {
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(share(ctx.firestore(), 'alice'), invite('alice', 'partner@example.com'));
  });
  const partner = env.authenticatedContext('partner', { email: 'PARTNER@EXAMPLE.COM', email_verified: false }).firestore();
  const pending = query(collection(partner, 'shareInvites'), where('email', '==', 'partner@example.com'), where('status', '==', 'pending'));
  assert.equal((await assertSucceeds(getDocs(pending))).size, 1);
  const wrong = env.authenticatedContext('wrong', { email: 'wrong@example.com', email_verified: true }).firestore();
  const wrongQuery = query(collection(wrong, 'shareInvites'), where('email', '==', 'wrong@example.com'), where('status', '==', 'pending'));
  assert.equal((await assertSucceeds(getDocs(wrongQuery))).size, 0);
  await assertFails(updateDoc(share(wrong, 'alice'), { status: 'active', partnerUid: 'wrong', acceptedAt: '2026-11-17T11:00:00.000Z', updatedAt: '2026-11-17T11:00:00.000Z' }));
  await assertFails(getDoc(share(wrong, 'alice')));
  await assertFails(getDoc(own(partner, 'alice')));
  const verifiedPartner = env.authenticatedContext('partner', { email: 'PARTNER@EXAMPLE.COM', email_verified: true }).firestore();
  await assertSucceeds(updateDoc(share(verifiedPartner, 'alice'), { status: 'active', partnerUid: 'partner', acceptedAt: '2026-11-17T11:00:00.000Z', updatedAt: '2026-11-17T11:00:00.000Z' }));
  assert.equal((await assertSucceeds(getDoc(own(verifiedPartner, 'alice')))).exists(), true);
});

test('compartilhamento: verified partner reads owner data, cannot write, and loses access after revocation', async () => {
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(share(ctx.firestore(), 'alice'), invite('alice', 'partner@example.com', 'active', 'partner'));
  });
  const partner = env.authenticatedContext('partner', { email: 'partner@example.com', email_verified: true }).firestore();
  assert.equal((await assertSucceeds(getDoc(own(partner, 'alice')))).exists(), true);
  await assertFails(updateDoc(own(partner, 'alice'), { lembrete: 'não pode' }));
  await assertFails(deleteDoc(own(partner, 'alice')));
  assert.equal((await assertSucceeds(getDocs(query(collection(partner, 'shareInvites'), where('partnerUid', '==', 'partner'), where('status', '==', 'active'))))).size, 1);
  const owner = env.authenticatedContext('alice', { email: 'alice@example.com', email_verified: true }).firestore();
  await assertSucceeds(updateDoc(share(owner, 'alice'), { status: 'revoked', partnerUid: null, revokedAt: '2026-11-17T12:00:00.000Z', updatedAt: '2026-11-17T12:00:00.000Z' }));
  await assertFails(getDoc(own(partner, 'alice')));
  assert.equal((await assertSucceeds(getDocs(query(collection(partner, 'shareInvites'), where('partnerUid', '==', 'partner'), where('status', '==', 'active'))))).size, 0);
});

test('compartilhamento: unauthenticated and anonymous accounts cannot discover or use invites', async () => {
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(share(ctx.firestore(), 'alice'), invite('alice', 'partner@example.com'));
  });
  const unauth = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(share(unauth, 'alice')));
  await assertFails(getDocs(query(collection(unauth, 'shareInvites'), where('email', '==', 'partner@example.com'), where('status', '==', 'pending'))));
  const anonymous = env.authenticatedContext('anonymous', { email: 'partner@example.com', email_verified: true, firebase: { sign_in_provider: 'anonymous' } }).firestore();
  await assertFails(getDocs(query(collection(anonymous, 'shareInvites'), where('email', '==', 'partner@example.com'), where('status', '==', 'pending'))));
  await assertFails(setDoc(share(anonymous, 'anonymous'), invite('anonymous', 'partner@example.com')));
});
