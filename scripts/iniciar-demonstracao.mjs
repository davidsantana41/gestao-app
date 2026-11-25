import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

if (process.argv.includes('--usar-emulador')) {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8089';
  process.env.FIREBASE_EMULATOR_HUB = '127.0.0.1:4413';
}

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8089'
    || process.env.FIREBASE_EMULATOR_HUB !== '127.0.0.1:4413') {
  throw new Error('Execute npm run demo:local para iniciar o Firestore Emulator.');
}
const resposta = await fetch('http://127.0.0.1:4413/emulators', { redirect: 'error', signal: AbortSignal.timeout(5000) });
const hub = await resposta.json();
if (!resposta.ok || hub.firestore?.host !== '127.0.0.1' || hub.firestore.port !== 8089) {
  throw new Error('FireStore Emulator dedicado indisponível.');
}

function livre(porta) {
  return new Promise(resolve => {
    const teste = createServer();
    teste.once('error', () => resolve(false));
    teste.listen(porta, '127.0.0.1', () => teste.close(() => resolve(true)));
  });
}
const porta = await livre(3000) ? '3000' : await livre(3212) ? '3212' : null;
if (!porta) throw new Error('As portas 3000 e 3212 estão ocupadas. Os serviços existentes foram preservados.');

const raiz = process.cwd();
const app = resolve(`.backups/demonstracao-entrega-${porta}/app`);
mkdirSync(join(app, 'src/app'), { recursive: true });
for (const caminho of ['layout.tsx', 'globals.css', 'privacidade', 'cookies', 'demonstracao', 'api/demonstracao']) {
  cpSync(join(raiz, 'src/app', caminho), join(app, 'src/app', caminho), { recursive: true });
}
for (const pasta of ['src/components', 'src/lib']) {
  cpSync(join(raiz, pasta), join(app, pasta), { recursive: true, filter: arquivo => !arquivo.endsWith('firebase.ts') });
}
cpSync(join(raiz, 'public'), join(app, 'public'), { recursive: true });
writeFileSync(join(app, 'src/app/page.tsx'), "import { redirect } from 'next/navigation'; export default function Page() { redirect('/demonstracao'); }");
// Módulos legados que não são montados na demonstração não recebem um cliente Firebase.
writeFileSync(join(app, 'src/lib/firebase.ts'), "export const auth = undefined; export const db = undefined;");
writeFileSync(join(app, 'package.json'), '{"private":true}');
const ts = JSON.parse(readFileSync(join(raiz, 'tsconfig.json'), 'utf8'));
writeFileSync(join(app, 'tsconfig.json'), JSON.stringify(ts));
writeFileSync(join(app, 'next.config.mjs'), `import config from '../../../next.config.ts';
export default {...config,turbopack:{...config.turbopack,root:${JSON.stringify(raiz)}}};`);

const next = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'dev', app,
  '--hostname', '127.0.0.1', '--port', porta], {
  env: { ...process.env, APPCAR_DEMO_LOCAL: '1', APPCAR_DEMO_PORTA: porta }, stdio: 'inherit', windowsHide: true,
});
next.on('error', erro => { console.error(erro.message); process.exitCode = 1; });
next.on('exit', (codigo) => { process.exitCode = codigo ?? 0; });
console.log(`APPCAR fictício em http://localhost:${porta}/demonstracao`);
