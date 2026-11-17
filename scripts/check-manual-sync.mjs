// Full browser -> Auth Emulator -> Firestore Emulator validation. Test data only.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const dir = path.resolve(process.argv[2] || '.backups/manual-sync');
assert.ok(dir.startsWith(path.resolve('.backups') + path.sep), 'Test artifacts must stay in .backups');
const session = JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf8'));
assert.equal(session.projectId, 'demo-appcar-manual');
assert.equal(session.url, 'http://127.0.0.1:3100');
const evidence = path.join(dir, 'evidence-' + Date.now());
fs.mkdirSync(evidence, { recursive: true });
const results = [], browsers = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function localFetch(url, options) {
  const parsed = new URL(url);
  assert.equal(parsed.hostname, '127.0.0.1');
  assert.ok(['3100', '8188', '9198'].includes(parsed.port));
  return fetch(url, options);
}
function decode(value) {
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([k,v]) => [k,decode(v)]));
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  return value.stringValue;
}
const descriptions = data => data.historico.map(item => item.descricao);
function pass(name) { results.push({ name, status: 'PASS' }); console.log('PASS: ' + name); }

async function browser(executable, name) {
  const profile = path.join(evidence, 'profile-' + name);
  const child = spawn(executable, ['--headless=new','--no-sandbox','--no-first-run','--disable-gpu',
    '--disable-background-networking','--disable-component-update',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
    '--remote-debugging-port=0','--user-data-dir=' + profile,'about:blank'], { windowsHide: true });
  const endpoint = await new Promise((resolve,reject) => {
    const timer=setTimeout(()=>reject(new Error(name+' startup timeout')),20000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.stderr.on('data',data=>{const match=String(data).match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
  });
  const ws = new WebSocket(endpoint);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  let id=0;
  const pending=new Map(), errors=[], blocked=[], hosts=new Set();
  const send = (method, params={}, sessionId) => new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(requestId);reject(new Error(name+' CDP timeout: '+method));},30000);
    const requestId=++id;
    pending.set(requestId,message=>{clearTimeout(timer);if(message.error)reject(new Error(message.error.message));else resolve(message.result);});
    ws.send(JSON.stringify({id:requestId,method,params,sessionId}));
  });
  ws.addEventListener('message',event=>{
    const message=JSON.parse(event.data);
    const callback=pending.get(message.id);if(callback){pending.delete(message.id);callback(message);}
    if(message.method==='Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if(message.method==='Network.requestWillBeSent') {
      const url=new URL(message.params.request.url);
      if(url.protocol.startsWith('http'))hosts.add(url.host);
    }
    if(message.method==='Fetch.requestPaused') {
      const url=new URL(message.params.request.url);
      const local=['127.0.0.1','localhost'].includes(url.hostname);
      if(!local)blocked.push(url.origin);
      void send(local?'Fetch.continueRequest':'Fetch.failRequest',local?{requestId:message.params.requestId}:{requestId:message.params.requestId,errorReason:'BlockedByClient'},message.sessionId).catch(()=>{});
    }
  });
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  await send('Runtime.enable',{},sessionId);
  await send('Network.enable',{},sessionId);
  await send('Fetch.enable',{patterns:[{urlPattern:'http*',requestStage:'Request'}]},sessionId);
  const evaluate=async expression=>{
    const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);
    if(result.exceptionDetails)throw new Error(name+': '+(result.exceptionDetails.exception?.description || result.exceptionDetails.text));
    return result.result.value;
  };
  const wait=async(expression,timeout=20000)=>{
    const start=Date.now();while(Date.now()-start<timeout){if(await evaluate(expression))return;await pause(80);}
    throw new Error(name+' UI timeout: '+expression+'\n'+(await evaluate('document.body.innerText')).slice(-1800));
  };
  const click=async text=>{
    await evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!button)throw new Error('Missing button');button.click();})()`);
    await pause(100);
  };
  const fill=async(selector,value)=>{
    await evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});if(!input)throw new Error('Missing input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await pause(80);
  };
  const reload=async()=>{await send('Page.reload',{},sessionId);await wait("Boolean(document.querySelector('.cabecalho'))");};
  const screenshot=async label=>{
    const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true},sessionId);
    fs.writeFileSync(path.join(evidence,name+'-'+label+'.png'),Buffer.from(data,'base64'));
  };
  const local=()=>evaluate(`JSON.parse(localStorage.getItem('gestao-app-dados-v2-${session.uid}'))`);
  const backups=()=>evaluate(`Object.keys(localStorage).filter(k=>k.startsWith('gestao-app-dados-v2-${session.uid}-')).map(k=>({key:k,value:JSON.parse(localStorage.getItem(k))}))`);
  const movement=async(description,amount,type='entrada')=>{
    await click('Registrar turno');
    await evaluate(`(()=>{const input=document.querySelector('.avulso-grid select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,${JSON.stringify(type)});input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await pause(80);
    await evaluate(`(()=>{const label=[...document.querySelectorAll('.avulso-grid label')].find(label=>label.querySelector('span')?.textContent==='Descrição');const input=label.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(description)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await pause(80);
    await fill('.avulso-grid input[inputmode="decimal"]',String(amount));
    await click('Registrar movimentação');
    await wait(`Boolean(JSON.parse(localStorage.getItem('gestao-app-dados-v2-${session.uid}'))?.historico.some(item=>item.descricao===${JSON.stringify(description)}))`);
  };
  const settled=()=>wait("[...document.querySelectorAll('.barra-status [role=status]')].some(e=>e.textContent.includes('Salvo na nuvem'))");
  const conflict=()=>wait("document.body.textContent.includes('Escolha a versão dos seus dados')");
  const choose=async source=>{await click(source==='local'?'Usar dados deste navegador':'Usar dados da nuvem');await wait("Boolean(document.querySelector('dialog[open]'))");await click('Confirmar escolha');};
  const stop=async()=>{try{await send('Browser.close');}catch{}ws.close();await pause(500);if(child.exitCode===null)child.kill();};
  const instance={name,profile,child,errors,blocked,hosts,evaluate,wait,click,fill,reload,screenshot,local,backups,movement,settled,conflict,choose,stop};
  browsers.push(instance);
  await send('Page.navigate',{url:session.url},sessionId);
  await wait("Boolean(document.querySelector('input[name=email]'))");
  await fill('input[name=email]',session.email);await fill('input[name=password]',session.password);
  await evaluate("document.querySelector('form').requestSubmit()");
  await wait("Boolean(document.querySelector('.cabecalho'))");
  await wait("document.body.textContent.includes('Dados carregados')");
  return instance;
}

async function main() {
  const page = await localFetch(session.url);
  assert.ok((await page.text()).includes('demo-appcar-manual'));
  const response = await localFetch('http://127.0.0.1:9198/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-only-not-a-real-key',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:session.email,password:session.password,returnSecureToken:true})
  });
  const account=await response.json();assert.equal(account.localId,session.uid);
  const server=async()=>{
    const response=await localFetch(`http://127.0.0.1:8188/v1/projects/demo-appcar-manual/databases/(default)/documents/users/${session.uid}/appData/main`,{headers:{Authorization:'Bearer '+account.idToken}});
    assert.equal(response.status,200);const body=await response.json();return decode({mapValue:{fields:body.fields}});
  };
  assert.deepEqual((await server()).historico,[], 'Use a fresh manual environment; the runner never resets an existing session.');
  const a=await browser('C:/Program Files/Google/Chrome/Application/chrome.exe','chrome');
  const b=await browser('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','edge');
  assert.deepEqual((await server()).historico,[]);pass('Chrome e Edge autenticados na mesma conta local; carregar não grava dados');

  await a.movement('Receita A1 teste',100);await a.settled();
  await b.movement('Despesa B1 teste',20,'saida');await b.conflict();
  assert.deepEqual(descriptions(await server()),['Receita A1 teste']);
  assert.deepEqual(descriptions(await b.local()),['Despesa B1 teste']);
  await b.screenshot('conflito-financeiro');pass('Conflito financeiro detectado; alteração local do Edge preservada');

  await b.click('Usar dados deste navegador');await b.click('Cancelar');
  assert.deepEqual(descriptions(await server()),['Receita A1 teste']);
  assert.deepEqual(descriptions(await b.local()),['Despesa B1 teste']);pass('Cancelar não altera a nuvem nem descarta os dados locais');

  await b.click('Usar dados deste navegador');
  await a.movement('Receita A2 teste',50);await a.settled();
  await b.click('Confirmar escolha');
  await b.wait("document.body.textContent.includes('A nuvem mudou novamente')");
  assert.deepEqual(descriptions(await server()),['Receita A2 teste','Receita A1 teste']);
  assert.deepEqual(descriptions(await b.local()),['Despesa B1 teste']);pass('Confirmação desatualizada recusada após outra gravação');

  await b.choose('nuvem');await b.wait("!document.body.textContent.includes('Escolha a versão dos seus dados')");
  const beforeOffline=await b.backups();
  assert.ok(beforeOffline.some(e=>e.key.includes('-antes-resolver-local-') && e.value.historico?.some(h=>h.descricao==='Despesa B1 teste')));
  fs.writeFileSync(path.join(evidence,'edge-backups-before-offline.json'),JSON.stringify(beforeOffline,null,2));
  pass('Escolha explícita da nuvem mantém a despesa rejeitada em backup local');

  await b.click('Desconectar Firestore de teste');
  await b.movement('Despesa B2 offline teste',30,'saida');
  await b.wait("document.querySelector('.barra-status').textContent.includes('Salvo localmente')");
  assert.equal((await server()).historico.length,2);
  await b.reload();
  assert.ok(descriptions(await b.local()).includes('Despesa B2 offline teste'));
  assert.equal(await b.evaluate("sessionStorage.getItem('manual-firestore-offline')"),'true');
  await b.screenshot('offline-apos-recarregar');pass('Perda de conexão com Firestore e recarga preservam a movimentação local');

  await a.movement('Receita A3 durante offline teste',25);await a.settled();
  await b.click('Reconectar Firestore de teste');await b.conflict();
  assert.ok(descriptions(await b.local()).includes('Despesa B2 offline teste'));
  assert.ok(!descriptions(await server()).includes('Despesa B2 offline teste'));
  pass('Reconexão com mudança remota gera conflito sem sobrescrita');

  await b.choose('local');await b.settled();
  assert.ok(descriptions(await server()).includes('Despesa B2 offline teste'));
  const backupAfterLocal=await b.backups();
  assert.ok(backupAfterLocal.some(e=>e.key.includes('-antes-resolver-nuvem-') && e.value.historico?.some(h=>h.descricao==='Receita A3 durante offline teste')));
  pass('Escolha local exige confirmação e preserva a versão remota substituída');

  await a.click('Verificar sincronização');await a.conflict();await a.choose('nuvem');
  await a.wait("!document.body.textContent.includes('Escolha a versão dos seus dados')");
  await a.click('Desconectar Firestore de teste');await a.movement('Receita A4 offline sem concorrencia teste',7);
  const beforeReconnect=(await server()).historico.length;
  await a.click('Reconectar Firestore de teste');await a.settled();
  assert.equal((await server()).historico.length,beforeReconnect+1);
  await a.click('Verificar sincronização');await a.settled();
  assert.equal((await server()).historico.filter(h=>h.descricao==='Receita A4 offline sem concorrencia teste').length,1);
  await a.reload();await a.wait("document.body.textContent.includes('Dados carregados')");
  pass('Reconexão sem concorrência sincroniza uma vez; recarga conserva o resultado');

  await b.click('Verificar sincronização');await b.conflict();await b.choose('nuvem');
  await b.wait("!document.body.textContent.includes('Escolha a versão dos seus dados')");
  await Promise.all([a.screenshot('final'),b.screenshot('final')]);
  const remote=await server();
  fs.writeFileSync(path.join(evidence,'server-final.json'),JSON.stringify(remote,null,2));
  for(const browser of browsers) {
    assert.deepEqual(browser.errors,[],browser.name+' unhandled browser errors');
    assert.deepEqual(browser.blocked,[],browser.name+' attempted external application request');
    assert.ok([...browser.hosts].every(host=>host.startsWith('127.0.0.1:')||host.startsWith('localhost:')));
  }
  pass('Fluxo do aplicativo usou somente endpoints locais; sem exceções não tratadas');
  fs.writeFileSync(path.join(dir,'browsers.json'),JSON.stringify({profiles:browsers.map(b=>({name:b.name,profile:b.profile})),url:session.url},null,2));
}
try { await main(); }
catch(error) { results.push({name:error.message,status:'FAIL'});console.error(error.message);process.exitCode=1; }
finally {
  const report={projectId:session.projectId,url:session.url,executedAt:new Date().toISOString(),results,
    browsers:browsers.map(b=>({name:b.name,hosts:[...b.hosts],blocked:b.blocked,errors:b.errors})),
    mode:'Automação em Chrome e Edge headless; não é aprovação manual humana.'};
  fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(dir,'latest-report.json'),JSON.stringify({evidence,...report},null,2));
  for(const browser of browsers)await browser.stop();
  console.log('Evidence: '+evidence);
}
