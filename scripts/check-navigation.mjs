// Verifica a navegação da conta somente no preview local demo-appcar-manual.
// Não cria, aceita, cancela ou atualiza convites e nunca acessa endpoints externos.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const root = process.cwd();
const session = JSON.parse(fs.readFileSync(path.resolve('.backups/manual-sync/session.json'), 'utf8'));
assert.equal(session.projectId, 'demo-appcar-manual');
assert.equal(session.url, 'http://127.0.0.1:3100');

const child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--no-first-run', '--disable-gpu', '--disable-background-networking',
  '--disable-component-update', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
  '--remote-debugging-port=0', '--user-data-dir=' + path.join(root, '.backups', 'manual-navigation-profile-' + Date.now()), 'about:blank',
], { windowsHide: true });
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const endpoint = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Chrome não iniciou a tempo')), 20000);
  child.once('error', error => { clearTimeout(timer); reject(error); });
  child.stderr.on('data', data => {
    const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/);
    if (match) { clearTimeout(timer); resolve(match[1]); }
  });
});
const ws = new WebSocket(endpoint);
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });

let nextId = 0;
const pending = new Map();
const hosts = new Set();
const blocked = [];
const errors = [];
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 30000);
  pending.set(id, message => { clearTimeout(timer); if (message.error) reject(new Error(message.error.message)); else resolve(message.result); });
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  const callback = pending.get(message.id);
  if (callback) { pending.delete(message.id); callback(message); }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  if (message.method === 'Network.requestWillBeSent') {
    const requestUrl = new URL(message.params.request.url);
    if (requestUrl.protocol.startsWith('http')) hosts.add(requestUrl.host);
  }
  if (message.method === 'Fetch.requestPaused') {
    const url = new URL(message.params.request.url);
    const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
    if (!local) blocked.push(url.origin);
    void send(local ? 'Fetch.continueRequest' : 'Fetch.failRequest', local ? { requestId: message.params.requestId } : { requestId: message.params.requestId, errorReason: 'BlockedByClient' }, message.sessionId).catch(() => {});
  }
});

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Runtime.enable', {}, sessionId);
await send('Network.enable', {}, sessionId);
await send('Fetch.enable', { patterns: [{ urlPattern: 'http*', requestStage: 'Request' }] }, sessionId);
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const wait = async (expression, timeout = 20000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) { if (await evaluate(expression)) return; await pause(80); }
  throw new Error('UI timeout: ' + expression + '\n' + (await evaluate('document.body.innerText')).slice(-1600));
};
const fill = async (selector, value) => evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});if(!input)throw new Error('Campo ausente');const setter=Object.getOwnPropertyDescriptor(input.constructor.prototype,'value')||Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');setter.set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
const clickExact = text => evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(item=>item.textContent.trim()===${JSON.stringify(text)});if(!button)throw new Error('Botão ausente: '+${JSON.stringify(text)});button.click();})()`);

try {
  const page = await fetch(session.url);
  assert.equal(page.status, 200);
  await send('Page.navigate', { url: session.url }, sessionId);
  await wait("Boolean(document.querySelector('input[name=email]'))");
  await fill('input[name=email]', session.email);
  await fill('input[name=password]', session.password);
  await evaluate("document.querySelector('form').requestSubmit()");
  await wait("Boolean(document.querySelector('.cabecalho'))");
  await wait("Boolean(document.querySelector('.espaco-atual'))");
  assert.equal(await evaluate("document.querySelector('.espaco-atual strong')?.textContent"), 'Meus dados');
  assert.equal(await evaluate("document.querySelector('#conta-compartilhamento-titulo') === null"), true);
  await clickExact('Meus espaços');
  await wait("Boolean(document.querySelector('#conta-compartilhamento-titulo'))");
  assert.equal(await evaluate("document.body.innerText.includes('Conta e compartilhamento')"), true);
  assert.equal(await evaluate("document.body.innerText.includes('Escolha qual espaço consultar')"), true);
  await clickExact('Voltar ao painel');
  await wait("document.querySelector('#conta-compartilhamento-titulo') === null");
  assert.equal(await evaluate("document.querySelector('.espaco-atual strong')?.textContent"), 'Meus dados');
  assert.deepEqual(errors, []);
  assert.deepEqual(blocked, []);
  assert.ok([...hosts].every(host => host.startsWith('127.0.0.1:') || host.startsWith('localhost:')), `Host externo observado: ${JSON.stringify([...hosts])}`);
  console.log('PASS: painel principal sem os dois painéis grandes; cabeçalho abre e fecha Conta e compartilhamento no ambiente demo isolado.');
} finally {
  try { await send('Browser.close'); } catch {}
  ws.close();
  await pause(300);
  if (child.exitCode === null) child.kill();
}
