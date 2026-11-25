import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { request } from 'node:http';
import { after, before, beforeEach, test } from 'node:test';
import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from 'firebase/auth';
import { collection, connectFirestoreEmulator, deleteDoc, doc, getDocFromServer, getDocsFromServer, getFirestore, setDoc, terminate, updateDoc } from 'firebase/firestore';
import { iniciarServicoFinanceiroEmulador, projetoFinanceiroEmulador as projeto } from '../src/lib/servicoFinanceiroEmulador.ts';
import { criarTurno, dadosPadrao, resumir } from '../src/lib/gestao.ts';
import { criarAutenticadorFirebase, exigirOperacaoAdministrativa } from '../src/lib/identidadeFinanceiraServidor.ts';
import { abrirBackupFinanceiroProtegido, criarBackupFinanceiro, protegerBackupFinanceiro, verificarBackupFinanceiro } from '../src/lib/backupFinanceiroServidor.ts';

const host = '127.0.0.1';
const porta = 8091;
const espacoId = '00000000-0000-4000-8000-000000000001';
const espacoAlheio = '00000000-0000-4000-8000-000000000002';
const espacoSemPermissao = '00000000-0000-4000-8000-000000000003';
const reservaId = '00000000-0000-4000-8000-000000000004';
const caixinha = `diaria:${reservaId}`;
const senha = 'Senha-ficticia-3H';
const operacoesFinanceiras = ['turno', 'entrada', 'retirada', 'excluir', 'custos-fixos'];
const email = nome => `${nome}@appcar.test`;
const apps = [], bancos = [];
let servico, admin, cliente, usuario, token, tokenAlheio, uidAlheio;
const historico = criarTurno({
  data: '2026-11-03', faturamento: '100', combustivel: '10', litros: '5', kmTrabalhado: '30', kmTotal: '50',
  reserva1: '0', reserva2: '0', reservas: [{ id: reservaId, nome: 'Nome na época', valor: '10' }],
}, [{ id: 'custo', nome: 'Custo', valorMensal: 23 }], 'turno-legado');
const base = {
  ...dadosPadrao(), custosFixos: [{ id: 'custo', nome: 'Custo atual', valorMensal: 46 }],
  reservasDiarias: [{ id: reservaId, nome: 'Nome atual', valor: 0 }], historico: [historico],
  _sync: { generation: 0, revision: 1 },
};
const ref = (db, id, ...caminho) => doc(db, 'espacosFinanceiros', id, ...caminho);
const financeiro = (db = admin, id = espacoId) => ref(db, id, 'dados', 'main');
const catalogo = (id = caixinha) => ref(admin, espacoId, 'caixinhas', encodeURIComponent(id));
const evento = (id, db = admin) => ref(db, espacoId, 'operacoes', id);
const ler = async documento => (await getDocFromServer(documento)).data();
const entrada = (valorCentavos = 250) => ({ tipo: 'entrada', data: '2026-11-03', descricao: 'Entrada fictícia', valorCentavos });
const retirada = (valorCentavos) => ({ ...entrada(valorCentavos), tipo: 'retirada', origem: caixinha });
const comando = (alteracao = entrada(), revisao = 1, geracao = 0) =>
  ({ operacaoId: crypto.randomUUID(), geracao, revisao, alteracao });

async function post(caminho, corpo, credencial) {
  const resposta = await fetch(servico.origem + caminho, {
    method: 'POST', headers: {
      'Content-Type': 'application/json', ...(credencial && { Authorization: `Bearer ${credencial}` }),
    }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(15_000),
  });
  return { status: resposta.status, corpo: await resposta.json() };
}
const enviar = (cmd, credencial = token, id = espacoId) => post(`/espacos/${id}/comandos`, cmd, credencial);

