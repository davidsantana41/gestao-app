import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDocFromServer, setDoc, disableNetwork, enableNetwork, runTransaction } from 'firebase/firestore';
import { SyncSession, conditionalWrite, SyncConflict, version, readWithTimeout } from '../src/lib/syncSession.ts';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8088') throw new Error('Local Emulator required; no production fallback');
const projectId='demo-appcar-isolation';
let env, a, b;
const initial=()=>({historico:[{id:'original',valor:100}],lembrete:'',modoEscuro:true});
const ref=db=>doc(db,'users','sync-user','appData','main');
class Store {
  values=new Map(); fail=false;
  get length(){return this.values.size;}
  key(i){return [...this.values.keys()][i]??null;}
  getItem(k){return this.values.get(k)??null;}
  setItem(k,v){if(this.fail)throw new Error('Quota');this.values.set(k,v);}
}
const decode=value=>structuredClone(value);
const create=(db,local=new Store(),tab=new Store())=>new SyncSession(db,'sync-user',local,tab,decode,initial);
const read=async()=> (await getDocFromServer(ref(b))).data();
const edit=(s,id)=>s.update(d=>({...d,historico:[...d.historico,{id,valor:10}]}));
const gate=()=>{let release;const promise=new Promise(r=>{release=r;});return {promise,release};};
before(async()=>{env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8088,rules:await readFile('firestore.rules','utf8')}});});
beforeEach(async()=>{await env.clearFirestore();a=env.authenticatedContext('sync-user').firestore();b=env.authenticatedContext('sync-user').firestore();await setDoc(ref(a),initial());});
after(async()=>{await env?.cleanup();});

