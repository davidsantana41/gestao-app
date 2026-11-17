// Isolated manual preview. Never imports the application's Firebase config.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

const root = process.cwd();
const automatic = process.argv.includes('--auto-reset');
const dir = path.join(root, automatic ? '.backups/auto-reset' : '.backups/manual-sync');
const app = path.join(dir, 'app');
const projectId = automatic ? 'demo-appcar-auto-reset' : 'demo-appcar-manual';
const appPort = automatic ? 3200 : 3100, firestorePort = automatic ? 8288 : 8188, authPort = automatic ? 9298 : 9198;
const hubPort = automatic ? 4402 : 4401;
const url = 'http://127.0.0.1:' + appPort;
const children = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const ports = [appPort, firestorePort, authPort, hubPort, automatic ? 4502 : 4501, automatic ? 9152 : 9151];

async function freePort(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => server.close(resolve));
}
async function ready(check, milliseconds = 60000) {
  const start = Date.now();
  while (Date.now() - start < milliseconds) {
    try { if (await check()) return; } catch { /* Waiting for our own process. */ }
    await wait(250);
  }
  throw new Error('Timeout waiting for local test service; inspect .backups/manual-sync logs.');
}
function launch(args, logName, env) {
  const log = fs.openSync(path.join(dir, logName), 'a');
  const child = spawn(process.execPath, args, { cwd: root, windowsHide: true, env, stdio: ['ignore', log, log] });
  fs.closeSync(log);
  children.push(child);
  child.on('error', error => { console.error(error.message); });
  return child;
}
function stop() {
  for (const child of children.reverse()) {
    if (child.exitCode !== null) continue;
    // Only process trees created by this runner, never existing user services.
    spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  }
}
process.once('SIGINT', () => { stop(); process.exit(0); });
process.once('SIGTERM', () => { stop(); process.exit(0); });

