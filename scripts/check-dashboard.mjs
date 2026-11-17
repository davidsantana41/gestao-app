// Testa a aplicação reconstruída no Next.js real; todo armazenamento remoto é simulado.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

async function main() {
  const dir = path.resolve('.next/dashboard-check');
  const app = path.join(dir, 'next-app');
  fs.mkdirSync(app, { recursive: true });
  fs.cpSync('src', path.join(app, 'src'), { recursive: true });
  let page = fs.readFileSync('src/app/page.tsx', 'utf8');
  page = page.slice(0, page.indexOf('export default function Home()')) + `
export default function TestPage() {
  useEffect(() => {
    window.confirm = () => window.__confirm !== false;
    window.alert = message => { window.__alert = message; };
  }, []);
  return <Dashboard uid="regression-test" email="teste@example.com" />;
}`;
  fs.writeFileSync(path.join(app, 'src/app/page.tsx'), page);
  fs.writeFileSync(path.join(app, 'src/lib/firebase.ts'), 'export const auth = {}, db = {};');
  let hook = fs.readFileSync('src/lib/useGestao.ts', 'utf8').replace("from 'firebase/firestore'", "from './testStorage'");
  fs.writeFileSync(path.join(app, 'src/lib/useGestao.ts'), hook);
  fs.writeFileSync(path.join(app, 'src/lib/syncSession.ts'), fs.readFileSync('src/lib/syncSession.ts','utf8').replace("from 'firebase/firestore'", "from './testStorage'"));
  fs.writeFileSync(path.join(app, 'src/lib/testStorage.ts'), `
import { dadosPadrao } from './gestao';
const legado = { id: 'legado-1', data: '13/11/2026', diaSemana: 'sexta-feira', tipo: 'turno', descricao: 'Lançamento preservado', faturamentoBruto: 300, combustivel: 40, litros: 10, kmTrabalhado: 100, kmTotal: 110, reservaFevereiro: 2, reservaInvestimento: 3, reservaAcidente: 4.18, custosFixosDia: 15, detalheCustosFixosDia: { '1': 15 }, reservasDiariasDia: [{ id: 'reserva-legada', nome: 'Reserva anterior', valor: 7.5 }], saidas: [], totalDespesas: 71.68, liquido: 228.32 };
const seed = { ...dadosPadrao(), historico: [legado], lembrete: 'Lembrete preservado' };
export const doc = () => ({});
export const getDoc = async () => {
 if (window.__offline) throw new Error('Offline simulado');
 return { exists: () => true, data: () => JSON.parse(localStorage.getItem('mock-remote') || JSON.stringify(seed)) };
};
export const getDocFromServer = getDoc;
export type Firestore = object;
export const runTransaction = async (_db, action) => {
 let next;
 const result = await action({get: getDoc, set: (_ref, value) => {next = value;}});
 if (next) await setDoc({},next);
 return result;
};
export const onSnapshot = (_ref, _options, accept, error) => {
 const refresh = () => { void getDoc().then(snapshot => accept({...snapshot, metadata:{fromCache:false,hasPendingWrites:false}})).catch(error); };
 const changed = event => { if (event.key === 'mock-remote') refresh(); };
 window.addEventListener('mock-remote-change',refresh);window.addEventListener('storage',changed);refresh();
 return () => {window.removeEventListener('mock-remote-change',refresh);window.removeEventListener('storage',changed);};
};
export const setDoc = async (_ref, dados) => {
 await new Promise(resolve => setTimeout(resolve, 75));
 if (window.__offline) throw new Error('Offline simulado');
 (window.__writes ??= []).push(JSON.parse(JSON.stringify(dados)));
 localStorage.setItem('mock-remote', JSON.stringify(dados));
 window.dispatchEvent(new Event('mock-remote-change'));
};
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
    await evaluate(`new Promise((resolve, reject) => { const start = Date.now(); const timer = setInterval(() => { if (document.querySelector('[data-testid="total-reservas"]')) { clearInterval(timer); resolve(true); } else if (Date.now() - start > 20000) { clearInterval(timer); reject(new Error(document.body.textContent)); } }, 50); })`);
    await evaluate(`window.change = (input, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); };
window.tick = () => new Promise(resolve => setTimeout(resolve, 50));
window.button = text => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text);
window.field = text => [...document.querySelectorAll('label')].find(l => l.querySelector('span')?.textContent === text)?.querySelector('input');
window.rows = () => [...document.querySelectorAll('[data-testid="reserva"]')];`);
    assert.equal(await evaluate('(window.__writes || []).length'), 0, 'Carregar nunca deve gravar na nuvem.');
    const legacy = await evaluate(`JSON.parse(localStorage.getItem('gestao-app-dados-v2-regression-test-nuvem-antes-reconstrucao')).historico[0]`);
    assert.equal(legacy.id, 'legado-1');
    const live = await evaluate(`(async () => {
 for (const [nome, valor] of [['Reserva para janeiro','20'], ['PIZZA','18']]) {
  button('+ Adicionar reserva').click(); await tick();
  const row = rows().at(-1); change(row.querySelectorAll('input')[0], nome); await tick(); change(row.querySelectorAll('input')[1], valor); await tick();
 }
 change(field('Faturamento bruto (R$)'), '461,33'); await tick();
 change(field('Valor gasto (R$)'), '92,20'); await tick();
 change(field('Litros'), '23,11'); await tick();
 change(field('KM trabalhado'), '238,1'); await tick();
 change(field('KM total do carro'), '246,3'); await tick();
 return { total: document.querySelector('[data-testid="total-reservas"]').textContent, resumo: [...document.querySelectorAll('[data-testid="resumo-reserva"]')].map(r => r.textContent), preco: document.querySelector('[data-testid="preco-litro"]').textContent, consumo: document.querySelector('[data-testid="consumo"]').textContent };
})()`);
    assert.match(live.total, /38,00/); assert.match(live.resumo[1], /PIZZA/); assert.match(live.preco, /3,99/); assert.match(live.consumo, /10,30/);
    const deletion = await evaluate(`(async () => {
 window.__confirm = false; rows().at(-1).querySelector('button').click(); await tick(); const cancelou = rows().length;
 window.__confirm = true; rows().at(-1).querySelector('button').click(); await tick(); const excluiu = rows().length;
 button('+ Adicionar reserva').click(); await tick(); const row = rows().at(-1); change(row.querySelectorAll('input')[0], 'Investimento'); await tick(); change(row.querySelectorAll('input')[1], '25,50'); await tick();
 button('Histórico e relatórios').click(); await tick(); button('Registrar turno').click(); await tick();
 return { cancelou, excluiu, total: document.querySelector('[data-testid="total-reservas"]').textContent };
})()`);
    assert.equal(deletion.cancelou, 2); assert.equal(deletion.excluiu, 1); assert.match(deletion.total, /45,50/);
    await evaluate(`(async () => { button('Salvar turno').click(); await new Promise(r => setTimeout(r, 400)); })()`);
    const saved = await evaluate(`JSON.parse(localStorage.getItem('mock-remote'))`);
    assert.equal(saved.historico.length, 2); assert.deepEqual(saved.historico[1], legacy);
    assert.equal(saved.historico[0].reservasDiariasDia[1].nome, 'Investimento');
    assert.equal(saved.historico[0].reservasDiariasDia[1].valor, 25.5);
    assert.match(await evaluate(`document.querySelector('[data-testid="total-reservas"]').textContent`), /0,00/);
    await evaluate(`(async () => { button('Editar').click(); await tick(); change(field('Faturamento bruto (R$)'), '500'); await tick(); button('Salvar alterações').click(); await new Promise(r => setTimeout(r, 400)); })()`);
    const edited = await evaluate(`JSON.parse(localStorage.getItem('mock-remote'))`);
    assert.equal(edited.historico.length, 2); assert.equal(edited.historico[0].id, saved.historico[0].id); assert.equal(edited.historico[0].faturamentoBruto, 500); assert.deepEqual(edited.historico[1], legacy);
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'A página deve caber no celular.');
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId);
    fs.writeFileSync(path.join(dir, 'mobile.png'), Buffer.from(screenshot.data, 'base64'));
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
    const desktop = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId);
    fs.writeFileSync(path.join(dir, 'desktop.png'), Buffer.from(desktop.data, 'base64'));
    await evaluate(`(async () => {
 button('Custos fixos').click(); await tick();
 const input = [...document.querySelectorAll('label')].find(l => l.querySelector('span')?.textContent === 'Valor mensal (R$)').querySelector('input');
 change(input, '1000,50'); await tick(); button('Salvar custos fixos').click(); await new Promise(r => setTimeout(r, 350));
 button('Registrar turno').click(); await tick();
})()`);
    const configured = await evaluate(`JSON.parse(localStorage.getItem('mock-remote'))`);
    assert.equal(configured.custosFixos[0].valorMensal, 1000.5);
    assert.deepEqual(configured.historico, edited.historico, 'Alterar custos não pode modificar turnos salvos.');
    await evaluate(`(async () => {
 change(field('Descrição'), 'Retirada da reserva'); await tick();
 change(document.querySelector('.avulso-grid input[inputmode="decimal"]'), '10'); await tick();
 const select = document.querySelectorAll('.avulso-grid select')[1];
 const data = JSON.parse(localStorage.getItem('mock-remote'));
 const reserva = data.historico[0].reservasDiariasDia[1];
 Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'diaria:' + reserva.id); select.dispatchEvent(new Event('change', { bubbles: true })); await tick();
 button('Registrar movimentação').click(); await new Promise(r => setTimeout(r, 350));
})()`);
    const withdrawal = await evaluate(`JSON.parse(localStorage.getItem('mock-remote'))`);
    assert.equal(withdrawal.historico.length, 3);
    assert.equal(withdrawal.historico[0].liquido, 0);
    assert.equal(withdrawal.historico[0].saidas[0].valor, 10);
    await evaluate(`(async () => {
 window.__offline = true;
 change(field('Descrição'), 'Movimentação offline'); await tick();
 change(document.querySelector('.avulso-grid input[inputmode="decimal"]'), '5'); await tick();
 button('Registrar movimentação').click(); await new Promise(r => setTimeout(r, 350));
 const memo=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(memo,'Lembrete offline em conflito');memo.dispatchEvent(new Event('input',{bubbles:true}));await tick();button('Salvar lembrete').click();await tick();
})()`);
    const offline = await evaluate(`({ local: JSON.parse(localStorage.getItem('gestao-app-dados-v2-regression-test')), remote: JSON.parse(localStorage.getItem('mock-remote')), pending: localStorage.getItem('gestao-app-dados-v2-regression-test-pendente') })`);
    assert.equal(offline.local.historico.length, 4); assert.equal(offline.remote.historico.length, 3); assert.equal(offline.pending, 'true');
    await evaluate(`const cloud=JSON.parse(localStorage.getItem('mock-remote'));cloud.lembrete='Alterado em outro dispositivo';localStorage.setItem('mock-remote',JSON.stringify(cloud));`);
    await send('Page.reload', {}, sessionId);
    await new Promise(resolve => setTimeout(resolve, 400));
    await evaluate(`new Promise((resolve, reject) => { const start = Date.now(); const timer = setInterval(() => { if (document.body.textContent.includes('Escolha a versão dos seus dados')) { clearInterval(timer); resolve(true); } else if (Date.now() - start > 10000) { clearInterval(timer); reject(new Error('Conflito local/nuvem não detectado')); } }, 50); })`);
    await evaluate(`(async () => { const tick = () => new Promise(r => setTimeout(r, 50)); const button = text => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text); [...document.querySelectorAll('button')].find(b => b.textContent.includes('Usar dados deste navegador')).click(); await tick(); button('Cancelar').click(); await tick(); if (document.querySelector('dialog')) throw new Error('Cancelar deve fechar o diálogo'); if (!document.body.textContent.includes('Escolha a versão dos seus dados')) throw new Error('Cancelar deve preservar o conflito'); button('Usar dados deste navegador').click(); await tick(); if (!document.querySelector('dialog[open]')) throw new Error('Confirmação deve abrir como modal'); button('Confirmar escolha').click(); await new Promise(r => setTimeout(r, 400)); })()`);
    const recovered = await evaluate(`JSON.parse(localStorage.getItem('mock-remote'))`);
    assert.equal(recovered.historico.length, 4);
    assert.deepEqual(recovered.historico.at(-1), legacy);
    await evaluate(`(async () => {
      localStorage.setItem('gestao-app-dados-v2-another-user', JSON.stringify({private: 'other-account'}));
      const button = text => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text);
      button('Privacidade').click(); await new Promise(r => setTimeout(r, 100));
      window.__createObjectURL = URL.createObjectURL;
      URL.createObjectURL = blob => { window.__exportedPrivacy = blob.text(); return window.__createObjectURL(blob); };
      button('Baixar meus dados pessoais').click();
    })()`);
    const privacy = JSON.parse(await evaluate('window.__exportedPrivacy'));
    assert.equal(privacy.conta.identificador, 'regression-test');
    assert.equal(privacy.dadosEmUso.historico.length, 4);
    assert.ok(privacy.copiasNesteNavegador['-antes-resolver-local']);
    assert.equal(JSON.stringify(privacy).includes('other-account'), false, 'Export must isolate local backups by account.');
    assert.equal(await evaluate("document.querySelector('a[href^=mailto]').href.includes('davidangelosantana%40gmail.com') || document.querySelector('a[href^=mailto]').href.includes('davidangelosantana@gmail.com')"), true);
    await evaluate(`window.button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);window.tick=()=>new Promise(r=>setTimeout(r,80));window.field=text=>[...document.querySelectorAll('label')].find(l=>l.querySelector('span')?.textContent===text)?.querySelector('input');window.change=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};`);
    // Browser-level regression: remote refresh preserves an unsaved form, and
    // independent tabs sharing localStorage retain both pending journals.
    await evaluate(`(async()=>{button('Registrar turno').click();await tick();change(field('Faturamento bruto (R$)'), '777');await tick();const remote=JSON.parse(localStorage.getItem('mock-remote'));remote.lembrete='Mudança remota';localStorage.setItem('mock-remote',JSON.stringify(remote));button('Verificar sincronização').click();await new Promise(r=>setTimeout(r,300));})()`);
    assert.equal(await evaluate(`field('Faturamento bruto (R$)').value`),'777');
    assert.equal(await evaluate("document.body.textContent.includes('Escolha a versão dos seus dados')"),false);
    const second = await send('Target.createTarget', {url: 'about:blank'});
    const attached = await send('Target.attachToTarget', {targetId: second.targetId, flatten:true});
    const other = async expression => {
      const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},attached.sessionId);
      if(result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    };
    await send('Page.navigate',{url:'http://127.0.0.1:'+port},attached.sessionId);
    await other(`new Promise((resolve,reject)=>{const timer=setInterval(()=>{if(document.querySelector('textarea')){clearInterval(timer);resolve(true);}},50);setTimeout(()=>reject(new Error('Second tab timeout')),15000);})`);
    await evaluate(`(async()=>{window.__offline=true;const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Rascunho A');input.dispatchEvent(new Event('input',{bubbles:true}));await tick();button('Salvar lembrete').click();await tick();})()`);
    await other(`(async()=>{window.__offline=true;const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Rascunho B');input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,100));[...document.querySelectorAll('button')].find(b=>b.textContent==='Salvar lembrete').click();await new Promise(r=>setTimeout(r,200));})()`);
    const journals=await evaluate(`Object.keys(localStorage).filter(k=>k.startsWith('gestao-app-dados-v2-regression-test-sync-')).map(k=>JSON.parse(localStorage.getItem(k))).filter(e=>e.pending).map(e=>e.data.lembrete)`);
    assert.ok(journals.includes('Rascunho A'));assert.ok(journals.includes('Rascunho B'));
    assert.equal(await evaluate(`field('Faturamento bruto (R$)').value`),'777');
    await send('Target.closeTarget',{targetId:second.targetId});
    console.log('PASS: duas abas preservam seus próprios lembretes pendentes; atualização remota mantém formulário não salvo.');
    assert.deepEqual(errors, []);
    console.log('PASS: Next.js real: nomes, R$ 38,00, R$ 3,99/L, 10,30 km/L, excluir/cancelar/recriar, vírgula decimal, navegação preserva formulário, salvar/editar sem duplicar, histórico legado intacto e layout móvel.');
    console.log('PASS: custos preservam histórico; retirada de reserva; falha de rede mantém backup local; recarregar detecta conflito; recuperar sincroniza sem perder registros.');
  } finally {
    if (ws) ws.close();
    if (chrome) chrome.kill();
    if (next) next.kill();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
