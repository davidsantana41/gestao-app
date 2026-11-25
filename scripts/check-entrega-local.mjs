import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';

const origem = process.argv.includes('--alternativa') ? 'http://127.0.0.1:3212' : 'http://localhost:3000';
const destino = origem + '/demonstracao';
const base = resolve('.backups/demonstracao-entrega');
mkdirSync(base, { recursive: true });
const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--no-proxy-server', '--no-first-run', '--disable-background-networking',
  '--remote-debugging-port=0', `--user-data-dir=${mkdtempSync(resolve(base, 'chrome-'))}`, 'about:blank',
], { windowsHide: true });
let ws;
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome indisponível.')), 15_000);
    chrome.once('error', reject);
    chrome.stderr.on('data', msg => {
      const url = /DevTools listening on (ws:\/\/\S+)/.exec(String(msg))?.[1];
      if (url) { clearTimeout(timer); resolve(url); }
    });
  });
  ws = new WebSocket(endpoint);
  await once(ws, 'open', { signal: AbortSignal.timeout(5000) });
  let id = 0;
  const chamadas = new Map();
  ws.addEventListener('message', e => {
    const msg = JSON.parse(e.data);
    chamadas.get(msg.id)?.(msg);
  });
  function enviar(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const chave = ++id;
      const timer = setTimeout(() => { chamadas.delete(chave); reject(new Error(`CDP: ${method}`)); }, 30_000);
      chamadas.set(chave, msg => {
        clearTimeout(timer);
        chamadas.delete(chave);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      });
      ws.send(JSON.stringify({ id: chave, method, params, sessionId }));
    });
  }
  const { targetId } = await enviar('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await enviar('Target.attachToTarget', { targetId, flatten: true });
  const avaliar = async expression => {
    const resultado = await enviar('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (resultado.exceptionDetails) throw new Error(resultado.exceptionDetails.exception?.description ?? resultado.exceptionDetails.text);
    return resultado.result.value;
  };
  const esperar = async expressao => {
    for (let tentativa = 0; tentativa < 240; tentativa++) {
      if (await avaliar(expressao).catch(() => false)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Condição não encontrada: ${expressao}`);
  };
  const texto = valor => `document.body?.innerText.includes(${JSON.stringify(valor)})`;
  const clicar = async valor => {
    const alvo = `[...document.querySelectorAll('button')].find(b => !b.disabled && b.getClientRects().length && b.textContent.trim() === ${JSON.stringify(valor)})`;
    await esperar(`Boolean(${alvo})`);
    await avaliar(`${alvo}.click()`);
  };
  const abrirMenu = () => avaliar("document.querySelector('.demo-conta-menu summary').click()");
  const abrirConta = async item => { await abrirMenu(); await clicar(item); await esperar("Boolean(document.querySelector('dialog[open]'))"); };
  const campo = async (nome, valor) => {
    const alvo = `document.querySelector('[name="${nome}"]')`;
    await esperar(`Boolean(${alvo})`);
    await avaliar(`${alvo}.value = ${JSON.stringify(valor)}`);
  };
  const nome = 'Teste ' + Date.now();
  await enviar('Page.navigate', { url: destino }, sessionId);
  await esperar(texto('Caixinhas ativas'));
  await clicar('Criar caixinha');
  await campo('nome', nome);
  await clicar('Confirmar criar');
  await esperar(texto('Criação'));
  await esperar(texto('Renomear ' + nome));
  await clicar('Renomear ' + nome);
  await campo('nome', nome + ' revisto');
  await campo('motivo', 'Verificação fictícia');
  await clicar('Confirmar renomear');
  await esperar(texto('Arquivar ' + nome + ' revisto'));
  await clicar('Arquivar ' + nome + ' revisto');
  await campo('motivo', 'Saldo zerado');
  await clicar('Confirmar arquivar');
  await esperar(texto('Reativar ' + nome + ' revisto'));
  await clicar('Reativar ' + nome + ' revisto');
  await campo('motivo', 'Retomada fictícia de ' + nome);
  await clicar('Confirmar reativar');
  await esperar(texto('Retomada fictícia de ' + nome));
  await clicar('Criar caixinha');
  await campo('nome', nome + ' revisto');
  await clicar('Confirmar criar');
  const homonimas = `Array.from(document.querySelectorAll('article > strong')).filter(s => s.textContent === ${JSON.stringify(nome + ' revisto')}).length === 2`;
  await esperar(homonimas);
  await enviar('Page.reload', {}, sessionId);
  await esperar(homonimas);
  assert.ok(await avaliar(texto('Autor ficticio-motorista-demo')));
  assert.ok(await avaliar(texto('Pendências de conciliação')));
  await clicar('Arquivar Combustível');
  await esperar(texto('Saldo positivo'));
  await clicar('Voltar');
  assert.equal(await avaliar("document.querySelectorAll('main input[name=placa]').length"), 0);
  await abrirConta('Meu perfil');
  for (const [chave, valor] of Object.entries({ nome: 'Marina Exemplo', nascimento: '1990-06-15', email: 'marina@appcar.test', celular: '11900000000' })) {
    await campo(chave, valor);
  }
  await clicar('Salvar perfil');
  await esperar(texto('Perfil fictício salvo.'));
  await esperar(texto('Marina Exemplo'));
  await clicar('Fechar');
  await abrirConta('Meus veículos');
  for (const [chave, valor] of Object.entries({ marca: 'Marca Exemplo', modelo: 'Modelo Exemplo', versao: 'Touring',
    anoFabricacao: '2024', anoModelo: '2025', placa: 'ABC1D23', km: '37250', combustivel: 'Flex', cor: 'Azul' })) {
    await campo(chave, valor);
  }
  await clicar('Salvar veículo');
  await esperar(texto('Veículo fictício salvo.'));
  await clicar('Fechar');
  await abrirConta('Configurações');
  await avaliar("(() => { const select = document.querySelector('dialog select'); select.value = 'claro'; select.dispatchEvent(new Event('change', { bubbles: true })); })()");
  await esperar("document.querySelector('main').classList.contains('claro')");
  await clicar('Fechar');
  await enviar('Page.reload', {}, sessionId);
  await esperar(texto('Caixinhas ativas'));
  await esperar(texto('Marina Exemplo'));
  await esperar("document.querySelector('main').classList.contains('claro')");
  await abrirConta('Meus veículos');
  assert.equal(await avaliar("document.querySelector('[name=placa]').value"), 'ABC1D23');
  assert.equal(await avaliar("document.querySelector('[name=km]').value"), '37250');
  assert.equal(await avaliar("document.querySelector('[name=anoModelo]').value"), '2025');
  await enviar('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
  assert.ok(await avaliar("document.querySelector('dialog').getBoundingClientRect().width <= innerWidth"));
  assert.equal(await avaliar("getComputedStyle(document.querySelector('.demo-conta-grade')).gridTemplateColumns.split(' ').length"), 1);
  await enviar('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId);
  await enviar('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId);
  await esperar("!document.querySelector('dialog[open]')");
  await esperar("document.activeElement?.tagName === 'SUMMARY'");
  await clicar('Espaço compartilhado');
  await esperar(texto('Relatórios'));
  assert.ok(await avaliar(texto('Somente visualização')));
  assert.ok(await avaliar('document.documentElement.scrollWidth <= innerWidth'));
  await abrirMenu();
  await clicar('Sair');
  await esperar(texto('Sessão de demonstração encerrada'));
  await enviar('Page.reload', {}, sessionId);
  await esperar(texto('Sessão de demonstração encerrada'));
  await clicar('Entrar na demonstração');
  await esperar(texto('Marina Exemplo'));
  console.log('PASS: ciclo persistente, auditoria, perfil no menu, veículo completo, tema, saída e reentrada, parceiro e largura móvel.');
  await enviar('Browser.close').catch(() => {});
} finally {
  ws?.close();
  if (chrome.exitCode === null) chrome.kill();
}
