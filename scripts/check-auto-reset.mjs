// Full browser -> Auth Emulator -> Firestore Emulator validation. Test data only.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const dir = path.resolve(process.argv[2] || '.backups/auto-reset');
assert.ok(dir.startsWith(path.resolve('.backups') + path.sep), 'Test artifacts must stay in .backups');
const session = JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf8'));
const targets = {
  'demo-appcar-auto-reset': { url:'http://127.0.0.1:3200', auth:'9298', firestore:'8288' },
  'demo-appcar-manual': { url:'http://127.0.0.1:3100', auth:'9198', firestore:'8188' },
};
const target=targets[session.projectId];assert.ok(target,'Only isolated demo projects are allowed');
assert.equal(session.url, target.url);
const evidence = path.join(dir, 'evidence-' + Date.now());
fs.mkdirSync(evidence, { recursive: true });
const results = [], browsers = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function localFetch(url, options) {
  const parsed = new URL(url);
  assert.equal(parsed.hostname, '127.0.0.1');
  assert.ok([new URL(target.url).port, target.firestore, target.auth].includes(parsed.port));
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
  const local=()=>evaluate(`JSON.parse(localStorage.getItem(sessionStorage.getItem('gestao-app-dados-v2-${session.uid}-session'))).data`);
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
  const upload=async file=>{
    const {root}=await send('DOM.getDocument',{},sessionId);
    const {nodeId}=await send('DOM.querySelector',{nodeId:root.nodeId,selector:'input[type=file]'},sessionId);
    await send('DOM.setFileInputFiles',{nodeId,files:[file]},sessionId);
  };
  const instance={name,profile,child,errors,blocked,hosts,evaluate,wait,click,fill,reload,screenshot,local,backups,movement,settled,conflict,choose,stop,upload};
  browsers.push(instance);
  await send('Page.navigate',{url:session.url},sessionId);
  await wait("Boolean(document.querySelector('input[name=email]'))");
  await fill('input[name=email]',session.email);await fill('input[name=password]',session.password);
  await evaluate("document.querySelector('form').requestSubmit()");
  await wait("Boolean(document.querySelector('.cabecalho'))");
  await wait("document.querySelector('.barra-status')?.textContent.includes('Salvo na nuvem')");
  return instance;
}