test('same base, simultaneous writes: exactly one accepted, loser is a conflict',async()=>{
 const base=await read();const start=gate();
 const attempt=async(db,id)=>{await start.promise;return conditionalWrite(db,'sync-user',base,{...base,lembrete:id});};
 const tasks=[attempt(a,'A'),attempt(b,'B')];start.release();
 const results=await Promise.allSettled(tasks);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.ok(results.find(r=>r.status==='rejected').reason instanceof SyncConflict);
 assert.deepEqual((await read()).historico,base.historico);
});
test('SDK retries recheck original base after a forced concurrent commit',async()=>{
 const base=await read(), entered=gate(), resume=gate();let attempts=0;
 const tx=runTransaction(a,async t=>{const snapshot=await t.get(ref(a));attempts++;if(attempts===1){entered.release();await resume.promise;}if(version(snapshot.data())!==version(base))throw new SyncConflict(snapshot.data());t.set(ref(a),{...base,lembrete:'stale'});});
 await entered.promise;await conditionalWrite(b,'sync-user',base,{...base,lembrete:'winner'});resume.release();
 await assert.rejects(tx,SyncConflict);assert.ok(attempts>=2);assert.equal((await read()).lembrete,'winner');
});
test('stale theme change cannot erase another device turn',async()=>{
 const x=create(a),y=create(b);await Promise.all([x.start(),y.start()]);edit(x,'A');await x.wait();
 y.update(d=>({...d,modoEscuro:false}));await y.flush();assert.equal(y.conflict,true);assert.equal(y.pending,true);
 assert.equal((await read()).historico.length,2);assert.equal(y.data.modoEscuro,false);
});
test('stale edit cannot resurrect an excluded record',async()=>{
 const base=await read();await conditionalWrite(a,'sync-user',base,{...base,historico:[]});
 await assert.rejects(conditionalWrite(b,'sync-user',base,{...base,lembrete:'stale'}),SyncConflict);assert.deepEqual((await read()).historico,[]);
});
test('offline edit survives reload; reconnection detects a changed server',async()=>{
 const local=new Store(),tab=new Store(),x=create(a,local,tab);await x.start();await disableNetwork(a);edit(x,'offline');await x.flush();assert.equal(x.pending,true);
 x.close();const reloaded=create(a,local,tab);await reloaded.start();assert.equal(reloaded.data.historico.length,2);
 const base=await read();await conditionalWrite(b,'sync-user',base,{...base,lembrete:'other device'});
 await enableNetwork(a);await reloaded.retry();assert.equal(reloaded.conflict,true);assert.equal(reloaded.pending,true);assert.equal((await read()).historico.length,1);
});
test('offline edit without remote changes reconnects exactly once',async()=>{
 const x=create(a);await x.start();await disableNetwork(a);edit(x,'offline');await x.flush();await assert.rejects(x.wait());
 await enableNetwork(a);await x.retry();await x.wait();await x.retry();assert.equal((await read()).historico.length,2);assert.equal(x.pending,false);
});
test('cloud changes while conflict dialog is open: choice rejected and both preserved',async()=>{
 const x=create(a);await x.start();const base=await read();await conditionalWrite(b,'sync-user',base,{...base,lembrete:'B'});edit(x,'A');await x.flush();
 const current=await read();await conditionalWrite(b,'sync-user',current,{...current,lembrete:'C'});
 assert.equal(await x.resolve('local'),false);assert.equal((await read()).lembrete,'C');assert.equal(x.data.historico.length,2);
 assert.ok([...x['local'].values.keys()].some(k=>k.includes('-antes-resolver-local-')));
});
test('explicit remote choice preserves rejected local data in unique backups',async()=>{
 const local=new Store(),x=create(a,local);await x.start();const base=await read();await conditionalWrite(b,'sync-user',base,{...base,lembrete:'remote'});edit(x,'local');await x.flush();
 assert.equal(await x.resolve('nuvem'),true);assert.equal(x.data.lembrete,'remote');assert.equal(x.pending,false);
 const backups=[...local.values.entries()].filter(([k])=>k.includes('-antes-resolver-local-'));
 assert.equal(JSON.parse(backups[0][1]).historico.length,2);
});
test('explicit local choice checks current version and retains remote backup',async()=>{
 const local=new Store(),x=create(a,local);await x.start();const base=await read();await conditionalWrite(b,'sync-user',base,{...base,lembrete:'remote'});edit(x,'local');await x.flush();
 assert.equal(await x.resolve('local'),true);await x.wait();assert.equal((await read()).historico.length,2);
 assert.ok([...local.values.entries()].some(([k,v])=>k.includes('-antes-resolver-nuvem-')&&JSON.parse(v).lembrete==='remote'));
});
test('two tabs share localStorage but own separate pending journals',async()=>{
 const local=new Store(),tabA=new Store(),tabB=new Store(),x=create(a,local,tabA),y=create(b,local,tabB);await Promise.all([x.start(),y.start()]);
 await Promise.all([disableNetwork(a),disableNetwork(b)]);edit(x,'tabA');edit(y,'tabB');await Promise.all([x.flush(),y.flush()]);
 assert.notEqual(x.branch,y.branch);assert.equal(JSON.parse(local.getItem(x.branch)).data.historico[1].id,'tabA');assert.equal(JSON.parse(local.getItem(y.branch)).data.historico[1].id,'tabB');
 x.close();const reload=create(a,local,tabA);await reload.start();assert.equal(reload.data.historico[1].id,'tabA');assert.ok(reload.recoveries.some(r=>r.data.historico[1]?.id==='tabB'));
 await Promise.all([enableNetwork(a),enableNetwork(b)]);
});
test('multiple edits before confirmation remain pending until the latest is committed',async()=>{
 const x=create(a);await x.start();edit(x,'first');edit(x,'second');edit(x,'third');await x.wait();
 assert.equal((await read()).historico.length,4);assert.equal(x.pending,false);assert.equal(JSON.parse(x['local'].getItem(x.branch)).pending,false);
});
test('storage failure rejects change and writes nothing',async()=>{
 const local=new Store(),x=create(a,local);await x.start();local.fail=true;assert.equal(edit(x,'lost'),false);assert.equal(x.data.historico.length,1);assert.equal((await read()).historico.length,1);assert.match(x.error,/salvar/);
});
test('permission denied retains local pending and prevents a successful sign out wait',async()=>{
 const wrong=env.authenticatedContext('different-user').firestore(),x=create(wrong);x.data=initial();x.base=initial();x.known=true;
 edit(x,'denied');await x.flush();assert.equal(x.pending,true);await assert.rejects(x.wait());assert.equal((await read()).historico.length,1);
});
test('load and refresh never write; remote changes do not replace form source',async()=>{
 const x=create(a);await x.start();assert.deepEqual(await read(),initial());const base=await read();
 await conditionalWrite(b,'sync-user',base,{...base,lembrete:'new'});await x.refresh();assert.equal(x.data.lembrete,'');assert.equal(x.conflict,true);assert.equal((await read()).lembrete,'new');
});
test('missing document: concurrent creations cannot overwrite',async()=>{
 await env.clearFirestore();const results=await Promise.allSettled([conditionalWrite(a,'sync-user',null,initial()),conditionalWrite(b,'sync-user',null,{...initial(),lembrete:'B'})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.ok(results.find(r=>r.status==='rejected').reason instanceof SyncConflict);
});
test('legacy copies without a base demand a choice and are not uploaded',async()=>{
 const local=new Store();local.setItem('gestao-app-dados-v2-sync-user',JSON.stringify({...initial(),lembrete:'legacy'}));const x=create(a,local);await x.start();await x.flush();assert.equal(x.conflict,true);assert.equal((await read()).lembrete,'');
});
test('account isolation: recoveries never include another UID',async()=>{
 const local=new Store();local.setItem('gestao-app-dados-v2-other-sync-test',JSON.stringify({format:1,uid:'other',data:{private:true},pending:true}));const x=create(a,local);await x.start();assert.deepEqual(x.recoveries,[]);
});
test('content versions ignore property order but preserve nested financial values',()=>{
 assert.equal(version({a:1,b:[{x:2,y:3}]}),version({b:[{y:3,x:2}],a:1}));assert.notEqual(version({a:1}),version({a:2}));assert.notEqual(version(null),version({}));
});

test('a delayed acknowledgement never clears newer local changes',async()=>{
 const local=new Store(),entered=gate(),resume=gate();let first=true;
 const transport={read,write:async(base,next)=>{await conditionalWrite(a,'sync-user',base,next);if(first){first=false;entered.release();await resume.promise;}}};
 const x=new SyncSession(a,'sync-user',local,new Store(),decode,initial,transport);await x.start();edit(x,'first');await entered.promise;
 edit(x,'second');assert.equal(x.pending,true);assert.equal(JSON.parse(local.getItem(x.branch)).pending,true);resume.release();await x.wait();assert.equal((await read()).historico.length,3);
});
test('uncertain commit confirmation preserves pending data until verified remotely',async()=>{
 const local=new Store();let once=true;
 const x=new SyncSession(a,'sync-user',local,new Store(),decode,initial,{read,write:async(base,next)=>{await conditionalWrite(a,'sync-user',base,next);if(once){once=false;throw new Error('Confirmation lost');}}});
 await x.start();edit(x,'committed');await x.flush();assert.equal(x.pending,true);assert.equal(JSON.parse(local.getItem(x.branch)).pending,true);
 await x.retry();await x.wait();assert.equal(x.pending,false);assert.equal(x.conflict,false);assert.equal((await read()).historico.length,2);
});
test('closing a session during a transaction does not change the next session pointer',async()=>{
 const local=new Store(),tab=new Store(),entered=gate(),resume=gate();
 const x=new SyncSession(a,'sync-user',local,tab,decode,initial,{read,write:async(base,next)=>{await conditionalWrite(a,'sync-user',base,next);entered.release();await resume.promise;}});
 await x.start();edit(x,'old-tab');await entered.promise;x.close();const y=create(b,local,tab);await y.start();const pointer=tab.getItem(y.prefix+'-session');resume.release();await x.flush();
 assert.equal(tab.getItem(y.prefix+'-session'),pointer);assert.equal(JSON.parse(local.getItem(x.branch)).pending,true);
});
test('edits made while conflict choice is being fetched are never discarded',async()=>{
 const entered=gate(),resume=gate();let hold=false;
 const x=new SyncSession(a,'sync-user',new Store(),new Store(),decode,initial,{read:async()=>{const result=await read();if(hold){entered.release();await resume.promise;}return result;},write:(base,next)=>conditionalWrite(a,'sync-user',base,next)});
 await x.start();const base=await read();await conditionalWrite(b,'sync-user',base,{...base,lembrete:'remote'});edit(x,'local');await x.flush();hold=true;
 const resolution=x.resolve('nuvem');await entered.promise;edit(x,'newer-local');resume.release();assert.equal(await resolution,false);assert.equal(x.data.historico.length,3);assert.equal(x.pending,true);
});
test('refresh from storage event does not write shared compatibility keys',async()=>{
 const local=new Store(),x=create(a,local);await x.start();edit(x,'saved');await x.wait();const previous=local.getItem(x.prefix);
 const base=await read();await conditionalWrite(b,'sync-user',base,{...base,lembrete:'other'});await x.refresh();assert.equal(local.getItem(x.prefix),previous);assert.equal(x.conflict,true);
});
test('recovering another tab journal preserves current data and never writes automatically',async()=>{
 const local=new Store();const prefix='gestao-app-dados-v2-sync-user';
 local.setItem(prefix+'-sync-old',JSON.stringify({format:1,uid:'sync-user',base:initial(),data:{...initial(),lembrete:'recovered'},pending:true,known:true}));
 const x=create(a,local);await x.start();assert.equal(x.recover(prefix+'-sync-old'),true);assert.equal(x.data.lembrete,'recovered');assert.equal(x.conflict,true);assert.equal((await read()).lembrete,'');
 assert.ok([...local.values.keys()].some(k=>k.includes('-antes-recuperar-')));
});

test('read timeout rejects and ignores a late response',async()=>{
 const late=gate();
 await assert.rejects(readWithTimeout(()=>late.promise,5),/demorou/);
 late.release(initial());await Promise.resolve();
});

test('a background refresh while the modal is open cannot authorize a newer version',async()=>{
 const x=create(a);await x.start();const base=await read();await conditionalWrite(b,'sync-user',base,{...base,lembrete:'B'});edit(x,'local');await x.flush();
 const reviewed=version(x.remote);const current=await read();await conditionalWrite(b,'sync-user',current,{...current,lembrete:'C'});await x.refresh();
 assert.equal(await x.resolve('local',reviewed),false);assert.equal((await read()).lembrete,'C');assert.equal(x.data.historico.length,2);
});