test('consulta autenticada devolve financeiro e catálogo somente ao titular', async () => {
  const consultar = credencial => fetch(`${servico.origem}/espacos/${espacoId}/consulta`, {
    headers: credencial ? { Authorization: `Bearer ${credencial}` } : {},
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal((await consultar()).status, 401);
  assert.equal((await consultar(tokenAlheio)).status, 403);
  const resposta = await consultar(token);
  assert.equal(resposta.status, 200);
  assert.equal(resposta.headers.get('cache-control'), 'no-store');
  const dados = await resposta.json();
  assert.equal(dados.financeiro._sync.revision, 1);
  assert.ok(dados.caixinhas.some(item => item.id === caixinha && item.estado === 'ativa'));
});

async function criarUsuario(nome) {
  const app = initializeApp({ projectId: projeto, apiKey: projeto }, nome);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9097', { disableWarnings: true });
  return { app, usuario: (await createUserWithEmailAndPassword(auth, email(nome), senha)).user };
}

before(async () => {
  servico = await iniciarServicoFinanceiroEmulador();
  const proprietario = await criarUsuario('proprietario');
  const outro = await criarUsuario('outra-conta');
  uidAlheio = outro.usuario.uid;
  usuario = proprietario.usuario;
  const adminApp = initializeApp({ projectId: projeto }, 'fixture-financeira');
  apps.push(adminApp);
  admin = getFirestore(adminApp);
  connectFirestoreEmulator(admin, host, porta, { mockUserToken: 'owner' });
  cliente = getFirestore(proprietario.app);
  connectFirestoreEmulator(cliente, host, porta);
  bancos.push(admin, cliente);
  const autenticado = await post('/sessao', { email: email('proprietario'), senha });
  assert.equal(autenticado.status, 200);
  token = autenticado.corpo.token;
  const autenticadoAlheio = await post('/sessao', { email: email('outra-conta'), senha });
  assert.equal(autenticadoAlheio.status, 200);
  tokenAlheio = autenticadoAlheio.corpo.token;
  await setDoc(ref(admin, espacoAlheio), { proprietarioUid: outro.usuario.uid, comandosFinanceiros: true, operacoesFinanceiras });
  await setDoc(financeiro(admin, espacoAlheio), base);
  await setDoc(ref(admin, espacoSemPermissao), { proprietarioUid: usuario.uid, comandosFinanceiros: false });
  await setDoc(financeiro(admin, espacoSemPermissao), base);
  console.log('ISOLAMENTO VERIFICADO: Auth e Firestore em loopback, projeto demo-appcar-financeiro, dois usuários fictícios.');
});

beforeEach(async () => {
  const registros = await Promise.all(['operacoes', 'administracao', 'geracoesArquivadas']
    .map(grupo => getDocsFromServer(collection(admin, 'espacosFinanceiros', espacoId, grupo))));
  await Promise.all(registros.flatMap(registro => registro.docs.map(item => deleteDoc(item.ref))));
  await deleteDoc(doc(admin, 'concessoesAdministrativas', espacoId));
  await setDoc(ref(admin, espacoId), { proprietarioUid: usuario.uid, comandosFinanceiros: true, operacoesFinanceiras });
  await setDoc(financeiro(), base);
  await Promise.all([caixinha, 'fixo:custo', 'reserva-fixa:reserva1', 'reserva-fixa:reserva2',
    'reserva-fixa:reserva3'].map(id => setDoc(catalogo(id), { id, estado: 'ativa' })));
});

async function conceder(id, operacoes) {
  await setDoc(doc(admin, 'concessoesAdministrativas', id), { uid: usuario.uid, espacoId: id, operacoes });
}

const administrar = (cmd, id = espacoId, credencial = token) => post(`/espacos/${id}/administracao`, cmd, credencial);
const trilhaAdmin = (operacaoId, id = espacoId) => ref(admin, id, 'administracao', operacaoId);
const chavesDoPiloto = () => new Map([[servico.chaveBackupId, servico.chavePublicaBackup]]);
const criarAdmin = (tipo, campos = {}) => ({ operacaoId: crypto.randomUUID(), tipo, ...campos });
async function exportarParaTeste(id = espacoId, credencial = token) {
  const resposta = await post(`/espacos/${id}/backup`, {}, credencial);
  assert.equal(resposta.status, 200);
  return resposta.corpo;
}

test('provisionamento exige concessão, registra o evento e permite somente preparar restauração', async () => {
  const id = crypto.randomUUID();
  const provisionar = criarAdmin('provisionar');
  assert.equal((await administrar(provisionar, id)).status, 403);
  await conceder(id, ['provisionar', 'backup', 'restaurar']);
  assert.equal((await administrar(provisionar, id, tokenAlheio)).status, 403);
  const feito = await administrar(provisionar, id);
  assert.equal(feito.status, 200);
  assert.equal((await administrar(provisionar, id)).corpo.repetida, true);
  assert.equal((await administrar(criarAdmin('provisionar'), id)).status, 409);
  const inicial = await ler(financeiro(admin, id));
  assert.deepEqual(inicial._sync, { generation: 0, revision: 0 });
  assert.equal((await ler(ref(admin, id))).comandosFinanceiros, false);
  const backup = await exportarParaTeste(id);
  const preparo = criarAdmin('restaurar', { geracao: 0, revisao: 0, backup });
  const plano = await administrar(preparo, id);
  assert.equal(plano.status, 200);
  assert.equal(plano.corpo.modo, 'somente-preparo');
  assert.deepEqual(await ler(financeiro(admin, id)), inicial);
  assert.equal((await ler(trilhaAdmin(preparo.operacaoId, id))).autorUid, usuario.uid);
  assert.equal((await administrar(preparo, id)).corpo.repetida, true);
  assert.equal((await administrar(criarAdmin('reiniciar', { geracao: 0, revisao: 0, backup, confirmacao: 'REINICIAR ESPAÇO FICTÍCIO' }), id)).status, 403);
});

test('backup cifrado, manutenção restrita e preparo recusam cópia adulterada, alheia, antiga ou destino ocupado', async () => {
  await updateDoc(ref(admin, espacoId), { concessaoAdministrativa: { uid: usuario.uid, espacoId, operacoes: ['backup'] } });
  const backup = await exportarParaTeste();
  await conceder(espacoId, ['restaurar', 'manter']);
  const chave = randomBytes(32);
  const cifrado = protegerBackupFinanceiro(backup, chave);
  const esperado = { uid: usuario.uid, espacoId, chavesConfiaveis: chavesDoPiloto() };
  assert.ok(!JSON.stringify(cifrado).includes(historico.id));
  assert.throws(() => abrirBackupFinanceiroProtegido(cifrado, randomBytes(32), esperado), /Integridade/);
  assert.throws(() => abrirBackupFinanceiroProtegido({ ...cifrado, conteudo: cifrado.conteudo.slice(2) }, chave, esperado), /Integridade/);
  assert.deepEqual(abrirBackupFinanceiroProtegido(JSON.parse(JSON.stringify(cifrado)), chave, esperado).dados.financeiro, base);
  const preparar = criarAdmin('restaurar', { geracao: 0, revisao: 1, backup });
  assert.equal((await administrar(preparar)).status, 409);
  assert.equal((await administrar({ ...preparar, geracao: 1 })).status, 409);
  assert.equal((await administrar({ ...preparar, backup: { ...backup, dados: { ...backup.dados, uid: 'outro' } } })).status, 422);
  await updateDoc(ref(admin, espacoAlheio), { concessaoAdministrativa: { uid: uidAlheio, espacoId: espacoAlheio, operacoes: ['backup'] } });
  const backupAlheio = await exportarParaTeste(espacoAlheio, tokenAlheio);
  const rejeicao = await administrar({ ...preparar, backup: backupAlheio });
  assert.equal(rejeicao.status, 422);
  assert.match(rejeicao.corpo.erro, /Conta ou espaço/);
  await conceder(espacoAlheio, ['restaurar']);
  assert.equal((await administrar(preparar, espacoAlheio)).status, 403);

  const novo = crypto.randomUUID();
  await conceder(novo, ['provisionar', 'restaurar']);
  assert.equal((await administrar(criarAdmin('provisionar'), novo)).status, 200);
  const tentativa = await administrar({ ...preparar, revisao: 0 }, novo);
  assert.equal(tentativa.status, 422);
  assert.match(tentativa.corpo.erro, /Conta ou espaço/);
  assert.equal(await ler(trilhaAdmin(preparar.operacaoId)), undefined);

  const manter = criarAdmin('manter', { geracao: 0, revisao: 1, backup, motivo: 'Corrigir o nome atual', alteracao: { caixinhaId: caixinha, nome: 'Nome confirmado' } });
  const arquivar = { ...manter, operacaoId: crypto.randomUUID(), alteracao: { caixinhaId: caixinha, estado: 'arquivada' } };
  assert.equal((await administrar(arquivar)).status, 422);
  assert.equal(await ler(trilhaAdmin(arquivar.operacaoId)), undefined);
  assert.equal((await administrar(manter)).status, 200);
  assert.equal((await administrar(manter)).corpo.repetida, true);
  assert.equal((await administrar({ ...manter, alteracao: { nomeEspaco: 'Outro' } })).status, 409);
  assert.equal((await enviar({ ...comando(entrada(), 2), operacaoId: manter.operacaoId })).status, 409);
  assert.equal((await ler(catalogo())).nome, 'Nome confirmado');
  assert.deepEqual((await ler(financeiro())).historico, base.historico);
  assert.deepEqual(resumir((await ler(financeiro())).historico), resumir(base.historico));
  assert.equal((await ler(trilhaAdmin(manter.operacaoId))).mudanca.depois.nome, 'Nome confirmado');
});

test('ciclo administrativo exige motivo e separa arquivamento, reativação e alteração de metadados', async () => {
  await conceder(espacoId, ['backup', 'manter']);
  const id = 'reserva-fixa:reserva2';
  let backup = await exportarParaTeste();
  const arquivar = criarAdmin('manter', {
    geracao: 0, revisao: 1, backup, motivo: 'Encerramento fictício', alteracao: { caixinhaId: id, estado: 'arquivada' },
  });
  assert.equal((await administrar({ ...arquivar, motivo: undefined })).status, 400);
  assert.equal((await administrar({ ...arquivar, motivo: '  ' })).status, 400);
  assert.equal((await administrar({ ...arquivar, alteracao: { ...arquivar.alteracao, nome: 'Outro nome' } })).status, 400);
  assert.equal(await ler(trilhaAdmin(arquivar.operacaoId)), undefined);
  assert.equal((await administrar(arquivar)).status, 200);
  const auditado = await ler(trilhaAdmin(arquivar.operacaoId));
  assert.equal(auditado.motivo, arquivar.motivo);
  assert.equal(auditado.autorUid, usuario.uid);
  assert.ok(auditado.confirmadoEm.toMillis() > 0);
  assert.deepEqual(auditado.mudanca, { antes: { estado: 'ativa' }, depois: { estado: 'arquivada' } });
  const tentarMovimentar = comando({ ...retirada(100), origem: 'reserva2' }, 2);
  assert.match((await enviar(tentarMovimentar)).corpo.erro, /arquivada/);
  backup = await exportarParaTeste();
  const preparar = { geracao: 0, revisao: 2, backup, motivo: 'Revisão fictícia' };
  assert.equal((await administrar(criarAdmin('manter', { ...preparar, alteracao: { caixinhaId: id, nome: 'Outro nome' } }))).status, 409);
  assert.equal((await administrar(criarAdmin('manter', { ...preparar, alteracao: { caixinhaId: id, estado: 'ativa' } }))).status, 200);
  assert.deepEqual((await ler(financeiro())).historico, base.historico);
  assert.deepEqual(resumir((await ler(financeiro())).historico), resumir(base.historico));
});

test('reinício interrompido retoma o recibo, mantém histórico arquivado e rejeita a fila da geração antiga', async () => {
  const confirmado = comando();
  assert.equal((await enviar(confirmado)).status, 200);
  const pendente = comando(entrada(300), 2);
  const antes = await ler(financeiro());
  const eventoAnterior = await ler(evento(confirmado.operacaoId));
  const caixaAnterior = await ler(catalogo());
  await updateDoc(ref(admin, espacoId), { concessaoAdministrativa: { uid: usuario.uid, espacoId, operacoes: ['backup'] } });
  const backup = await exportarParaTeste();
  const cmd = criarAdmin('reiniciar', { geracao: 0, revisao: 2, backup, confirmacao: 'REINICIAR ESPAÇO FICTÍCIO' });
  assert.equal((await administrar(cmd)).status, 403);
  await conceder(espacoId, ['reiniciar']);
  assert.equal((await administrar({ ...cmd, confirmacao: 'sem confirmação' })).status, 400);
  const url = `${servico.origem}/espacos/${espacoId}/administracao`;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const texto = JSON.stringify(cmd);
  await new Promise(resolve => {
    const req = request(url, { method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(texto) } });
    req.on('error', () => {});
    req.once('close', resolve);
    req.write(texto.slice(0, -1), () => req.destroy());
  });
  const parcial = await fetch(url, { method: 'POST', headers, body: texto.slice(0, -1) });
  assert.equal(parcial.status, 400);
  await parcial.text();
  assert.deepEqual(await ler(financeiro()), antes);
  assert.equal(await ler(trilhaAdmin(cmd.operacaoId)), undefined);

  await new Promise((resolve, reject) => {
    const req = request(url, { method: 'POST', headers }, res => {
      res.destroy();
      resolve();
    });
    req.on('error', reject);
    req.end(texto);
  });
  const repetido = await administrar(cmd);
  assert.equal(repetido.status, 200);
  assert.equal(repetido.corpo.repetida, true);
  const atual = await ler(financeiro());
  assert.equal(atual._sync.generation, 1);
  assert.deepEqual(atual.historico, []);
  assert.deepEqual(await ler(ref(admin, espacoId, 'geracoesArquivadas', '0')), antes);
  assert.deepEqual(await ler(evento(confirmado.operacaoId)), eventoAnterior);
  assert.deepEqual(await ler(catalogo()), caixaAnterior);
  assert.equal((await enviar(pendente)).status, 409);
  assert.equal(await ler(evento(pendente.operacaoId)), undefined);
  const antigo = { ...cmd, operacaoId: crypto.randomUUID(), geracao: 1, revisao: 0 };
  assert.equal((await administrar(antigo)).status, 409);
  assert.equal(await ler(trilhaAdmin(antigo.operacaoId)), undefined);
  const seguinte = await exportarParaTeste();
  const recuperado = verificarBackupFinanceiro(seguinte, { uid: usuario.uid, espacoId, chavesConfiaveis: chavesDoPiloto() });
  assert.deepEqual(recuperado.geracoesArquivadas[0].financeiro, antes);
  assert.equal(recuperado.auditoriaAdministrativa[0].id, cmd.operacaoId);
  assert.equal(recuperado.recibos[0].id, confirmado.operacaoId);
});

after(async () => {
  await servico?.encerrar();
  await Promise.all(bancos.map(terminate));
  await Promise.all(apps.map(deleteApp));
});

test('autentica no Auth Emulator e deriva o autor da sessão, rejeitando token inválido e campos extras', async () => {
  const cmd = comando();
  assert.equal((await post('/sessao', { email: email('proprietario'), senha: 'errada' })).status, 401);
  assert.equal((await enviar(cmd, '')).status, 401);
  assert.equal((await enviar(cmd, 'x'.repeat(43))).status, 401);
  assert.equal((await enviar(cmd, await usuario.getIdToken())).status, 401);
  assert.equal((await enviar({ ...cmd, uid: usuario.uid, permissao: true })).status, 400);
  assert.equal((await enviar({ ...cmd, alteracao: { ...cmd.alteracao, liquido: 9900 } })).status, 400);
  assert.equal(await ler(evento(cmd.operacaoId)), undefined);
  const confirmado = await enviar(cmd);
  assert.equal(confirmado.status, 200);
  assert.equal(confirmado.corpo.revisao, 2);
  const auditado = await ler(evento(cmd.operacaoId));
  assert.equal(auditado.autorUid, usuario.uid);
  assert.equal(auditado.id, cmd.operacaoId);
  assert.equal(auditado.espacoId, espacoId);
  assert.equal(auditado.geracao, 0);
  assert.equal(auditado.revisaoAnterior, 1);
  assert.equal(auditado.revisao, 2);
  assert.equal(auditado.lancamentoId, cmd.operacaoId);
  assert.ok(auditado.confirmadoEm.toMillis() > 0);
  const salvo = await ler(financeiro());
  assert.equal(salvo.historico[0].liquido, 2.5);
  assert.deepEqual(salvo.historico.slice(1), base.historico);
});

test('nega proprietário sem permissão e acesso cruzado, preservando os espaços', async () => {
  assert.equal((await enviar(comando(), token, espacoSemPermissao)).status, 403);
  assert.equal((await enviar(comando(), token, espacoAlheio)).status, 403);
  assert.equal((await enviar(comando(), tokenAlheio)).status, 403);
  await updateDoc(ref(admin, espacoId), { operacoesFinanceiras: ['retirada'] });
  const semEscopo = comando();
  assert.equal((await enviar(semEscopo)).status, 403);
  assert.equal(await ler(evento(semEscopo.operacaoId)), undefined);
  for (const id of [espacoId, espacoAlheio, espacoSemPermissao]) assert.deepEqual(await ler(financeiro(admin, id)), base);
});

test('adaptador Firebase exige verificação com revogação e rejeita identidade inválida', async () => {
  const tokenFirebase = await usuario.getIdToken();
  const agora = Math.floor(Date.now() / 1000);
  let revogado = false;
  let identidade = { uid: usuario.uid, sub: usuario.uid, aud: projeto, iss: `https://securetoken.google.com/${projeto}`, exp: agora + 60 };
  const autenticar = criarAutenticadorFirebase({
    async verifyIdToken(valor, conferirRevogacao) {
      assert.equal(conferirRevogacao, true);
      if (valor !== tokenFirebase || revogado) throw new Error('Verificação recusada pela fixture.');
      return identidade;
    },
  }, projeto);
  assert.deepEqual(await autenticar(`Bearer ${tokenFirebase}`), { uid: usuario.uid });
  await assert.rejects(autenticar('Bearer invalido'), /Sessão inválida/);
  identidade = { ...identidade, exp: agora };
  await assert.rejects(autenticar(`Bearer ${tokenFirebase}`), /Sessão inválida/);
  identidade = { ...identidade, exp: agora + 60, aud: 'outro-projeto' };
  await assert.rejects(autenticar(`Bearer ${tokenFirebase}`), /Sessão inválida/);
  identidade = { ...identidade, aud: projeto };
  revogado = true;
  await assert.rejects(autenticar(`Bearer ${tokenFirebase}`), /Sessão inválida/);
  assert.deepEqual(await ler(financeiro()), base);
});

test('administração separa titularidade, concessão, espaço, operação e versão confirmada', () => {
  const dono = usuario.uid;
  const opcoes = {
    uidVerificado: dono, proprietarioUid: dono, espacoId, espacoDaConcessao: espacoId,
    concessao: { uid: dono, operacoes: ['backup', 'provisionar', 'reiniciar', 'restaurar', 'manter'] },
  };
  exigirOperacaoAdministrativa({ ...opcoes, operacao: 'provisionar' });
  const atual = { generation: 0, revision: 1 };
  const dados = { ...opcoes, atual };
  assert.throws(() => exigirOperacaoAdministrativa({ ...dados, operacao: 'provisionar' }), /já foi provisionado/);
  assert.throws(() => exigirOperacaoAdministrativa({ ...dados, operacao: 'backup', uidVerificado: 'parceiro' }), /não autorizada/);
  assert.throws(() => exigirOperacaoAdministrativa({ ...dados, operacao: 'backup', espacoId: espacoAlheio }), /não autorizada/);
  assert.throws(() => exigirOperacaoAdministrativa({ ...dados, operacao: 'backup', concessao: undefined }), /não autorizada/);
  exigirOperacaoAdministrativa({ ...dados, operacao: 'backup' });
  for (const operacao of ['restaurar', 'reiniciar', 'manter']) {
    const confirmacao = { uid: dono, espacoId, operacao, geracao: 0, revisao: 1, backupConferido: true };
    assert.throws(() => exigirOperacaoAdministrativa({ ...dados, operacao }), /confirmação administrativa/i);
    assert.throws(() => exigirOperacaoAdministrativa({ ...dados, operacao, confirmacao: { ...confirmacao, revisao: 0 } }), /desatualizada/);
    exigirOperacaoAdministrativa({ ...dados, operacao, confirmacao });
  }
});

test('backup assinado de dados emulados verifica versão, procedência, adulteração e retomada de leitura', async () => {
  const cmd = comando();
  const resultado = await enviar(cmd);
  assert.equal(resultado.status, 200);
  const financeiroOriginal = await ler(financeiro());
  const auditado = await ler(evento(cmd.operacaoId));
  await updateDoc(catalogo(), { estado: 'arquivada' });
  const dados = {
    uid: usuario.uid, espacoId, financeiro: financeiroOriginal, catalogo: [await ler(catalogo())], auditoria: [auditado],
    recibos: [{ id: cmd.operacaoId, geracao: auditado.geracao, revisao: resultado.corpo.revisao }],
  };
  const rotaBackup = `/espacos/${espacoId}/backup`;
  assert.equal((await post(rotaBackup, {}, token)).status, 403);
  await updateDoc(ref(admin, espacoId), { concessaoAdministrativa: { uid: usuario.uid, espacoId, operacoes: ['backup'] } });
  assert.equal((await post(rotaBackup, {}, tokenAlheio)).status, 403);
  assert.equal((await post(rotaBackup, { uid: usuario.uid }, token)).status, 400);
  const resposta = await post(rotaBackup, {}, token);
  assert.equal(resposta.status, 200);
  const arquivo = resposta.corpo;
  const json = JSON.stringify(arquivo);
  const esperado = { uid: usuario.uid, espacoId, chavesConfiaveis: new Map([[servico.chaveBackupId, servico.chavePublicaBackup]]) };
  assert.throws(() => JSON.parse(json.slice(0, -10)), SyntaxError);
  assert.deepEqual(await ler(financeiro()), financeiroOriginal);
  const copia = JSON.parse(json);
  const conferido = verificarBackupFinanceiro(copia, esperado);
  assert.deepEqual(conferido.financeiro, financeiroOriginal);
  assert.equal(conferido.catalogo.length, 5);
  assert.deepEqual(conferido.catalogo.find(c => c.id === caixinha), dados.catalogo[0]);
  assert.deepEqual(conferido.auditoria, [JSON.parse(JSON.stringify(auditado))]);
  assert.deepEqual(conferido.recibos, dados.recibos);
  assert.throws(() => verificarBackupFinanceiro(copia, { ...esperado, chavesConfiaveis: new Map() }), /Procedência/);
  assert.throws(() => verificarBackupFinanceiro(copia, { ...esperado, espacoId: espacoAlheio }), /Conta ou espaço/);
  assert.throws(() => verificarBackupFinanceiro({ ...copia, manifesto: { ...copia.manifesto, schema: 'futuro' } }, esperado), /Versão/);
  assert.throws(() => verificarBackupFinanceiro({ ...copia, dados: { ...copia.dados, recibos: [] } }, esperado), /Integridade/);
  const { privateKey } = generateKeyPairSync('ed25519');
  assert.throws(() => criarBackupFinanceiro({ ...dados, recibos: [] }, 'chave', privateKey), /incompatíveis/);
  assert.throws(() => criarBackupFinanceiro({ ...dados, auditoria: [{ ...auditado, refreshToken: token }] }, 'chave', privateKey), /credencial/);
  assert.ok(!json.includes(token) && !json.includes(senha));
  assert.equal((await enviar(cmd)).corpo.repetida, true);
  assert.deepEqual(await ler(financeiro()), financeiroOriginal);
});

test('sessão expirada preserva o comando e nova sessão da mesma conta pode confirmá-lo', async t => {
  const cmd = comando();
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 6 * 60_000 });
  try {
    assert.equal((await enviar(cmd)).status, 401);
  } finally {
    t.mock.timers.reset();
  }
  assert.deepEqual(await ler(financeiro()), base);
  assert.equal(await ler(evento(cmd.operacaoId)), undefined);
  const renovada = await post('/sessao', { email: email('proprietario'), senha });
  assert.equal(renovada.status, 200);
  assert.equal((await enviar(cmd, renovada.corpo.token)).status, 200);
  assert.equal((await ler(evento(cmd.operacaoId))).autorUid, usuario.uid);
});