async function main() {
  const page=await localFetch(session.url);assert.ok((await page.text()).includes(session.projectId));
  const response=await localFetch(`http://127.0.0.1:${target.auth}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-only-not-a-real-key`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:session.email,password:session.password,returnSecureToken:true})});
  const account=await response.json();assert.equal(account.localId,session.uid);
  const server=async()=>{const result=await localFetch(`http://127.0.0.1:${target.firestore}/v1/projects/${session.projectId}/databases/(default)/documents/users/${session.uid}/appData/main`,{headers:{Authorization:'Bearer '+account.idToken}});assert.equal(result.status,200);const body=await result.json();return decode({mapValue:{fields:body.fields}});};
  assert.deepEqual((await server()).historico,[],'Use a new isolated fixture, never reset an existing test session implicitly');
  const a=await browser('C:/Program Files/Google/Chrome/Application/chrome.exe','chrome');
  const b=await browser('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','edge');
  const journal=`JSON.parse(localStorage.getItem(sessionStorage.getItem('gestao-app-dados-v2-${session.uid}-session'))).data`;
  const field=async(browser,label,value)=>{await browser.evaluate(`(()=>{const label=[...document.querySelectorAll('.turno-grid label')].find(l=>l.querySelector('span')?.textContent===${JSON.stringify(label)});const input=label.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await pause(90);};
  const editShift=async browser=>{await browser.click('Registrar turno');await browser.evaluate("[...document.querySelectorAll('table tbody tr')].find(row=>[...row.querySelectorAll('button')].some(b=>b.textContent==='Editar')).querySelector('button').click()");await pause(100);};
  await a.click('Registrar turno');await field(a,'Faturamento bruto (R$)','100');await a.click('Salvar turno');await a.settled();
  await b.wait(journal+'.historico.length===1');assert.equal(await b.evaluate("document.body.innerText.includes('Escolha a versão dos seus dados')"),false);
  pass('Turno salvo no Chrome aparece automaticamente no Edge, sem escolha manual');
  await b.click('Desconectar Firestore de teste');await b.movement('Despesa offline independente',20,'saida');await a.movement('Receita independente',50);await a.settled();
  await b.reload();assert.equal((await b.local()).historico.length,2);await b.click('Reconectar Firestore de teste');await b.settled();await a.wait(journal+'.historico.length===3');
  assert.equal((await server()).historico.length,3);assert.equal(await b.evaluate("document.body.innerText.includes('Escolha a versão dos seus dados')"),false);
  pass('Offline, recarga e reconexão combinam lançamentos independentes sem duplicação');
  await editShift(a);await editShift(b);await field(a,'Faturamento bruto (R$)','200');await field(b,'Faturamento bruto (R$)','300');await a.click('Salvar alterações');await a.settled();
  await b.wait(journal+'.historico.some(h=>h.tipo==="turno"&&h.faturamentoBruto===200)');
  assert.equal(await b.evaluate("[...document.querySelectorAll('.turno-grid label')].find(l=>l.querySelector('span')?.textContent==='Faturamento bruto (R$)').querySelector('input').value"),'300');
  await b.click('Salvar alterações');await b.conflict();assert.equal((await b.local()).historico.find(h=>h.tipo==='turno').faturamentoBruto,300);assert.equal((await server()).historico.find(h=>h.tipo==='turno').faturamentoBruto,200);
  pass('Formulário preservado; edições simultâneas do mesmo turno geram conflito real');
  await b.click('Usar dados deste navegador');await b.click('Cancelar');assert.equal((await server()).historico.find(h=>h.tipo==='turno').faturamentoBruto,200);
  await b.choose('nuvem');await b.wait("!document.body.innerText.includes('Escolha a versão dos seus dados')");assert.ok((await b.backups()).some(e=>e.key.includes('-antes-resolver-local-')&&e.value.historico?.some(h=>h.faturamentoBruto===300)));
  pass('Cancelar não grava; escolher a nuvem preserva a edição rejeitada em backup');
  await b.click('Desconectar Firestore de teste');await b.movement('Pendência da geração antiga',7,'saida');
  fs.writeFileSync(path.join(evidence,'old-device-backups.json'),JSON.stringify(await b.backups(),null,2));
  await a.click('Privacidade');await a.click('Preparar reinicialização e backup');await a.wait("Boolean(document.querySelector('input[name=confirmar-reinicio]'))");
  assert.equal(await a.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Confirmar reinicialização desta conta').disabled"),true);assert.equal((await server()).historico.length,3);
  pass('Preparação identifica a conta e não zera dados antes da confirmação');
  await a.evaluate("window.__originalURL=URL.createObjectURL;URL.createObjectURL=blob=>{window.__resetExport=blob.text();return window.__originalURL(blob);}");
  await a.click('Baixar backup antes do reinício');const backupText=await a.evaluate('window.__resetExport');const backup=JSON.parse(backupText);assert.equal(backup.uid,session.uid);assert.equal(backup.remote.historico.length,3);assert.equal(backupText.includes(account.idToken),false);
  const correct=path.join(evidence,'reset-backup.json'),incorrect=path.join(evidence,'wrong-backup.json');fs.writeFileSync(correct,backupText);fs.writeFileSync(incorrect,JSON.stringify({...backup,uid:'different-user'}));
  await a.upload(incorrect);await a.wait("document.body.innerText.includes('arquivo não corresponde')");assert.equal(await a.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Confirmar reinicialização desta conta').disabled"),true);
  await a.upload(correct);await a.wait("document.body.innerText.includes('Arquivo de backup conferido')");await a.evaluate("document.querySelector('input[type=checkbox]').click()");await a.fill('input[name=confirmar-reinicio]','REINICIAR MINHA CONTA');
  assert.equal((await server()).historico.length,3);pass('Backup completo conferido por arquivo; arquivo de outra conta recusado');
  await a.click('Confirmar reinicialização desta conta');await a.wait("document.body.innerText.includes('Reinicialização confirmada')");assert.deepEqual((await server()).historico,[]);assert.equal((await server())._sync.generation,1);
  await a.screenshot('reset-confirmado');pass('Confirmação explícita zera o histórico e avança a geração sem excluir a conta');
  await b.reload();await b.click('Reconectar Firestore de teste');await b.conflict();
  assert.equal(await b.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Usar dados deste navegador').disabled"),true);assert.ok((await b.local()).historico.some(h=>h.descricao==='Pendência da geração antiga'));assert.deepEqual((await server()).historico,[]);
  await b.screenshot('geracao-antiga-bloqueada');pass('Dispositivo antigo preserva seus dados, mas não consegue restaurá-los na nova geração');
  await b.choose('nuvem');await b.wait("!document.body.innerText.includes('Escolha a versão dos seus dados')");assert.deepEqual((await b.local()).historico,[]);
  await a.click('Registrar turno');for(const [label,value]of [['Faturamento bruto (R$)','461,33'],['Valor gasto (R$)','92,20'],['Litros','23,11'],['KM trabalhado','238,1'],['KM total do carro','246,3']])await field(a,label,value);
  await a.click('+ Adicionar reserva');await a.evaluate("(()=>{const inputs=[...document.querySelectorAll('[data-testid=reserva] input')];for(const [i,value]of ['Reserva real fictícia','10'].entries()){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(inputs[i],value);inputs[i].dispatchEvent(new Event('input',{bubbles:true}));}})()");await pause(100);
  await a.click('Salvar turno');await a.settled();await b.wait(journal+'.historico.length===1');
  const real=(await server()).historico[0];assert.equal(real.faturamentoBruto,461.33);assert.equal(real.combustivel,92.2);assert.equal(real.reservasDiariasDia[0].valor,10);assert.equal(real.liquido,349.77);
  pass('Primeiro turno da nova geração calcula combustível, reserva, saldo e fechamento diário');
  await Promise.all([a.reload(),b.reload()]);await a.wait(journal+'.historico.length===1');await b.wait(journal+'.historico.length===1');assert.equal((await server()).historico.length,1);
  await b.click('Histórico e relatórios');await b.wait("document.body.innerText.includes('Relatórios')");assert.equal((await b.local()).historico[0].id,real.id);
  pass('Histórico e relatórios contêm somente a nova geração após recarga nos dois navegadores');
  assert.equal(new Set((await server()).historico.map(h=>h.id)).size,1);for(const browser of browsers){assert.deepEqual(browser.errors,[]);assert.deepEqual(browser.blocked,[]);assert.ok([...browser.hosts].every(h=>h.startsWith('127.0.0.1:')));}
  fs.writeFileSync(path.join(evidence,'new-generation-final.json'),JSON.stringify(await server(),null,2));await Promise.all([a.screenshot('final'),b.screenshot('final')]);
  fs.writeFileSync(path.join(dir,'browsers.json'),JSON.stringify({profiles:browsers.map(b=>({name:b.name,profile:b.profile})),url:session.url},null,2));
  pass('Somente endpoints locais foram usados; sem exceções não tratadas ou duplicações');
}
try {await main();}catch(error){results.push({name:error.message,status:'FAIL'});console.error(error.message);process.exitCode=1;}
finally{const report={projectId:session.projectId,url:session.url,executedAt:new Date().toISOString(),results,browsers:browsers.map(b=>({name:b.name,hosts:[...b.hosts],blocked:b.blocked,errors:b.errors})),scope:'Somente dados fictícios em emuladores; nenhum dado real consultado ou alterado.'};fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(dir,'latest-report.json'),JSON.stringify({evidence,...report},null,2));for(const browser of browsers)await browser.stop();console.log('Evidence: '+evidence);}
