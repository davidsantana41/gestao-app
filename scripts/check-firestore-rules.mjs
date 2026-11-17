import { readFile } from 'node:fs/promises';
import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';

// Never import the application's Firebase initialization or use a real project ID.
const projectId = 'demo-appcar-isolation';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8088') {
  throw new Error('Tests require FIRESTORE_EMULATOR_HOST=127.0.0.1:8088. No production fallback.');
}
let env;
const data = () => ({ custosFixos: [], reservasDiarias: [], nomeReserva1: 'A', nomeReserva2: 'B', nomeReserva3: 'C', lembrete: '', historico: [], modoEscuro: true });
const own = (db, uid) => doc(db, 'users', uid, 'appData', 'main');
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