test('UUID idempotente com revisão alterada, proteção contra alteração do conteúdo e geração anterior', async () => {
  const primeira = comando();
  assert.equal((await enviar(primeira)).status, 200);
  assert.equal((await enviar(comando(entrada(400), 2))).status, 200);
  for (const revisao of [1, 3]) {
    assert.deepEqual((await enviar({ ...primeira, revisao })).corpo,
      { operacaoId: primeira.operacaoId, revisao: 2, repetida: true });
  }
  assert.equal((await enviar({ ...primeira, revisao: 3, alteracao: entrada(999) })).status, 409);
  const pendente = comando(entrada(), 3);
  const antes = await ler(financeiro());
  const depois = { ...antes, _sync: { generation: 1, revision: 0 } };
  await setDoc(financeiro(), depois);
  assert.equal((await enviar(pendente)).status, 409);
  assert.equal((await enviar(primeira)).status, 409);
  assert.equal((await enviar({ ...primeira, geracao: 1, revisao: 0 })).status, 409);
  assert.deepEqual(await ler(financeiro()), depois);
  assert.equal(await ler(evento(pendente.operacaoId)), undefined);
});

test('serializa comandos concorrentes e confirma reenvios simultâneos uma vez', async () => {
  const primeiro = comando(), segundo = comando();
  const resultados = await Promise.all([enviar(primeiro), enviar(segundo)]);
  assert.deepEqual(resultados.map(r => r.status).sort(), [200, 409]);
  const perdeu = resultados[0].status === 409 ? primeiro : segundo;
  assert.equal(await ler(evento(perdeu.operacaoId)), undefined);
  const mesmo = comando(entrada(), 2);
  const repetidos = await Promise.all([enviar(mesmo), enviar(mesmo)]);
  assert.deepEqual(repetidos.map(r => r.status), [200, 200]);
  assert.deepEqual(repetidos.map(r => r.corpo.repetida).sort(), [false, true]);
  const saldo = await ler(financeiro());
  assert.equal(saldo._sync.revision, 3);
  assert.equal(saldo.historico.filter(h => h.id === mesmo.operacaoId).length, 1);
});

