// Browser validation for the viewer-sharing flow. It is intentionally limited
// to the isolated manual preview and refuses every non-local endpoint.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const root = process.cwd();
const sessionPath = path.resolve(process.argv[2] || '.backups/manual-sync/session.json');
const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
assert.equal(session.projectId, 'demo-appcar-manual', 'Somente o projeto demo-appcar-manual é permitido');
assert.equal(session.url, 'http://127.0.0.1:3100');
const target = { app: '3100', auth: '9198', firestore: '8188' };
const evidenceDir = path.join(root, '.backups', 'manual-sharing', 'evidence-' + Date.now());
fs.mkdirSync(evidenceDir, { recursive: true });
const results = [];
const browsers = [];
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const pass = name => { results.push({ name, status: 'PASS' }); console.log('PASS: ' + name); };

async function localFetch(url, options) {
  const parsed = new URL(url);
  assert.equal(parsed.hostname, '127.0.0.1', 'Endpoint fora do localhost: ' + parsed.origin);
  assert.ok([target.app, target.auth, target.firestore].includes(parsed.port), 'Porta fora do preview isolado: ' + parsed.port);
  return fetch(url, options);
}

const authUrl = action => `http://127.0.0.1:${target.auth}/identitytoolkit.googleapis.com/v1/${action}?key=demo-only-not-a-real-key`;
const firestoreUrl = uid => `http://127.0.0.1:${target.firestore}/v1/projects/${session.projectId}/databases/(default)/documents/users/${uid}/appData/main`;
const inviteUrl = ownerUid => `http://127.0.0.1:${target.firestore}/v1/projects/${session.projectId}/databases/(default)/documents/shareInvites/${ownerUid}`;

async function authRequest(action, body) {
  const response = await localFetch(authUrl(action), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json();
  assert.equal(response.ok, true, `Auth Emulator ${action}: ${JSON.stringify(value)}`);
  return value;
}

async function signIn(email, password) {
  return authRequest('accounts:signInWithPassword', { email, password, returnSecureToken: true });
}

async function createAccount(email, password) {
  const created = await authRequest('accounts:signUp', { email, password, returnSecureToken: true });
  const response = await localFetch(authUrl('accounts:update'), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }, body: JSON.stringify({ localId: created.localId, emailVerified: true, returnSecureToken: true }) });
  const verified = await response.json();
  assert.equal(response.ok, true, 'Auth Emulator não conseguiu preparar a conta verificada');
  return { ...created, ...verified, email, password };
}

function encode(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) } };
}

function documentFor(data) {
  return { fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encode(value)])) };
}

function movement(id, description, amount) {
  return { id, data: '17/11/2026', diaSemana: 'terça-feira', descricao: description, tipo: 'avulso_entrada',
    faturamentoBruto: amount, combustivel: 0, litros: 0, kmTrabalhado: 0, kmTotal: 0,
    reservaFevereiro: 0, reservaInvestimento: 0, reservaAcidente: 0, custosFixosDia: 0,
    detalheCustosFixosDia: {}, reservasDiariasDia: [], saidas: [], totalDespesas: 0, liquido: amount };
}

function dataWith(history) {
  return { custosFixos: [], reservasDiarias: [], nomeReserva1: 'Reserva teste 1', nomeReserva2: 'Reserva teste 2',
    nomeReserva3: 'Reserva teste 3', lembrete: '', historico: history, modoEscuro: false };
}

async function writeData(uid, token, data) {
  const response = await localFetch(firestoreUrl(uid), { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(documentFor(data)) });
  assert.equal(response.ok, true, 'Seed local do documento financeiro falhou: ' + response.status);
}

async function firestoreRead(uid, token) {
  const response = await localFetch(firestoreUrl(uid), { headers: token ? { Authorization: 'Bearer ' + token } : undefined });
  return { status: response.status, body: await response.text() };
}

async function forbiddenPatch(url, token, body) {
  const response = await localFetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
  assert.equal(response.status, 403, `A operação deveria ser recusada, mas retornou ${response.status}`);
}

