// Testa a aplicação reconstruída no Next.js real; todo armazenamento remoto é simulado.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

async function main() {
  const dir = path.resolve('.next/auth-check');
  const app = path.join(dir, 'next-app');
  fs.mkdirSync(app, { recursive: true });
  fs.cpSync('src', path.join(app, 'src'), { recursive: true });
  fs.writeFileSync(path.join(app, 'src/app/page.tsx'), `'use client';
import { useState, useEffect } from 'react';
import AuthGate from '@/components/AuthGate';
import VerificarEmail from '@/components/VerificarEmail';
export default function TestPage() { const [user, setUser] = useState(false); useEffect(() => { window.__ready = true; const listener = () => setUser(true); window.addEventListener('test-user', listener); return () => window.removeEventListener('test-user', listener); }, []); return user ? <main className="app escuro"><VerificarEmail /></main> : <AuthGate />; }`);
  fs.writeFileSync(path.join(app,'src/lib/firebase.ts'), 'export const auth = {currentUser: null}, db = {};');
  for (const file of ['src/components/AuthGate.tsx','src/components/VerificarEmail.tsx','src/app/conta/acao/page.tsx']) {
    fs.writeFileSync(path.join(app,file), fs.readFileSync(file,'utf8').replaceAll("from 'firebase/auth'", "from '@/lib/testAuth'"));
  }
  fs.writeFileSync(path.join(app,'src/lib/testAuth.ts'), `
import { auth } from './firebase';
const call = (name, value) => { (window.__calls ??= []).push({name, value}); };
export class GoogleAuthProvider { setCustomParameters(value) { window.__googleParams=value; } }
export const signInWithPopup = async () => { call('google',true); if(window.__googleError) throw {code:window.__googleError}; return createUserWithEmailAndPassword(auth,'google@example.com',''); };
export const linkWithPopup = async () => {call('link-google',true);};
export const EmailAuthProvider = {credential: (email, password) => ({email,password})};
export const validatePassword = async (_auth, password) => {call('policy', password); return {isValid: password.length >= 8, meetsMinPasswordLength: password.length >= 8, passwordPolicy: {customStrengthOptions: {minPasswordLength:8}}};};
export const createUserWithEmailAndPassword = async (_auth, email, password) => { call('signup', email); const user={email,emailVerified:false,getIdToken:async()=>{call('token',true);}}; auth.currentUser=user; window.dispatchEvent(new Event('test-user')); return {user}; };
export const linkWithCredential = async (_user, c) => createUserWithEmailAndPassword(auth,c.email,c.password);
export const sendEmailVerification = async user => {call('verify-email',user.email); if(window.__failMail) throw new Error('mail offline');};
export const sendPasswordResetEmail = async (_auth,email) => {call('reset-email',email); if(window.__missing) throw {code:'auth/user-not-found'};};
export const signInWithEmailAndPassword = async () => {throw {code:'auth/invalid-credential'};};
export const reload = async user => {user.emailVerified=Boolean(window.__verified);};
export const verifyPasswordResetCode = async (_auth,code) => {if(code==='expired') throw new Error('expired'); return 'test@example.com';};
export const confirmPasswordReset = async (_auth,code,password) => {call('reset-password',{code,password});};
export const applyActionCode = async (_auth,code) => {call('apply-code',code); if(code==='expired') throw new Error('expired');};
`);
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ private: true }));
  const tsconfig = JSON.parse(fs.readFileSync('tsconfig.json', 'utf8'));
  tsconfig.include = ['next-env.d.ts', 'src/**/*.ts', 'src/**/*.tsx', 'build/types/**/*.ts', 'build/dev/types/**/*.ts'];
  fs.writeFileSync(path.join(app, 'tsconfig.json'), JSON.stringify(tsconfig));
  fs.writeFileSync(path.join(app, 'next.config.mjs'), `import config from '../../../next.config.ts'; export default {...config, distDir: 'build', turbopack: {...config.turbopack, root: ${JSON.stringify(process.cwd())}}};`);
  const probe = http.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  let next, chrome, ws;
  try {
    next = spawn(process.execPath, [path.resolve('node_modules/next/dist/bin/next'), 'dev', app, '--hostname', '127.0.0.1', '--port', String(port)], { windowsHide: true });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Next startup timeout')), 30000);
      next.stdout.on('data', data => { process.stdout.write(data); if (String(data).includes('Ready')) { clearTimeout(timer); resolve(); } });
      next.stderr.on('data', data => process.stderr.write(data));
      next.on('error', reject);
    });
    chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--no-sandbox', '--no-first-run', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${path.join(dir, `profile-${Date.now()}`)}`, 'about:blank'], { windowsHide: true });
    const endpoint = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Chrome startup timeout')), 15000);
      chrome.on('error', reject);
      chrome.stderr.on('data', data => { const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    });
    ws = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
    let id = 0;
    const pending = new Map(), errors = [];
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      const callback = pending.get(message.id);
      if (callback) { pending.delete(message.id); callback(message); }
    });
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP timeout: ' + method)), 30000);
      pending.set(++id, message => { clearTimeout(timer); if (message.error) reject(new Error(message.error.message)); else resolve(message.result); });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Runtime.enable', {}, sessionId);
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    await send('Page.navigate', { url: `http://127.0.0.1:${port}` }, sessionId);
    await evaluate(`new Promise((resolve,reject)=>{const t=setInterval(()=>{if(window.__ready && document.querySelector('input[type=email]')){clearInterval(t);resolve(true);}},50);setTimeout(()=>reject(new Error('UI timeout')),15000);})`);
    await evaluate(`window.tick=()=>new Promise(r=>setTimeout(r,100)); window.button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text); window.fill=async(name,value)=>{const input=document.querySelector('input[name="'+name+'"]');if(!input) throw new Error('Missing input '+name+': '+document.body.textContent);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));await tick();};`);
    await evaluate(`(async()=>{window.__googleError='auth/popup-blocked';button('Continuar com Google').click();await tick();})()`);
    assert.match(await evaluate("document.querySelector('[role=alert]').textContent"), /Permita/);
    assert.equal(await evaluate('window.__googleParams.prompt'),'select_account');
    await evaluate('window.__calls=[]');
    await evaluate(`(async()=>{button('Criar conta').click();await tick();await fill('email','test@example.com');await fill('password','password123');await fill('password-confirmation','different');document.querySelector('form').requestSubmit();await tick();})()`);
    assert.match(await evaluate("document.querySelector('[role=alert]').textContent"), /coincidem/);
    assert.equal(await evaluate('(window.__calls || []).length'),0);
    await evaluate(`(async()=>{button('Mostrar senha').click();await tick();})()`);
    assert.equal(await evaluate("document.querySelector('input[name=password]').type"),'text');
    await evaluate(`(async()=>{await fill('password','short6');await fill('password-confirmation','short6');document.querySelector('form').requestSubmit();await tick();})()`);
    assert.match(await evaluate("document.querySelector('[role=alert]').textContent"), /8 caracteres/);
    await evaluate(`(async()=>{await fill('password','password123');await fill('password-confirmation','password123');document.querySelector('form').requestSubmit();await tick();})()`);
    assert.equal(await evaluate("window.__calls.filter(c=>c.name==='signup').length"),1);
    assert.equal(await evaluate("window.__calls.filter(c=>c.name==='verify-email').length"),1);
    await evaluate(`(async()=>{button('Enviar confirma'+'\u00e7'+'\u00e3'+'o de e-mail').click();await tick();button('Enviar confirma'+'\u00e7'+'\u00e3'+'o de e-mail').click();await tick();})()`);
    assert.equal(await evaluate("window.__calls.filter(c=>c.name==='verify-email').length"),2);
    await evaluate(`(async()=>{window.__verified=true;button('J'+'\u00e1'+' confirmei meu e-mail').click();await tick();})()`);
    assert.equal(await evaluate("document.querySelector('#confirmar-email-titulo')"),null);
    await send('Page.navigate',{url: 'http://127.0.0.1:'+port+'/conta/acao?mode=resetPassword&oobCode=valid'},sessionId);
    await new Promise(r=>setTimeout(r,1500));
    await evaluate(`(async()=>{const inputs=document.querySelectorAll('input');for(const input of inputs){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'password123');input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,100));}document.querySelector('form').requestSubmit();await new Promise(r=>setTimeout(r,200));})()`);
    assert.match(await evaluate("document.body.textContent"), /Senha atualizada/);
    assert.equal(await evaluate("window.location.search"),'');
    await send('Page.navigate',{url:'http://127.0.0.1:'+port+'/conta/acao?mode=verifyEmail&oobCode=valid'},sessionId);
    await new Promise(r=>setTimeout(r,1200));
    await evaluate("document.querySelector('form').requestSubmit()");
    await new Promise(r=>setTimeout(r,200));
    assert.match(await evaluate('document.body.textContent'), /E-mail confirmado/);
    await send('Page.navigate',{url:'http://127.0.0.1:'+port+'/conta/acao?mode=resetPassword&oobCode=expired'},sessionId);
    await new Promise(r=>setTimeout(r,1200));
    assert.equal(await evaluate("document.querySelector('input')"),null);
    assert.ok(await evaluate("document.querySelector('[role=alert]') !== null"));
    await send('Page.navigate',{url:'http://127.0.0.1:'+port},sessionId);
    await new Promise(r=>setTimeout(r,1200));
    await evaluate(`(async()=>{[...document.querySelectorAll('button')].find(b=>b.textContent==='Esqueci minha senha').click();await new Promise(r=>setTimeout(r,100));const input=document.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'missing@example.com');input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,100));window.__missing=true;document.querySelector('form').requestSubmit();await new Promise(r=>setTimeout(r,200));})()`);
    assert.match(await evaluate("document.querySelector('[role=status]').textContent"), /Se houver uma conta/);
    await evaluate(`(async()=>{[...document.querySelectorAll('button')].find(b=>b.textContent==='Voltar para entrar').click();await new Promise(r=>setTimeout(r,100));window.__googleError='';[...document.querySelectorAll('button')].find(b=>b.textContent==='Continuar com Google').click();await new Promise(r=>setTimeout(r,200));})()`);
    assert.equal(await evaluate("window.__calls.filter(c=>c.name==='google').length"),1);
    await evaluate(`(async()=>{const close=[...document.querySelectorAll('button')].find(b=>b.textContent==='Fechar aviso');if(close) close.click();await new Promise(r=>setTimeout(r,100));})()`);
    assert.equal(await evaluate("localStorage.getItem('appcar-aviso-armazenamento-v1')"),'lido');
    await send('Page.navigate',{url:'http://127.0.0.1:'+port+'/cookies'},sessionId);
    await new Promise(r=>setTimeout(r,1200));
    assert.match(await evaluate('document.body.textContent'), /Cookies e armazenamento/);
    assert.equal(await evaluate("document.querySelector('aside[aria-label]')"),null);
    assert.deepEqual(errors,[]);
    console.log('PASS: password mismatch, visibility, Firebase policy, signup, verification email, resend cooldown, confirmed email refresh, custom password reset. All Firebase calls simulated.');

  } finally {
    if (ws) ws.close();
    if (chrome) chrome.kill();
    if (next) next.kill();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