test('aplica saldo, estado e precisão em centavos, sem recibo para comandos recusados', async () => {
  const insuficiente = comando(retirada(1001));
  const rejeitada = await enviar(insuficiente);
  assert.equal(rejeitada.status, 422);
  assert.match(rejeitada.corpo.erro, /Saldo insuficiente/);
  assert.equal(await ler(evento(insuficiente.operacaoId)), undefined);
  assert.equal((await enviar(comando(retirada(0.5)))).status, 400);
  const movimento = comando(retirada(10));
  assert.equal((await enviar(movimento)).status, 200);
  await updateDoc(catalogo(), { estado: 'arquivada' });
  const arquivada = comando(retirada(1), 2);
  const resultado = await enviar(arquivada);
  assert.equal(resultado.status, 422);
  assert.match(resultado.corpo.erro, /arquivada/);
  assert.deepEqual((await ler(evento(movimento.operacaoId))).caixinhas, [caixinha]);
  assert.equal(await ler(evento(arquivada.operacaoId)), undefined);
  assert.equal((await ler(financeiro()))._sync.revision, 2);
});

test('bloqueia acesso direto do cliente Firebase autenticado ao financeiro e à auditoria privados', async () => {
  const cmd = comando();
  assert.equal((await enviar(cmd)).status, 200);
  const negado = erro => erro.code === 'permission-denied';
  await assert.rejects(updateDoc(financeiro(cliente), { '_sync.revision': 3 }), negado);
  await assert.rejects(updateDoc(evento(cmd.operacaoId, cliente), { revisao: 3 }), negado);
  await assert.rejects(getDocFromServer(financeiro(cliente)), negado);
  assert.equal((await ler(financeiro()))._sync.revision, 2);
  assert.equal((await ler(evento(cmd.operacaoId))).revisao, 2);
});

