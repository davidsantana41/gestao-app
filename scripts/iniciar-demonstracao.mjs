import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';

const financeiro = process.argv.includes('--financeiro');

if (process.argv.includes('--usar-emulador')) {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8089';
  process.env.FIREBASE_EMULATOR_HUB = '127.0.0.1:4413';
}

const portaFirestore = financeiro ? 8091 : 8089;
const portaHub = financeiro ? 4415 : 4413;
if (process.env.FIRESTORE_EMULATOR_HOST !== `127.0.0.1:${portaFirestore}`
    || process.env.FIREBASE_EMULATOR_HUB !== `127.0.0.1:${portaHub}`) {
  throw new Error('Execute npm run demo:local para iniciar o Firestore Emulator.');
}
const resposta = await fetch(`http://127.0.0.1:${portaHub}/emulators`, { redirect: 'error', signal: AbortSignal.timeout(5000) });
const hub = await resposta.json();
if (!resposta.ok || hub.firestore?.host !== '127.0.0.1' || hub.firestore.port !== portaFirestore) {
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
for (const caminho of ['page.tsx', 'layout.tsx', 'globals.css', 'privacidade', 'cookies', 'demonstracao', 'api/demonstracao']) {
  cpSync(join(raiz, 'src/app', caminho), join(app, 'src/app', caminho), { recursive: true });
}
for (const pasta of ['src/components', 'src/lib']) {
  cpSync(join(raiz, pasta), join(app, pasta), { recursive: true, filter: arquivo => !arquivo.endsWith('firebase.ts') });
}
cpSync(join(raiz, 'public'), join(app, 'public'), { recursive: true });
// Módulos legados que não são montados na demonstração não recebem um cliente Firebase.
writeFileSync(join(app, 'src/lib/firebase.ts'), "export const auth = undefined; export const db = undefined;");
writeFileSync(join(app, 'package.json'), '{"private":true}');
const ts = JSON.parse(readFileSync(join(raiz, 'tsconfig.json'), 'utf8'));
writeFileSync(join(app, 'tsconfig.json'), JSON.stringify(ts));

let servico;
const ambiente = { ...process.env, APPCAR_DEMO_LOCAL: '1', APPCAR_DEMO_PORTA: porta };
if (financeiro) {
  const { iniciarServicoFinanceiroEmulador, projetoFinanceiroEmulador } = await import('../src/lib/servicoFinanceiroEmulador.ts');
  const { dadosPadrao } = await import('../src/lib/gestao.ts');
  const { initializeApp, deleteApp } = await import('firebase/app');
  const { getFirestore, connectFirestoreEmulator, doc, runTransaction, terminate } = await import('firebase/firestore');
  if (process.env.GCLOUD_PROJECT !== projetoFinanceiroEmulador) throw new Error('Projeto financeiro fictício obrigatório.');
  const { acoesCaixinha } = await import('../src/lib/gestaoCaixinhasServidor.ts');
  servico = await iniciarServicoFinanceiroEmulador({ gestaoCaixinhas: true });
  const email = 'motorista-financeiro@appcar.test';
  const senha = randomBytes(24).toString('base64url');
  const espacoId = '00000000-0000-4000-8000-000000000051';
  const reservaId = '00000000-0000-4000-8000-000000000052';
  const fixture = initializeApp({ projectId: projetoFinanceiroEmulador }, 'fixture-painel-financeiro');
  const banco = getFirestore(fixture);
  connectFirestoreEmulator(banco, '127.0.0.1', portaFirestore, { mockUserToken: 'owner' });
  try {
    const criada = await fetch(`http://127.0.0.1:9097/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${projetoFinanceiroEmulador}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: senha }),
      redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    const { localId: uid } = await criada.json();
    if (!criada.ok || typeof uid !== 'string' || !uid) throw new Error('Conta fictícia indisponível.');
    const espaco = doc(banco, 'espacosFinanceiros', espacoId);
    await runTransaction(banco, async tx => {
      if ((await tx.get(espaco)).exists()) throw new Error('O espaço fictício já existe.');
      tx.set(espaco, { proprietarioUid: uid, comandosFinanceiros: true, operacoesFinanceiras: ['turno', 'entrada', 'retirada', 'excluir', ...acoesCaixinha] });
      tx.set(doc(espaco, 'dados', 'main'), { ...dadosPadrao(), custosFixos: [{ id: 'seguro', nome: 'Seguro', valorMensal: 230 }],
        reservasDiarias: [{ id: reservaId, nome: 'Manutenção', valor: 0 }], _sync: { generation: 0, revision: 0 } });
      for (const id of ['fixo:seguro', 'reserva-fixa:reserva1', 'reserva-fixa:reserva2', 'reserva-fixa:reserva3', `diaria:${reservaId}`]) {
        tx.set(doc(espaco, 'caixinhas', encodeURIComponent(id)), { id, estado: 'ativa' });
      }
    });
    Object.assign(ambiente, { APPCAR_FINANCEIRO_ORIGEM: servico.origem, APPCAR_FINANCEIRO_UID: uid,
      APPCAR_FINANCEIRO_ESPACO: espacoId, APPCAR_FINANCEIRO_EMAIL: email, APPCAR_FINANCEIRO_SENHA: senha });
  } catch (erro) {
    await servico.encerrar();
    throw erro;
  } finally {
    await terminate(banco);
    await deleteApp(fixture);
  }
}

writeFileSync(join(app, 'next.config.mjs'), `import config from '../../../next.config.ts';
const origem = process.env.APPCAR_FINANCEIRO_ORIGEM;
export default {...config,turbopack:{...config.turbopack,root:${JSON.stringify(raiz)}},
  redirects: async () => [{ source: '/', destination: '/demonstracao', permanent: false }],
  ...(origem && { rewrites: async () => [
    { source: '/sessao', destination: origem + '/sessao' },
    { source: '/espacos/:id/:acao(consulta|comandos)', destination: origem + '/espacos/:id/:acao' },
  ] })};`);

const next = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'dev', app,
  '--hostname', '127.0.0.1', '--port', porta], {
  env: ambiente, stdio: 'inherit', windowsHide: true,
});
next.on('error', erro => { console.error(erro.message); process.exitCode = 1; });
next.on('close', async (codigo) => { await servico?.encerrar(); process.exitCode = codigo ?? 0; });
console.log(`APPCAR fictício em http://localhost:${porta}/demonstracao`);
