import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { deleteApp, initializeApp } from 'firebase/app';
import { connectFirestoreEmulator, doc, getDocFromServer, getFirestore, setDoc, terminate, updateDoc } from 'firebase/firestore';
import { dadosPadrao, resumir } from '../src/lib/gestao.ts';
import { iniciarServicoFinanceiroEmulador, projetoFinanceiroEmulador as projeto } from '../src/lib/servicoFinanceiroEmulador.ts';

const host = '127.0.0.1';
const espacoId = '00000000-0000-4000-8000-000000000031';
const reservaId = '00000000-0000-4000-8000-000000000032';
const idCaixinha = `diaria:${reservaId}`;
const segredo = 'Chave-local-ficticia-unica-3I';
const entrada = { tipo: 'entrada', data: '2026-11-24', descricao: 'Receita fictícia protegida', valorCentavos: 1000 };
const retirada = valorCentavos => ({ ...entrada, tipo: 'retirada', valorCentavos, origem: idCaixinha });

async function iniciarChrome(perfil, origem) {
  const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--no-sandbox', '--no-first-run', '--disable-background-networking', '--disable-gpu', '--no-proxy-server',
    '--remote-debugging-port=0', `--user-data-dir=${perfil}`, 'about:blank',
  ], { windowsHide: true });
  const saiu = once(chrome, 'exit');
  let ws;
  try {
    const endpoint = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Chrome não iniciou.')), 15000);
      chrome.once('error', erro => { clearTimeout(timer); reject(erro); });
      chrome.stderr.on('data', chunk => {
        const url = /DevTools listening on (ws:\/\/\S+)/.exec(String(chunk))?.[1];
        if (url) { clearTimeout(timer); resolve(url); }
      });
    });
    ws = new WebSocket(endpoint);
    await once(ws, 'open', { signal: AbortSignal.timeout(5000) });
  } catch (erro) {
    chrome.kill();
    throw erro;
  }
  let sequencia = 0;
  const pendencias = new Map();
  ws.addEventListener('message', evento => {
    const dados = JSON.parse(evento.data);
    pendencias.get(dados.id)?.(dados);
  });
  function cdp(method, params = {}, sessionId, prazo = 20000) {
    return new Promise((resolve, reject) => {
      const id = ++sequencia;
      const timer = setTimeout(() => {
        pendencias.delete(id);
        reject(new Error(`Chrome sem resposta: ${method}`));
      }, prazo);
      pendencias.set(id, dados => {
        clearTimeout(timer);
        pendencias.delete(id);
        if (dados.error) reject(new Error(dados.error.message));
        else resolve(dados.result);
      });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  return {
    async aba() {
      const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
      const navegacao = await cdp('Page.navigate', { url: origem }, sessionId);
      if (navegacao.errorText) throw new Error(`Navegação local falhou: ${navegacao.errorText}`);
      const avaliar = async expression => {
        const resposta = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
        if (resposta.exceptionDetails) throw new Error(resposta.exceptionDetails.exception?.description ?? resposta.exceptionDetails.text);
        return resposta.result.value;
      };
      for (let tentativa = 0; tentativa < 60; tentativa++) {
        if (await avaliar('document.title').catch(() => null) === 'Fila fictícia') return avaliar;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      const estado = await avaliar('({titulo: document.title, endereco: location.href})');
      throw new Error(`A origem local do navegador não carregou: ${JSON.stringify(estado)}`);
    },
    async fechar() {
      try {
        await cdp('Browser.close', {}, undefined, 3000).catch(() => {});
        await Promise.race([saiu, new Promise(resolve => setTimeout(resolve, 3000))]);
      } finally {
        ws.close();
        if (chrome.exitCode === null && chrome.signalCode === null) chrome.kill();
      }
      await saiu;
    },
  };
}

test('fila criptografada recupera comandos e reconcilia recibos no Chrome com o serviço emulado', { timeout: 120000 }, async t => {
  const servico = await iniciarServicoFinanceiroEmulador();
  t.after(() => servico.encerrar());
  const app = initializeApp({ projectId: projeto }, 'fixture-fila');
  const db = getFirestore(app);
  connectFirestoreEmulator(db, host, 8091, { mockUserToken: 'owner' });
  t.after(async () => { await terminate(db); await deleteApp(app); });
  async function sessao(nome) {
    const email = `${nome}@appcar.test`, senha = 'Senha-ficticia-3I';
    const cabecalho = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
    const criada = await fetch(`http://${host}:9097/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${projeto}`, {
      ...cabecalho, body: JSON.stringify({ email, password: senha, returnSecureToken: true }),
    });
    assert.equal(criada.status, 200);
    const resposta = await fetch(servico.origem + '/sessao', { ...cabecalho, body: JSON.stringify({ email, senha }) });
    assert.equal(resposta.status, 200);
    return resposta.json();
  }
  const titular = await sessao('fila-titular');
  const outro = await sessao('fila-outra-conta');
  const espaco = doc(db, 'espacosFinanceiros', espacoId);
  const financeiro = doc(espaco, 'dados', 'main');
  const caixinha = doc(espaco, 'caixinhas', encodeURIComponent(idCaixinha));
  const financeiroAtual = async () => (await getDocFromServer(financeiro)).data();
  const historico = [{
    id: 'historico-ficticio', tipo: 'turno', data: '22/11/2026', faturamentoBruto: 20,
    totalDespesas: 2, liquido: 18, combustivel: 0,
    reservasDiariasDia: [{ id: reservaId, nome: 'Reserva fictícia', valor: 2 }],
  }];
  await setDoc(espaco, { proprietarioUid: titular.uid, comandosFinanceiros: true, operacoesFinanceiras: ['entrada', 'retirada'] });
  await setDoc(caixinha, { id: idCaixinha, estado: 'ativa' });
  await setDoc(financeiro, { ...dadosPadrao(), custosFixos: [], historico,
    _sync: { generation: 0, revision: 1 } });

  const fonte = await readFile(new URL('../src/lib/filaFinanceiraOffline.ts', import.meta.url), 'utf8');
  const modulo = ts.transpileModule(fonte, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  let falha, chamadas = 0;
  let confirmou;
  const site = createServer(async (req, res) => {
    try {
      if (req.url === '/') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end('<!doctype html><title>Fila fictícia</title>');
      }
      if (req.url === '/fila.js') {
        res.setHeader('Content-Type', 'text/javascript');
        return res.end(modulo);
      }
      if (req.url !== `/espacos/${espacoId}/comandos`) {
        res.statusCode = 404;
        return res.end();
      }
      chamadas++;
      const modo = falha;
      falha = undefined;
      if (modo === 'antes') return res.destroy();
      const partes = [];
      for await (const parte of req) partes.push(parte);
      const resposta = await fetch(servico.origem + req.url, {
        method: 'POST', body: Buffer.concat(partes),
        headers: { 'Content-Type': 'application/json', Authorization: req.headers.authorization,
          'X-Appcar-Conta-Fila': req.headers['x-appcar-conta-fila'] },
      });
      const corpo = await resposta.text();
      if (modo === 'depois') {
        confirmou?.(resposta.status);
        return;
      }
      res.writeHead(resposta.status, { 'Content-Type': 'application/json' });
      res.end(corpo);
    } catch (erro) {
      console.error('Falha de transporte no proxy de teste:', erro.message);
      res.destroy();
    }
  });
  site.listen(0, host);
  await once(site, 'listening');
  t.after(async () => {
    site.closeAllConnections();
    await new Promise(resolve => site.close(resolve));
  });
  const origem = `http://${host}:${site.address().port}`;
  const perfil = await mkdtemp(join(tmpdir(), 'appcar-fila-'));
  let navegador = await iniciarChrome(perfil, origem);
  t.after(() => navegador?.fechar());
  async function abrir(conta = titular, geracao = 0, chave = segredo) {
    const aba = await navegador.aba();
    const escopo = { uid: conta.uid, espacoId, geracao };
    await aba(`(async () => {
      window.token = ${JSON.stringify(conta.token)};
      window.fila = await (await import('/fila.js')).abrirFilaFinanceiraOffline({
        escopo: ${JSON.stringify(escopo)}, segredoLocal: ${JSON.stringify(chave)}, obterToken: async () => window.token
      });
    })()`);
    return aba;
  }
  let aba = await abrir();
  console.log('Navegador local abriu a fila no perfil de teste.');
  const incluir = (revisao, movimento, janela = aba) => janela(`fila.enfileirar(${revisao}, ${JSON.stringify(movimento)})`);
  const enviar = (janela = aba) => janela('fila.enviarProximo()');
  const pendente = await incluir(1, entrada);
  assert.equal(pendente.estado, 'pendente');
  assert.equal((await financeiroAtual())._sync.revision, 1);
  falha = 'antes';
  assert.equal((await enviar()).estado, 'pendente');
  assert.equal(chamadas, 1, 'O navegador deve alcançar o proxy local.');
  assert.deepEqual((await financeiroAtual()).historico, historico);

  falha = 'depois';
  const remoto = new Promise((resolve, reject) => {
    const temporizador = setTimeout(() => reject(new Error('O proxy não observou a confirmação no Firestore.')), 15000);
    confirmou = status => { clearTimeout(temporizador); resolve(status); };
  });
  await aba('void fila.enviarProximo().catch(() => {})');
  assert.equal(await remoto, 200);
  console.log('Resposta retida após confirmação no Firestore. Reiniciando o navegador.');
  await navegador.fechar();
  navegador = undefined;
  navegador = await iniciarChrome(perfil, origem);
  aba = await abrir();
  assert.equal((await aba('fila.listar()'))[0].estado, 'enviando');
  const segunda = await abrir();
  const antes = chamadas;
  const resultados = await Promise.all([enviar(), enviar(segunda)]);
  const final = resultados.find(Boolean);
  assert.equal(chamadas - antes, 1);
  assert.equal(final.estado, 'confirmado');
  assert.equal(final.recibo.repetida, true);
  assert.equal(final.recibo.operacaoId, pendente.comando.operacaoId);
  assert.equal(await enviar(), undefined);
  const primeiroTotal = await financeiroAtual();
  assert.equal(resumir(primeiroTotal.historico).liquido, 28);
  assert.deepEqual(primeiroTotal.historico.slice(1), historico);

  const pendenteCompatibilidade = await incluir(1, entrada);
  const envelope = await aba('fila.exportarCopiaProtegida()');
  const reciboServidor = (await getDocFromServer(doc(espaco, 'operacoes', pendente.comando.operacaoId))).data();
  const registroCatalogo = (await getDocFromServer(caixinha)).data();
  const pacoteEnsaio = {
    schema: 'ensaio-appcar-compatibilidade', uid: titular.uid, espacoId, geracao: 0, origem,
    financeiro: primeiroTotal, catalogo: [registroCatalogo],
    auditoria: [{ ...reciboServidor, confirmadoEm: reciboServidor.confirmadoEm.toJSON() }],
    recibos: [final.recibo], filaCriptografada: envelope,
  };
  const json = JSON.stringify(pacoteEnsaio);
  const copia = JSON.parse(json);
  assert.deepEqual(copia, pacoteEnsaio);
  assert.equal(copia.recibos[0].operacaoId, copia.auditoria[0].id);
  assert.ok(!json.includes(segredo) && !json.includes(titular.token) && !json.includes(pendenteCompatibilidade.comando.operacaoId));
  const conferir = (janela, arquivo) => janela(`fila.conferirCopiaProtegida(${JSON.stringify(arquivo)})`);
  const incompleta = { ...envelope, conteudo: envelope.conteudo.slice(0, -1) };
  await assert.rejects(conferir(aba, incompleta), /Integridade/);
  await assert.rejects(conferir(aba, { ...envelope, schema: 'outra-versao' }), /Versão ou escopo/);
  const semSegredo = await abrir(titular, 0, 'Segredo-incorreto-backup-3K');
  await assert.rejects(conferir(semSegredo, envelope), /segredo local/);
  await assert.rejects(incluir(2, { ...entrada, refreshToken: 'valor-ficticio' }), /Credenciais/);
  const conteudoRecuperado = await conferir(aba, copia.filaCriptografada);
  assert.deepEqual(conteudoRecuperado[0].recibo, copia.recibos[0]);
  assert.deepEqual(conteudoRecuperado[1], pendenteCompatibilidade);
  const reaberta = await abrir();
  assert.equal((await reaberta('fila.listar()'))[1].comando.operacaoId, pendenteCompatibilidade.comando.operacaoId);
  assert.equal((await reaberta('fila.listar()'))[1].estado, 'pendente');
  assert.equal((await enviar()).estado, 'conflito');
  assert.equal(await enviar(), undefined);
  await incluir(2, retirada(100));
  await updateDoc(caixinha, { estado: 'arquivada' });
  assert.match((await enviar()).motivo, /arquivada/);
  await updateDoc(caixinha, { estado: 'ativa' });
  await incluir(2, retirada(201));
  assert.match((await enviar()).motivo, /Saldo insuficiente/);
  await incluir(2, entrada);
  await updateDoc(espaco, { comandosFinanceiros: false });
  assert.equal((await enviar()).estado, 'rejeitado');
  await updateDoc(espaco, { comandosFinanceiros: true });

  const contaTrocada = await abrir(outro, 0, 'Outra-chave-ficticia-unica-3I');
  assert.deepEqual(await contaTrocada('fila.listar()'), []);
  const bloqueada = await abrir(titular, 0, 'Senha-de-fila-errada-3I');
  await assert.rejects(bloqueada('fila.listar()'), /dados locais foram preservados/);
  await incluir(2, entrada);
  await aba(`window.token = ${JSON.stringify(outro.token)}`);
  assert.equal((await enviar()).estado, 'pendente');
  await aba(`window.token = ${JSON.stringify(titular.token)}`);
  await setDoc(doc(db, 'concessoesAdministrativas', espacoId), { uid: titular.uid, espacoId, operacoes: ['backup', 'reiniciar'] });
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${titular.token}` };
  const respostaBackup = await fetch(`${servico.origem}/espacos/${espacoId}/backup`, {
    method: 'POST', headers, body: '{}',
  });
  assert.equal(respostaBackup.status, 200);
  const respostaReinicio = await fetch(`${servico.origem}/espacos/${espacoId}/administracao`, {
    method: 'POST', headers, body: JSON.stringify({
      tipo: 'reiniciar', operacaoId: crypto.randomUUID(), geracao: 0, revisao: 2,
      confirmacao: 'REINICIAR ESPAÇO FICTÍCIO', backup: await respostaBackup.json(),
    }),
  });
  assert.equal(respostaReinicio.status, 200);
  await respostaReinicio.json();
  assert.equal((await enviar()).estado, 'rejeitado');
  assert.deepEqual(await (await abrir(titular, 1))('fila.listar()'), []);
  const guardados = await aba('fila.listar()');
  assert.deepEqual(guardados.map(i => i.estado), ['confirmado', 'conflito', 'rejeitado', 'rejeitado', 'rejeitado', 'rejeitado']);
  assert.equal(await aba('fila.limparConfirmados(Date.now())'), 1);
  assert.equal((await aba('fila.listar()')).length, 5);
  assert.deepEqual((await financeiroAtual()).historico, []);
  const arquivado = (await getDocFromServer(doc(espaco, 'geracoesArquivadas', '0'))).data();
  assert.deepEqual(arquivado.historico, primeiroTotal.historico);
});