async function main() {
  await Promise.all(ports.map(freePort));
  fs.mkdirSync(app, { recursive: true });
  fs.cpSync(path.join(root, 'src'), path.join(app, 'src'), { recursive: true });
  // Replace ONLY the generated preview copy; no real credentials are copied into
  // its Firebase initializer and no environment can select a production project.
  fs.writeFileSync(path.join(app, 'src/lib/firebase.ts'), `
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, disableNetwork } from 'firebase/firestore';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
if (typeof window !== 'undefined' && !['127.0.0.1', 'localhost'].includes(window.location.hostname)) throw new Error('Local test only');
const existing = getApps().find(app => app.name === 'manual-sync');
const app = existing ?? initializeApp({ projectId: '${projectId}', apiKey: 'demo-only-not-a-real-key', authDomain: 'localhost' }, 'manual-sync');
export const db = getFirestore(app);
export const auth = getAuth(app);
auth.languageCode = 'pt-BR';
if (!existing) {
  connectFirestoreEmulator(db, '127.0.0.1', ${firestorePort});
  connectAuthEmulator(auth, 'http://127.0.0.1:${authPort}', { disableWarnings: true });
  if (typeof window !== 'undefined' && sessionStorage.getItem('manual-firestore-offline') === 'true') void disableNetwork(db);
}
`);
  fs.writeFileSync(path.join(app, 'src/components/ManualNetwork.tsx'), `'use client';
import { useEffect, useState } from 'react';
import { disableNetwork, enableNetwork } from 'firebase/firestore';
import { db } from '@/lib/firebase';
export default function ManualNetwork() {
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setOffline(sessionStorage.getItem('manual-firestore-offline') === 'true'); }, []);
  return <aside style={{padding:'12px',background:'#fff1ad',color:'#111',border:'3px solid #a33'}} aria-label="Ambiente de teste isolado">
    <strong>TESTE LOCAL APPCAR — projeto ${projectId} — somente dados fictícios</strong>
    <p id="manual-network-state">Firestore local: {offline ? 'desconectado' : 'conectado'}</p>
    <button id="manual-network-toggle" type="button" disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        if (offline) { await enableNetwork(db); sessionStorage.setItem('manual-firestore-offline','false'); }
        else { await disableNetwork(db); sessionStorage.setItem('manual-firestore-offline','true'); }
        setOffline(!offline); window.dispatchEvent(new Event(offline ? 'online' : 'offline'));
      } finally { setBusy(false); }
    }}>{offline ? 'Reconectar Firestore de teste' : 'Desconectar Firestore de teste'}</button>
  </aside>;
}
`);
  const layoutFile = path.join(app, 'src/app/layout.tsx');
  let layout = fs.readFileSync(layoutFile, 'utf8');
  layout = "import ManualNetwork from '@/components/ManualNetwork';\n" + layout;
  layout = layout.replace('{children}', '<ManualNetwork />{children}');
  fs.writeFileSync(layoutFile, layout);
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ private: true }));
  const config = JSON.parse(fs.readFileSync('tsconfig.json', 'utf8'));
  config.include = ['next-env.d.ts', 'src/**/*.ts', 'src/**/*.tsx', 'build/types/**/*.ts', 'build/dev/types/**/*.ts'];
  fs.writeFileSync(path.join(app, 'tsconfig.json'), JSON.stringify(config));
  fs.writeFileSync(path.join(app, 'next.config.mjs'), `import config from '../../../next.config.ts'; export default {...config,distDir:'build',turbopack:{...config.turbopack,root:${JSON.stringify(root)}}};`);

  const jdkRoot = path.join(process.env.ProgramFiles || 'C:/Program Files', 'Eclipse Adoptium');
  const installed = fs.readdirSync(jdkRoot).filter(name => /^jdk-(2[1-9]|[3-9]\d)/.test(name)).sort().at(-1);
  const javaHome = process.env.JAVA_HOME || (installed && path.join(jdkRoot, installed));
  if (!javaHome || !fs.existsSync(path.join(javaHome, 'bin/java.exe'))) throw new Error('Java 21+ not found');
  const env = { ...process.env, JAVA_HOME: javaHome, PATH: path.join(javaHome, 'bin') + ';' + process.env.PATH,
    CI: 'true', DEBUG: '', XDG_CONFIG_HOME: path.join(dir, 'cli-config'), FIREBASE_EMULATORS_PATH: path.join(root, '.backups/firebase-emulators') };
  const emulator = launch([path.join(root, 'node_modules/firebase-tools/lib/bin/firebase.js'), 'emulators:start',
    '--config', automatic ? 'firebase.auto-reset.json' : 'firebase.manual.json', '--project', projectId, '--only', 'auth,firestore', '--non-interactive'], 'emulators.log', env);
  await ready(async () => {
    if (emulator.exitCode !== null) throw new Error('Emulator stopped');
    const result = await fetch('http://127.0.0.1:' + hubPort + '/emulators');
    const body = await result.json();
    return body.auth?.port === authPort && body.firestore?.port === firestorePort;
  });
  const email = 'sync-manual@example.test', password = 'APPCAR-teste-local-21!';
  const authResponse = await fetch(`http://127.0.0.1:${authPort}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-only-not-a-real-key`, {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({email,password,returnSecureToken:true})
  });
  const account = await authResponse.json();
  if (!authResponse.ok || !account.localId) throw new Error('Could not create isolated test account');
  // Seed through the local Auth account and the actual rules, not an admin bypass.
  const fields = { custosFixos:{arrayValue:{values:[]}}, reservasDiarias:{arrayValue:{values:[]}},
    nomeReserva1:{stringValue:'Reserva teste 1'}, nomeReserva2:{stringValue:'Reserva teste 2'}, nomeReserva3:{stringValue:'Reserva teste 3'},
    lembrete:{stringValue:''}, historico:{arrayValue:{values:[]}}, modoEscuro:{booleanValue:true} };
  const seeded = await fetch(`http://127.0.0.1:${firestorePort}/v1/projects/${projectId}/databases/(default)/documents/users/${account.localId}/appData/main`, {
    method:'PATCH',headers:{'Content-Type':'application/json',Authorization:'Bearer '+account.idToken},body:JSON.stringify({fields})
  });
  if (!seeded.ok) throw new Error('Local fixture seed failed: '+seeded.status);
  const next = launch([path.join(root, 'node_modules/next/dist/bin/next'), 'dev', app, '--hostname','127.0.0.1','--port',String(appPort)], 'next.log', env);
  await ready(async () => { if (next.exitCode !== null) return false; const response=await fetch(url); return response.ok && (await response.text()).includes(projectId); });
  fs.writeFileSync(path.join(dir,'session.json'),JSON.stringify({projectId,url,email,password,uid:account.localId,startedAt:new Date().toISOString(),runnerPid:process.pid},null,2));
  console.log('READY: '+url+' — '+projectId+'; Auth '+authPort+'; Firestore '+firestorePort+'.');
  console.log('Fictitious account and instructions: '+path.join(dir,'session.json'));
  console.log('Keep this process running; Ctrl+C stops only its local services.');
  await new Promise((resolve,reject)=>{emulator.once('exit',()=>reject(new Error('Emulator stopped')));next.once('exit',()=>reject(new Error('Preview stopped')));});
}
main().catch(error=>{console.error(error.message);stop();process.exitCode=1;});