async function browser(executable, name) {
  const profile = path.join(evidenceDir, 'profile-' + name);
  const child = spawn(executable, ['--headless=new', '--no-sandbox', '--no-first-run', '--disable-gpu', '--disable-background-networking', '--disable-component-update',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true });
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(name + ' não iniciou a tempo')), 20000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.stderr.on('data', data => { const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  const ws = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  let nextId = 0;
  const pending = new Map(), errors = [], blocked = [], hosts = new Set();
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const requestId = ++nextId;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(name + ' CDP timeout: ' + method)); }, 30000);
    pending.set(requestId, message => { clearTimeout(timer); if (message.error) reject(new Error(message.error.message)); else resolve(message.result); });
    ws.send(JSON.stringify({ id: requestId, method, params, sessionId }));
  });
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data), callback = pending.get(message.id);
    if (callback) { pending.delete(message.id); callback(message); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === 'Network.requestWillBeSent') {
      const url = new URL(message.params.request.url);
      if (url.protocol.startsWith('http')) hosts.add(url.host);
    }
    if (message.method === 'Fetch.requestPaused') {
      const url = new URL(message.params.request.url), local = ['127.0.0.1', 'localhost'].includes(url.hostname);
      if (!local) blocked.push(url.origin);
      void send(local ? 'Fetch.continueRequest' : 'Fetch.failRequest', local ? { requestId: message.params.requestId } : { requestId: message.params.requestId, errorReason: 'BlockedByClient' }, message.sessionId).catch(() => {});
    }
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId); await send('Network.enable', {}, sessionId); await send('Fetch.enable', { patterns: [{ urlPattern: 'http*', requestStage: 'Request' }] }, sessionId);
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (result.exceptionDetails) throw new Error(name + ': ' + (result.exceptionDetails.exception?.description || result.exceptionDetails.text));
    return result.result.value;
  };
  const wait = async (expression, timeout = 20000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) { if (await evaluate(expression)) return; await pause(80); }
    throw new Error(name + ' UI timeout: ' + expression + '\n' + (await evaluate('document.body.innerText')).slice(-1800));
  };
  const fill = async (selector, value) => {
    await evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});if(!input)throw new Error('Campo ausente: '+${JSON.stringify(selector)});const setter=Object.getOwnPropertyDescriptor(input.constructor.prototype,'value')||Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');setter.set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await pause(100);
  };
  const clickButton = async (predicate) => {
    await evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>${predicate});if(!button)throw new Error('Botão ausente');button.click();})()`);
    await pause(180);
  };
  const clickExact = text => clickButton(`b.textContent.trim()===${JSON.stringify(text)}`);
  const clickIncludes = text => clickButton(`b.textContent.includes(${JSON.stringify(text)})`);
  const login = async (email, password) => {
    await send('Page.navigate', { url: session.url }, sessionId);
    await wait("Boolean(document.querySelector('input[name=email]'))");
    await fill('input[name=email]', email); await fill('input[name=password]', password);
    await evaluate("document.querySelector('form').requestSubmit()");
    await wait("Boolean(document.querySelector('.cabecalho'))");
    await wait("Boolean(document.querySelector('.barra-status'))");
    await wait("document.querySelector('.barra-status')?.textContent.includes('Salvo na nuvem') || document.querySelector('.barra-status')?.textContent.includes('Salvo localmente')");
  };
  const stop = async () => { try { await send('Browser.close'); } catch {} ws.close(); await pause(300); if (child.exitCode === null) child.kill(); };
  const instance = { name, profile, child, errors, blocked, hosts, evaluate, wait, fill, clickButton, clickExact, clickIncludes, login, stop };
  browsers.push(instance);
  return instance;
}

async function main() {
  const page = await localFetch(session.url);
  assert.equal(page.status, 200);
  const owner = await signIn(session.email, session.password);
  const suffix = Date.now();
  const partner = await createAccount(`parceiro-${suffix}@example.test`, 'APPCAR-parceiro-21!');
  const outsider = await createAccount(`terceiro-${suffix}@example.test`, 'APPCAR-terceiro-21!');
  await writeData(owner.localId, owner.idToken, dataWith([movement('owner-seed', 'Lançamento do proprietário', 100)]));
  await writeData(partner.localId, partner.idToken, dataWith([movement('partner-seed', 'Lançamento próprio da parceira', 25)]));

  const a = await browser('C:/Program Files/Google/Chrome/Application/chrome.exe', 'chrome-owner');
  const b = await browser('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'edge-partner');
  await a.login(session.email, session.password);
  await b.login(partner.email, partner.password);
  await a.clickExact('Privacidade');
  await a.wait("Boolean(document.querySelector('section[aria-labelledby=compartilhamento-titulo]'))");
  await a.fill('section[aria-labelledby="compartilhamento-titulo"] input[type=email]', partner.email);
  await a.clickExact('Enviar convite');
  await a.wait("document.body.innerText.includes('Convite pendente')");
  pass('Proprietário cria convite pendente para o e-mail de teste');

  await b.wait("document.body.innerText.includes('Aceitar convite')");
  assert.equal(await b.evaluate("document.body.innerText.includes('Lançamento próprio da parceira')"), true);
  pass('Parceira autenticada separadamente vê os próprios dados e o convite');
  await b.clickExact('Aceitar convite');
  await b.wait("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Espaço compartilhado'))");
  await b.clickIncludes('Espaço compartilhado');
  await b.wait("document.body.innerText.includes('Lançamento do proprietário')");
  assert.equal(await b.evaluate("document.body.innerText.includes('Somente visualização')"), true);
  assert.equal(await b.evaluate("!document.body.innerText.includes('Parceira de visualização')"), true);
  assert.equal(await b.evaluate("![...document.querySelectorAll('button')].some(b=>b.textContent.includes('Registrar movimentação'))"), true);
  for (const hiddenAction of ['Reiniciar dados financeiros', 'Preparar reinicialização e backup', 'Baixar backup antes do reinício', 'Recuperar cópia local']) {
    assert.equal(await b.evaluate(`!document.body.innerText.includes(${JSON.stringify(hiddenAction)})`), true, 'Ação administrativa visível: ' + hiddenAction);
  }
  pass('Aceitação abre os dados do proprietário em modo Somente visualização');

  const ownerRead = await firestoreRead(owner.localId, partner.idToken);
  assert.equal(ownerRead.status, 200);
  await forbiddenPatch(firestoreUrl(owner.localId), partner.idToken, documentFor({ lembrete: 'alteração proibida' }));
  await forbiddenPatch(inviteUrl(owner.localId), partner.idToken, documentFor({ status: 'revoked' }));
  const ownerDelete = await localFetch(firestoreUrl(owner.localId), { method: 'DELETE', headers: { Authorization: 'Bearer ' + partner.idToken } });
  assert.equal(ownerDelete.status, 403);
  const outsiderRead = await firestoreRead(owner.localId, outsider.idToken);
  assert.equal(outsiderRead.status, 403);
  const anonymousRead = await firestoreRead(owner.localId, '');
  assert.equal(anonymousRead.status, 403);
  pass('Parceira, terceira conta e acesso sem autenticação não conseguem gravar, apagar ou acessar indevidamente');

  await a.clickExact('Registrar turno');
  await a.evaluate(`(()=>{const l=[...document.querySelectorAll('.avulso-grid label')].find(x=>x.querySelector('span')?.textContent==='Descrição');const i=l.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'Novo lançamento do proprietário');i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await a.fill('.avulso-grid input[inputmode="decimal"]', '55');
  await a.clickExact('Registrar movimentação');
  await a.wait("document.body.innerText.includes('Novo lançamento do proprietário')");
  await a.wait("document.querySelector('.barra-status')?.textContent.includes('Salvo na nuvem')");
  await b.wait("document.body.innerText.includes('Novo lançamento do proprietário')");
  pass('Novo lançamento do proprietário aparece no espaço compartilhado após sincronização');

  await a.clickExact('Privacidade');
  await a.wait("document.body.innerText.includes('Parceria ativa')");
  await a.evaluate('window.confirm=()=>true');
  await a.clickExact('Revogar acesso');
  await a.wait("document.body.innerText.includes('Acesso revogado')");
  await b.wait("![...document.querySelectorAll('button')].some(b=>b.textContent.includes('Espaço compartilhado'))");
  assert.equal(await b.evaluate("document.body.innerText.includes('Novo lançamento do proprietário')"), false);
  assert.equal(await b.evaluate("document.body.innerText.includes('Lançamento próprio da parceira')"), true);
  const afterRevocation = await firestoreRead(owner.localId, partner.idToken);
  assert.equal(afterRevocation.status, 403);
  pass('Revogação bloqueia novas leituras e remove os dados compartilhados da interface, sem apagar os dados próprios');

  for (const browserInstance of browsers) {
    assert.deepEqual(browserInstance.errors, [], browserInstance.name + ' teve exceções JS');
    assert.deepEqual(browserInstance.blocked, [], browserInstance.name + ' tentou acessar rede externa');
    assert.ok([...browserInstance.hosts].every(host => host.startsWith('127.0.0.1:')), browserInstance.name + ' acessou host não local');
  }
  pass('Dois perfis de navegador usaram somente o ambiente local isolado');
}

try {
  await main();
} catch (error) {
  results.push({ name: error instanceof Error ? error.message : String(error), status: 'FAIL' });
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  const report = { projectId: session.projectId, url: session.url, executedAt: new Date().toISOString(), results,
    browsers: browsers.map(browserInstance => ({ name: browserInstance.name, hosts: [...browserInstance.hosts], blocked: browserInstance.blocked, errors: browserInstance.errors })),
    scope: 'Somente contas e dados fictícios no Auth/Firestore Emulator; nenhum dado de produção consultado ou alterado.' };
  fs.writeFileSync(path.join(evidenceDir, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(root, '.backups', 'manual-sharing', 'latest-report.json'), JSON.stringify({ evidence: evidenceDir, ...report }, null, 2));
  for (const browserInstance of browsers) await browserInstance.stop();
  console.log('Evidence: ' + evidenceDir);
}