test('edição deriva os totais e conserva rateio, nome histórico e modelo vigente', async () => {
  const cmd = comando({
    tipo: 'turno', lancamentoId: historico.id, data: '2026-11-03', faturamentoCentavos: 11000,
    combustivelCentavos: 1000, litrosCentesimos: 500, kmTrabalhadoCentesimos: 3000,
    kmTotalCentesimos: 5000, reserva1Centavos: 0, reserva2Centavos: 0,
    reservas: [{ id: reservaId, nome: 'Nome atual', valorCentavos: 1000 }],
  });
  assert.equal((await enviar(cmd)).status, 200);
  const salvo = await ler(financeiro());
  assert.deepEqual(salvo.reservasDiarias, base.reservasDiarias);
  const esperado = { ...historico, faturamentoBruto: 110, liquido: 87.1 };
  assert.deepEqual(salvo.historico, [esperado]);
  assert.deepEqual(resumir(salvo.historico), resumir([esperado]));
  assert.equal((await ler(evento(cmd.operacaoId))).lancamentoId, historico.id);
});

test('alteração de custos e exclusão verificam o catálogo e gravam auditoria', async () => {
  const alterar = { tipo: 'custos-fixos', itens: [{ id: 'custo', nome: 'Novo custo', valorMensalCentavos: 6900 }] };
  const cmdCustos = comando(alterar);
  await updateDoc(catalogo('fixo:custo'), { estado: 'arquivada' });
  assert.equal((await enviar(cmdCustos)).status, 422);
  await updateDoc(catalogo('fixo:custo'), { estado: 'ativa' });
  assert.equal((await enviar(cmdCustos)).status, 200);
  assert.deepEqual((await ler(financeiro())).historico, base.historico);
  assert.equal((await ler(financeiro())).custosFixos[0].valorMensal, 69);
  assert.deepEqual((await ler(evento(cmdCustos.operacaoId))).caixinhas, ['fixo:custo']);

  const cmdExcluir = comando({ tipo: 'excluir', lancamentoId: historico.id }, 2);
  await updateDoc(catalogo(), { estado: 'arquivada' });
  assert.equal((await enviar(cmdExcluir)).status, 422);
  assert.equal(await ler(evento(cmdExcluir.operacaoId)), undefined);
  await updateDoc(catalogo(), { estado: 'ativa' });
  assert.equal((await enviar(cmdExcluir)).status, 200);
  assert.deepEqual((await ler(financeiro())).historico, []);
  assert.equal((await ler(evento(cmdExcluir.operacaoId))).lancamentoId, historico.id);
});
