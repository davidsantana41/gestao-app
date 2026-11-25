import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { assertFails, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, disableNetwork, doc, enableNetwork, getDocFromServer, getDocsFromServer, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { consultarArquivadasEmulador, enderecoCiclo, executarCicloEmulador, executarComandoFinanceiroEmulador, executarFinanceiroEmulador, projetoCiclo } from '../src/lib/cicloCaixinhasEmulador.ts';
import { prepararRestauracaoCaixinhas } from '../src/lib/restauracaoCaixinhas.ts';
import { dadosPadrao, datasTrabalhoNoMes, resumir } from '../src/lib/gestao.ts';
import { clearedFinancial, conditionalWrite, resetTransaction } from '../src/lib/syncSession.ts';
import { preverAdocaoLegada } from '../src/lib/compatibilidadeFinanceira.ts';
import { saldoVerificavelEmCentavos } from '../src/lib/integridadeCaixinhas.ts';
import { reaisParaCentavos } from '../src/lib/centavosFinanceiros.ts';

if (process.env.FIRESTORE_EMULATOR_HOST !== enderecoCiclo
    || process.env.FIREBASE_EMULATOR_HUB !== '127.0.0.1:4413') {
  throw new Error('Execute somente no Emulator Suite dedicado ao ciclo.');
}

const uid = 'ficticio-proprietario';
const parceiro = 'ficticio-parceiro';
const outro = 'ficticio-outra-conta';
const projeto = projetoCiclo;
const catalogo = 'caixinhasCatalogo';
const auditoria = 'caixinhasAuditoria';
const conciliacao = 'caixinhasConciliacao';
const caixinhaZero = 'diaria:00000000-0000-4000-8000-000000000001';
const caixinhaPositiva = 'diaria:00000000-0000-4000-8000-000000000002';
const caixinhaNegativa = 'diaria:00000000-0000-4000-8000-000000000003';
const path = (db, grupo, id, dono = uid) => doc(db, 'users', dono, grupo, id);
const financeiro = (db, dono) => path(db, 'appData', 'main', dono);
const leitura = async ref => (await getDocFromServer(ref)).data();
const eventos = db => getDocsFromServer(collection(db, 'users', uid, auditoria));
const token = { firebase: { sign_in_provider: 'password' } };
let env, operador, concorrente, proprietario, leitor, estranho, operadorFinanceiro, financeiroConcorrente;
const base = {
  ...dadosPadrao(), custosFixos: [], _sync: { generation: 0, revision: 1 },
  historico: [{
    id: 'movimento-ficticio', tipo: 'turno', data: '13/11/2026', faturamentoBruto: 100, totalDespesas: 7,
    liquido: 93, combustivel: 0, kmTrabalhado: 0, litros: 0,
    reservasDiariasDia: [
      { id: caixinhaPositiva.slice(7), nome: 'Nome na época', valor: 7 },
      { id: caixinhaNegativa.slice(7), nome: 'Reserva negativa', valor: 0 },
    ],
    saidas: [{ id: 'saida-ficticia', nome: 'Retirada fictícia', origem: caixinhaNegativa, valor: 2 }],
  }],
};
const comando = (acao = 'criar', caixinhaId = caixinhaZero, versao = 0, extra = {}) =>
  ({ id: crypto.randomUUID(), acao, caixinhaId, versao, geracao: 0, revisaoFinanceira: 1,
    ...(acao === 'criar' ? { nome: 'Reserva', finalidade: 'Propósito fictício' } : { motivo: 'Motivo fictício' }), ...extra });
const executar = (cmd, db = operador) => executarCicloEmulador(db, uid, cmd);

before(async () => {
  const hub = await fetch('http://127.0.0.1:4413/emulators', { redirect: 'error' });
  assert.equal(hub.ok, true);
  const info = await hub.json();
  assert.equal(info.firestore.host, '127.0.0.1');
  assert.equal(info.firestore.port, 8089);
  env = await initializeTestEnvironment({ projectId: projeto, firestore: {
    host: '127.0.0.1', port: 8089, rules: await readFile(new URL('../firestore.ciclo-emulator.rules', import.meta.url), 'utf8'),
  } });
  operador = env.authenticatedContext(uid, { ...token, cicloWorker: true }).firestore();
  concorrente = env.authenticatedContext(uid, { ...token, cicloWorker: true }).firestore();
  proprietario = env.authenticatedContext(uid, token).firestore();
  leitor = env.authenticatedContext(parceiro, token).firestore();
  estranho = env.authenticatedContext(outro, { ...token, cicloWorker: true }).firestore();
  operadorFinanceiro = env.authenticatedContext(uid, { ...token, cicloFinanceWorker: true }).firestore();
  financeiroConcorrente = env.authenticatedContext(uid, { ...token, cicloFinanceWorker: true }).firestore();
  for (const db of [operador, concorrente, proprietario, leitor, estranho, operadorFinanceiro, financeiroConcorrente]) {
    assert.equal(db.app.options.projectId, projeto);
    const { settings } = doc(db, 'users', uid).firestore.toJSON();
    assert.equal(settings.host, enderecoCiclo);
    assert.equal(settings.ssl, false);
  }
  console.log('ISOLAMENTO VERIFICADO ANTES DE GRAVAR: hub 127.0.0.1:4413, Firestore 127.0.0.1:8089, projeto demo-appcar-ciclo, sete clientes fictícios em loopback.');
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async contexto => {
    const db = contexto.firestore();
    const lote = writeBatch(db);
    lote.set(financeiro(db), base);
    lote.set(financeiro(db, outro), base);
    lote.set(path(db, 'caixinhasControle', 'piloto'), { ativo: true });
    lote.set(doc(db, 'shareInvites', uid), { ownerUid: uid, partnerUid: parceiro, status: 'active' });
    await lote.commit();
  });
});
after(async () => { await env?.cleanup(); });

const comandoFinanceiro = (alteracao, revisao = 1) =>
  ({ operacaoId: crypto.randomUUID(), geracao: 0, revisao, alteracao });
const turnoFinanceiro = {
  tipo: 'turno', data: '2026-11-22',
  faturamentoCentavos: 10000, combustivelCentavos: 1500, litrosCentesimos: 250,
  kmTrabalhadoCentesimos: 5000, kmTotalCentesimos: 10000,
  reserva1Centavos: 100, reserva2Centavos: 200,
  reservas: [{ id: caixinhaZero.slice(7), nome: 'Reserva fictícia', valorCentavos: 300 }],
};
const enviarFinanceiro = (cmd, db = operadorFinanceiro) => executarComandoFinanceiroEmulador(db, uid, cmd);
const servidorIndisponivel = erro =>
  erro.code === 'unavailable' || erro.code === 'deadline-exceeded' || /offline/i.test(erro.message);

test('reenvio manual preserva UUID e rejeita comando pendente de geração anterior', async () => {
  const entrada = { tipo: 'entrada', data: '2026-11-22', descricao: 'Entrada fictícia', valorCentavos: 127 };
  const original = comandoFinanceiro(entrada);
  const pendente = comandoFinanceiro(entrada, 2);
  const reenviar = JSON.parse(JSON.stringify(original));
  await disableNetwork(financeiroConcorrente);
  try {
    await assert.rejects(enviarFinanceiro(reenviar, financeiroConcorrente), servidorIndisponivel);
    assert.deepEqual(await leitura(financeiro(proprietario)), base);
  } finally {
    await enableNetwork(financeiroConcorrente);
  }
  assert.equal((await enviarFinanceiro(reenviar, financeiroConcorrente)).repetida, false);
  assert.equal((await enviarFinanceiro(original)).repetida, true);
  const antes = await leitura(financeiro(proprietario));
  assert.equal(antes.historico.filter(h => h.id === original.operacaoId).length, 1);
  assert.deepEqual(antes.historico.slice(1), base.historico);
  const reset = clearedFinancial(antes, { generation: 1, revision: 0, resetId: crypto.randomUUID(), startedOn: '2026-11-22' });
  await setDoc(financeiro(operador), reset);
  await assert.rejects(enviarFinanceiro(pendente), /Conflito/);
  assert.equal((await enviarFinanceiro(original)).repetida, true);
  assert.equal(await leitura(path(proprietario, 'caixinhasRecibos', 'g0-r3')), undefined);
  assert.deepEqual(await leitura(financeiro(proprietario)), reset);
});

test('arquivamento disputa com turno validado e seu modelo na mesma revisão', async () => {
  await executar(comando());
  const cmd = comandoFinanceiro(turnoFinanceiro);
  const [arquivo, turno] = await Promise.allSettled([
    executar(comando('arquivar', caixinhaZero, 1)), enviarFinanceiro(cmd, financeiroConcorrente),
  ]);
  assert.notEqual(arquivo.status, turno.status);
  const atual = await leitura(financeiro(proprietario));
  if (turno.status === 'fulfilled') {
    assert.equal(atual.historico[0].id, cmd.operacaoId);
    assert.deepEqual(atual.historico.slice(1), base.historico);
    assert.deepEqual(atual.reservasDiarias, [{ id: caixinhaZero.slice(7), nome: 'Reserva fictícia', valor: 0 }]);
    assert.equal(saldoVerificavelEmCentavos(atual, caixinhaZero), 300);
  } else {
    assert.deepEqual(atual, base);
    assert.equal(await leitura(path(proprietario, 'caixinhasRecibos', 'g0-r2')), undefined);
  }
});

test('centavos inteiros são exigidos nas novas entradas e o cálculo interno preserva o passado', async () => {
  const custos = comandoFinanceiro({ tipo: 'custos-fixos', itens: [{ id: 'custo-ficticio', nome: 'Custo', valorMensalCentavos: 100 }] });
  await enviarFinanceiro(custos);
  const semCaixinha = { ...turnoFinanceiro, data: '2026-11-03', kmTotalCentesimos: 5025, reservas: [] };
  for (const alteracao of [
    { ...semCaixinha, faturamentoCentavos: 10000.5 },
    { ...semCaixinha, reservas: [{ ...turnoFinanceiro.reservas[0], valorCentavos: 300.01 }] },
    { ...custos.alteracao, itens: [{ ...custos.alteracao.itens[0], valorMensalCentavos: 100.1 }] },
  ]) await assert.rejects(enviarFinanceiro(comandoFinanceiro(alteracao, 2)), /inválido/);
  await enviarFinanceiro(comandoFinanceiro(semCaixinha, 2));
  const { historico } = await leitura(financeiro(proprietario));
  const [novo, ...antigos] = historico;
  assert.equal(novo.reservaAcidente, 1.91);
  assert.equal(novo.custosFixosDia, 0.05);
  assert.equal(novo.totalDespesas, 19.96);
  assert.deepEqual(antigos, base.historico);
  assert.deepEqual(resumir(antigos), resumir(base.historico));
});

test('comando de turno deriva os totais, atualiza o modelo e preserva o rateio na edição', async () => {
  const custos = comandoFinanceiro({ tipo: 'custos-fixos', itens: [{ id: 'custo-ficticio', nome: 'Custo', valorMensalCentavos: 2600 }] });
  await enviarFinanceiro(custos);
  const novo = comandoFinanceiro({ ...turnoFinanceiro, data: '2026-11-03' }, 2);
  const recibo = await enviarFinanceiro(novo);
  assert.deepEqual(await enviarFinanceiro(novo), { ...recibo, repetida: true });
  const salvo = await leitura(financeiro(proprietario));
  const [item] = salvo.historico;
  assert.equal(item.id, novo.operacaoId);
  assert.equal(item.liquido, Math.round((75.2 - item.custosFixosDia) * 100) / 100);
  assert.deepEqual(salvo.reservasDiarias, [{ id: caixinhaZero.slice(7), nome: 'Reserva fictícia', valor: 0 }]);
  await enviarFinanceiro(comandoFinanceiro({
    ...turnoFinanceiro, lancamentoId: item.id, data: '2026-12-01', faturamentoCentavos: 12000,
    reservas: [{ ...turnoFinanceiro.reservas[0], nome: 'Nome atual' }],
  }, 3));
  const editado = await leitura(financeiro(proprietario));
  assert.equal(editado.historico[0].id, item.id);
  assert.deepEqual(editado.historico[0].detalheCustosFixosDia, item.detalheCustosFixosDia);
  assert.equal(editado.historico[0].reservasDiariasDia[0].nome, 'Reserva fictícia');
  assert.deepEqual(editado.historico.slice(1), base.historico);
  await enviarFinanceiro(comandoFinanceiro({ tipo: 'excluir', lancamentoId: item.id }, 4));
  assert.deepEqual((await leitura(financeiro(proprietario))).historico, base.historico);
});

test('comandos inválidos, obsoletos e sem papel de operador não criam recibos', async () => {
  const entrada = { tipo: 'entrada', data: '2026-11-22', descricao: 'Entrada fictícia', valorCentavos: 505 };
  for (const invalida of [
    { ...entrada, liquido: 9000 },
    { ...entrada, data: '2026-02-30' },
    { ...entrada, valorCentavos: 5.5 },
    { ...turnoFinanceiro, reservas: [...turnoFinanceiro.reservas, ...turnoFinanceiro.reservas] },
  ]) await assert.rejects(enviarFinanceiro(comandoFinanceiro(invalida)), /inválido/);
  const cmd = comandoFinanceiro(entrada);
  await assert.rejects(enviarFinanceiro(cmd, proprietario));
  await assert.rejects(enviarFinanceiro(cmd, estranho));
  await assert.rejects(enviarFinanceiro({ ...cmd, geracao: 1 }), /Conflito/);
  assert.deepEqual(await leitura(financeiro(proprietario)), base);
  assert.equal(await leitura(path(proprietario, 'caixinhasRecibos', 'g0-r2')), undefined);
  await enviarFinanceiro(cmd);
  await assert.rejects(enviarFinanceiro({ ...cmd, alteracao: { ...entrada, valorCentavos: 999 } }), /Conflito/);
  const salvo = await leitura(financeiro(proprietario));
  assert.equal(salvo.historico[0].liquido, 5.05);
  assert.equal(salvo._sync.revision, 2);
});

test('comando validado respeita saldo e estado da caixinha', async () => {
  await executar(comando('criar', caixinhaPositiva));
  const retirada = { tipo: 'retirada', data: '2026-11-22', origem: caixinhaPositiva, descricao: 'Retirada fictícia', valorCentavos: 701 };
  await assert.rejects(enviarFinanceiro(comandoFinanceiro(retirada)), /Saldo insuficiente/);
  await enviarFinanceiro(comandoFinanceiro({ ...retirada, valorCentavos: 700 }));
  const salvo = await leitura(financeiro(proprietario));
  assert.equal(salvo.historico[0].liquido, 0);
  await executar(comando('arquivar', caixinhaPositiva, 1, { revisaoFinanceira: 2 }));
  await assert.rejects(enviarFinanceiro(comandoFinanceiro({
    ...turnoFinanceiro, reservas: [{ ...turnoFinanceiro.reservas[0], id: caixinhaPositiva.slice(7) }],
  }, 2)), /arquivada/);
  assert.deepEqual(await leitura(financeiro(proprietario)), salvo);
});

test('cria homônimas com IDs distintos, rejeita colisão e mantém evento e versão atômicos', async () => {
  const criar = comando();
  await executar(criar);
  await executar(comando('criar', caixinhaPositiva));
  await assert.rejects(executar(comando()), /Conflito/);
  const primeira = await leitura(path(proprietario, catalogo, caixinhaZero));
  const segunda = await leitura(path(proprietario, catalogo, caixinhaPositiva));
  assert.equal(primeira.nome, segunda.nome);
  assert.notEqual(primeira.id, segunda.id);
  assert.ok(primeira.criadoEm instanceof Timestamp);
  const evento = await leitura(path(proprietario, auditoria, criar.id));
  assert.equal(evento.autorUid, uid);
  assert.equal(evento.depois.finalidade, 'Propósito fictício');
  assert.ok(evento.confirmadoEm.isEqual(primeira.criadoEm));
  assert.equal((await eventos(proprietario)).size, 2);
});

test('renomeações simultâneas exigem revisão e preservam dados financeiros', async () => {
  await executar(comando());
  const alteracoes = await Promise.allSettled([
    executar(comando('renomear', caixinhaZero, 1, { nome: 'Nome A' })),
    executar(comando('renomear', caixinhaZero, 1, { nome: 'Nome B' }), concorrente),
  ]);
  assert.equal(alteracoes.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(alteracoes.find(r => r.status === 'rejected').reason.message, /Conflito/);
  const registros = (await eventos(proprietario)).docs.map(e => e.data());
  const renomeada = registros.find(e => e.acao === 'renomear');
  assert.equal(renomeada.antes.nome, 'Reserva');
  assert.ok(['Nome A', 'Nome B'].includes(renomeada.depois.nome));
  assert.deepEqual(await leitura(financeiro(proprietario)), base);
});

test('arquiva somente saldo zero lido na transação e reativação concorrente exige versão atual', async () => {
  for (const id of [caixinhaZero, caixinhaPositiva, caixinhaNegativa]) await executar(comando('criar', id));
  const confirmado = await leitura(financeiro(proprietario));
  assert.equal(saldoVerificavelEmCentavos(confirmado, caixinhaPositiva), 700);
  assert.equal(saldoVerificavelEmCentavos(confirmado, caixinhaNegativa), -200);
  await assert.rejects(executar(comando('arquivar', caixinhaPositiva, 1)), /transferência/);
  await assert.rejects(executar(comando('arquivar', caixinhaNegativa, 1)), /negativo/);
  await assert.rejects(executar(comando('arquivar', caixinhaZero, 1, { motivo: ' ' })), /motivo/);
  const [a, b] = await Promise.allSettled([
    executar(comando('arquivar', caixinhaZero, 1)),
    executar(comando('reativar', caixinhaZero, 1), concorrente),
  ]);
  assert.equal(a.status, 'fulfilled');
  assert.equal(b.status, 'rejected');
  assert.deepEqual((await consultarArquivadasEmulador(proprietario, uid)).map(c => c.id), [caixinhaZero]);
  await executar(comando('reativar', caixinhaZero, 2));
  assert.deepEqual(await consultarArquivadasEmulador(proprietario, uid), []);
  assert.deepEqual(resumir((await leitura(financeiro(proprietario))).historico), resumir(base.historico));
});

test('repetição após perda da resposta não duplica eventos e rejeita reutilização divergente', async () => {
  const acao = comando();
  await assert.rejects((async () => { await executar(acao); throw new Error('Resposta perdida'); })(), /Resposta perdida/);
  assert.equal((await executar(acao, concorrente)).repetida, true);
  await assert.rejects(executar({ ...acao, nome: 'Comando diferente' }), /já utilizado/);
  const duplicada = comando('renomear', caixinhaZero, 1, { nome: 'Mesmo comando' });
  const resultados = await Promise.all([executar(duplicada), executar(duplicada, concorrente)]);
  assert.equal(resultados.filter(r => r.repetida).length, 1);
  assert.equal((await eventos(proprietario)).size, 2);
});

test('regras bloqueiam escritas diretas, terceiros, parceiro, alterações de eventos e confirmação de vínculos', async () => {
  const criar = comando();
  const caixinha = path(operador, catalogo, caixinhaZero);
  const evento = path(operador, auditoria, criar.id);
  const novo = { id: caixinhaZero, proprietarioUid: uid, nome: 'Direto', finalidade: '', estado: 'ativa',
    criadoEm: serverTimestamp(), atualizadoEm: serverTimestamp(), versao: 1, operacaoId: criar.id };
  await assertFails(setDoc(caixinha, novo));
  await assertFails(setDoc(evento, { id: criar.id }));
  await assertFails(setDoc(path(proprietario, catalogo, caixinhaZero), novo));
  await assertFails(setDoc(path(estranho, catalogo, caixinhaZero), novo));
  await assertFails(setDoc(path(leitor, catalogo, caixinhaZero), novo));
  await assertFails(setDoc(path(operador, conciliacao, criar.id), { caixinhaId: caixinhaZero }));
  const auditoriaCriacao = { id: criar.id, caixinhaId: caixinhaZero, acao: 'criar', autorUid: uid,
    confirmadoEm: serverTimestamp(), geracao: 0, revisaoFinanceira: 1, versaoAnterior: 0, versaoNova: 1,
    antes: null, depois: { nome: novo.nome, finalidade: novo.finalidade, estado: novo.estado },
    motivo: null, saldoVerificado: null };
  const loteDivergente = writeBatch(operador);
  loteDivergente.set(caixinha, novo);
  loteDivergente.set(path(operador, catalogo, caixinhaPositiva), { ...novo, id: caixinhaPositiva });
  loteDivergente.set(evento, auditoriaCriacao);
  await assertFails(loteDivergente.commit());
  assert.equal(await leitura(caixinha), undefined);
  assert.equal(await leitura(evento), undefined);
  const loteInvalido = writeBatch(operador);
  loteInvalido.set(caixinha, { ...novo, extra: 'campo inválido' });
  loteInvalido.set(evento, { ...auditoriaCriacao, autorUid: parceiro });
  await assertFails(loteInvalido.commit());
  await executar(criar);
  assert.ok(await leitura(financeiro(leitor)));
  await assertFails(getDocFromServer(path(leitor, catalogo, caixinhaZero)));
  await assertFails(getDocFromServer(path(leitor, auditoria, criar.id)));
  await assertFails(getDocFromServer(path(estranho, auditoria, criar.id)));
  await assertFails(updateDoc(evento, { motivo: 'Editado' }));
  await assertFails(deleteDoc(evento));
  await assertFails(deleteDoc(caixinha));
  assert.equal((await eventos(proprietario)).size, 1);
});

test('bloqueia cliente legado no piloto e preserva a compatibilidade fora dele', async () => {
  await assertFails(setDoc(financeiro(proprietario), { ...base, _sync: { generation: 0, revision: 2 }, lembrete: 'Antigo' }));
  await assertFails(setDoc(financeiro(proprietario), { ...base, caixinhas: [] }));
  assert.deepEqual(await leitura(financeiro(proprietario)), base);
  const fora = financeiro(estranho, outro);
  await updateDoc(fora, { lembrete: 'Compatível', '_sync.revision': 2 });
  assert.equal((await leitura(fora)).lembrete, 'Compatível');
});

test('aba aberta antes do marcador perde escrita e reset; parceiro mantém somente a leitura até revogação', async () => {
  await env.withSecurityRulesDisabled(ctx => deleteDoc(path(ctx.firestore(), 'caixinhasControle', 'piloto')));
  const versao = await conditionalWrite(proprietario, uid, base, { ...base, lembrete: 'Antes do corte' });
  const rascunho = { ...versao, historico: [...versao.historico, { ...versao.historico[0], id: 'pendente-legado' }] };
  await env.withSecurityRulesDisabled(ctx => setDoc(path(ctx.firestore(), 'caixinhasControle', 'piloto'), { ativo: true }));
  await assertFails(conditionalWrite(proprietario, uid, versao, rascunho));
  await assertFails(resetTransaction(proprietario, uid, {
    uid, id: crypto.randomUUID(), expected: versao, generation: 1, startedOn: '2026-11-22',
  }));
  assert.deepEqual(await leitura(financeiro(leitor)), versao);
  await assertFails(conditionalWrite(leitor, uid, versao, rascunho));
  await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), 'shareInvites', uid), { status: 'revoked' }));
  await assertFails(getDocFromServer(financeiro(leitor)));
  assert.deepEqual(await leitura(financeiro(proprietario)), versao);
});

test('prévia dos três JSONs correntes conserva versões e cópias e classifica colisões antes da adoção', async () => {
  const remoto = await leitura(financeiro(proprietario));
  const local = {
    ...remoto, reservasDiarias: [
      { id: caixinhaPositiva.slice(7), nome: 'Homônima', valor: 0 },
      { id: caixinhaZero.slice(7), nome: 'Homônima', valor: 0 },
      { id: '', nome: 'Sem ID', valor: 0 },
    ],
  };
  const copias = { '-sync-ficticio': { format: 2, uid, pending: true, data: local, base: remoto, known: true } };
  const privacidade = {
    exportadoEm: '2026-11-22T10:00:00Z',
    conta: { identificador: uid, email: 'ficticio@appcar.test', emailConfirmado: true, criadaEm: null, ultimoAcessoEm: null },
    dadosEmUso: local, ultimaVersaoNuvemCarregada: remoto, copiasNesteNavegador: copias, observacao: 'Cópia fictícia',
  };
  const reinicio = {
    schema: 'appcar-reset-backup-v1', uid, createdAt: '2026-11-22T10:00:00Z', startedOn: '2026-11-22',
    remote: remoto, local, base: remoto, pending: true, conflict: true, localCopies: copias,
  };
  const existente = { id: caixinhaPositiva, familia: 'diaria', idOriginal: caixinhaPositiva.slice(7) };
  const existenteIncompativel = { id: caixinhaZero, familia: 'fixo', idOriginal: 'outro-id' };
  const catalogoAtual = [existente, existenteIncompativel];
  const casos = [
    [local, 'principal', ['principal']],
    [privacidade, 'principal', ['principal', 'nuvem-carregada']],
    [reinicio, 'local-antes-do-reinicio', ['principal', 'local-antes-do-reinicio', 'base-antes-do-reinicio']],
  ];
  for (const [arquivo, fonte, disponiveis] of casos) {
    const json = JSON.parse(JSON.stringify(arquivo));
    const plano = preverAdocaoLegada(json, uid, catalogoAtual, fonte);
    assert.deepEqual(plano.disponiveis, disponiveis);
    assert.deepEqual(plano.arquivo, json);
    assert.equal(plano.identidades.filter(c => c.id === caixinhaPositiva).length, 1);
    assert.equal(plano.identidades.find(c => c.id === caixinhaPositiva).acao, 'reutilizar');
    assert.equal(plano.identidades.find(c => c.id === caixinhaZero).acao, 'revisar-colisao');
    assert.ok(plano.identidades.find(c => c.id === caixinhaPositiva).evidencias.some(e => e.nome === 'Nome na época'));
    assert.ok(plano.pendencias.some(p => p.motivo === 'sem-id'));
    assert.deepEqual(plano.totais, { faturamento: 100, despesas: 7, liquido: 93 });
  }
  const duplicado = preverAdocaoLegada(local, uid, [existente, existente]);
  assert.equal(duplicado.identidades.find(c => c.id === caixinhaPositiva).acao, 'revisar-colisao');
  const alias = preverAdocaoLegada(local, uid, [{ ...existente, id: 'diaria:alias-legado' }]);
  assert.equal(alias.identidades.find(c => c.id === caixinhaPositiva).acao, 'revisar-colisao');
  assert.throws(() => preverAdocaoLegada(privacidade, outro, []), /outro proprietário/);
  assert.equal(preverAdocaoLegada(privacidade, uid, [], 'nuvem-carregada').identidades.some(c => c.id === caixinhaZero), false);
  const semRemoto = { ...reinicio, remote: null, base: null };
  assert.throws(() => preverAdocaoLegada(semRemoto, uid, []), /Versão solicitada indisponível/);
  assert.deepEqual(preverAdocaoLegada(semRemoto, uid, [], 'local-antes-do-reinicio').disponiveis, ['local-antes-do-reinicio']);
  assert.deepEqual(await leitura(financeiro(proprietario)), remoto);
});

test('reset fictício conserva arquivo e auditoria; restauração isolada deduplica e não repõe a geração antiga', async () => {
  await executar(comando());
  await executar(comando('arquivar', caixinhaZero, 1));
  const antes = (await eventos(proprietario)).docs.map(e => e.data());
  const reset = clearedFinancial(base, { generation: 1, revision: 0, resetId: crypto.randomUUID(), startedOn: '2026-11-21' });
  await setDoc(financeiro(operador), reset);
  await assert.rejects(executar(comando('reativar', caixinhaZero, 2)), /Conflito de versão/);
  assert.equal((await consultarArquivadasEmulador(proprietario, uid))[0].id, caixinhaZero);
  assert.deepEqual((await eventos(proprietario)).docs.map(e => e.data()), antes);
  const backup = JSON.parse(JSON.stringify({
    schema: 'appcar-ciclo-v1', uid, financeiro: await leitura(financeiro(proprietario)),
    catalogo: [await leitura(path(proprietario, catalogo, caixinhaZero))],
    auditoria: [...antes, ...antes], recibos: [],
  }));
  const plano = prepararRestauracaoCaixinhas(backup, uid);
  // Exercício de restauração de uma cópia em branco do mesmo proprietário, somente na fixture.
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async contexto => {
    const db = contexto.firestore();
    const lote = writeBatch(db);
    assert.equal(plano.financeiro._sync.generation, 1);
    lote.set(financeiro(db), plano.financeiro);
    lote.set(path(db, 'caixinhasControle', 'piloto'), { ativo: true });
    const caixinha = plano.catalogo[0];
    lote.set(path(db, catalogo, caixinha.id), {
      ...caixinha, criadoEm: Timestamp.fromJSON(caixinha.criadoEm),
      atualizadoEm: Timestamp.fromJSON(caixinha.atualizadoEm),
    });
    for (const evento of plano.auditoria) {
      lote.set(path(db, auditoria, evento.id), { ...evento, confirmadoEm: Timestamp.fromJSON(evento.confirmadoEm) });
    }
    await lote.commit();
  });
  assert.deepEqual((await eventos(proprietario)).docs.map(e => e.data()), antes);
  assert.deepEqual((await leitura(financeiro(proprietario))).historico, []);
  assert.equal((await consultarArquivadasEmulador(proprietario, uid))[0].estado, 'arquivada');
  await executar(comando('reativar', caixinhaZero, 2, { geracao: 1, revisaoFinanceira: 0 }));
  assert.deepEqual((await eventos(proprietario)).docs.map(e => e.data().geracao).sort(), [0, 0, 1]);
});

const lancamento = (id, campos = {}) => ({
  ...base.historico[0], id, data: '01/01/2025', faturamentoBruto: 0, totalDespesas: 0,
  liquido: 0, reservasDiariasDia: [], saidas: [], ...campos,
});
const aporte = (id, valor) => lancamento(id, {
  faturamentoBruto: valor, totalDespesas: valor,
  reservasDiariasDia: [{ id: caixinhaZero.slice(7), nome: 'Nome registrado', valor }],
});
const retiradaDoZero = (id, valor) => lancamento(id, {
  tipo: 'avulso_saida', saidas: [{ id: 'saida-' + id, nome: 'Retirada', origem: caixinhaZero, valor }],
});
const escrever = (revisao, alteracao, db = operadorFinanceiro) => executarFinanceiroEmulador(db, uid, 0, revisao, alteracao);

test('R$ 0,10 + R$ 0,20 − R$ 0,30 resulta em zero e permite arquivamento', async () => {
  await executar(comando());
  await escrever(1, { tipo: 'incluir', item: aporte('credito-10', 0.10) });
  await escrever(2, { tipo: 'incluir', item: aporte('credito-20', 0.20) });
  await escrever(3, { tipo: 'incluir', item: retiradaDoZero('retirada-30', 0.30) });
  const antes = await leitura(financeiro(proprietario));
  assert.equal(saldoVerificavelEmCentavos(antes, caixinhaZero), 0);
  await executar(comando('arquivar', caixinhaZero, 1, { revisaoFinanceira: 4 }));
  assert.equal((await consultarArquivadasEmulador(proprietario, uid))[0].id, caixinhaZero);
  assert.deepEqual(await leitura(financeiro(proprietario)), antes);
});

test('histórico fracionário permanece pendente mesmo quando as frações se cancelam', async () => {
  const historico = [aporte('credito-fracionario', 0.005), retiradaDoZero('retirada-fracionaria', 0.005), ...base.historico];
  await assert.rejects(escrever(1, { tipo: 'incluir', item: historico[0] }), /fracionário/);
  const legado = { ...base, historico };
  await env.withSecurityRulesDisabled(async contexto => setDoc(financeiro(contexto.firestore()), legado));
  await executar(comando());
  await assert.rejects(executar(comando('arquivar', caixinhaZero, 1)), /fracionário.*Conciliação/);
  assert.deepEqual(await leitura(financeiro(proprietario)), legado);
  assert.deepEqual(resumir((await leitura(financeiro(proprietario))).historico), resumir(historico));
});

test('origem por nome bloqueia arquivamento de homônimas sem alterar o histórico', async () => {
  const legado = {
    ...base,
    reservasDiarias: [caixinhaZero, caixinhaPositiva].map(id => ({ id: id.slice(7), nome: 'Comum', valor: 0 })),
    historico: [lancamento('origem-por-nome', {
      saidas: [{ id: 'saida-comum', origem: 'diaria:nome:Comum', nome: 'Retirada antiga', valor: 1 }],
    }), ...base.historico],
  };
  await env.withSecurityRulesDisabled(async contexto => setDoc(financeiro(contexto.firestore()), legado));
  for (const id of [caixinhaZero, caixinhaPositiva]) {
    await executar(comando('criar', id));
    await assert.rejects(executar(comando('arquivar', id, 1)), /referências pendentes/);
  }
  assert.deepEqual(await leitura(financeiro(proprietario)), legado);
});

test('rateio de custo mensal distribui o resto por data e evita cobrar o mesmo dia duas vezes', async () => {
  const dias = datasTrabalhoNoMes(2026, 10);
  await enviarFinanceiro(comandoFinanceiro({ tipo: 'custos-fixos', itens: [{ id: 'custo', nome: 'Custo', valorMensalCentavos: 100 }] }));
  let revisao = 2;
  for (const dia of [...dias].reverse().concat(dias[0], 22)) {
    const data = `2026-11-${String(dia).padStart(2, '0')}`;
    await enviarFinanceiro(comandoFinanceiro({ ...turnoFinanceiro, data, reservas: [] }, revisao++));
  }
  const { historico } = await leitura(financeiro(proprietario));
  const parcelas = historico.slice(0, dias.length + 2).map(item => reaisParaCentavos(item.detalheCustosFixosDia.custo));
  const baseDaParcela = Math.floor(100 / dias.length);
  assert.deepEqual(parcelas, [0, 0, ...dias.map((_, indice) => baseDaParcela + Number(indice < 100 % dias.length))]);
  assert.equal(parcelas.reduce((total, parcela) => total + parcela, 0), 100);
  assert.deepEqual(historico.slice(dias.length + 2), base.historico);
});

test('arquivamento disputa com turno retroativo sem deixar caixinha arquivada com saldo', async () => {
  await executar(comando());
  const item = aporte('credito-retroativo', 9);
  const [arquivo, credito] = await Promise.allSettled([
    executar(comando('arquivar', caixinhaZero, 1)),
    escrever(1, { tipo: 'incluir', item }),
  ]);
  assert.notEqual(arquivo.status, credito.status);
  const atual = await leitura(financeiro(proprietario));
  const esperado = credito.status === 'fulfilled' ? [item, ...base.historico] : base.historico;
  assert.deepEqual(atual.historico, esperado);
  assert.deepEqual(resumir(atual.historico), resumir(esperado));
  assert.equal((await consultarArquivadasEmulador(proprietario, uid)).length, arquivo.status === 'fulfilled' ? 1 : 0);
});

test('caixinha arquivada bloqueia aporte, retirada, edição, exclusão retroativa e configuração', async () => {
  await executar(comando());
  const original = aporte('entrada-zero', 0);
  await escrever(1, { tipo: 'incluir', item: original });
  await executar(comando('arquivar', caixinhaZero, 1, { revisaoFinanceira: 2 }));
  const antes = await leitura(financeiro(proprietario));
  for (const alteracao of [
    { tipo: 'incluir', item: aporte('outro-turno', 5) },
    { tipo: 'incluir', item: retiradaDoZero('retirada-proibida', 1) },
    { tipo: 'editar', item: aporte(original.id, 2) },
    { tipo: 'excluir', lancamentoId: original.id },
    { tipo: 'configurar', campos: { reservasDiarias: original.reservasDiariasDia } },
  ]) {
    await assert.rejects(escrever(2, alteracao), /arquivada/);
    assert.deepEqual(await leitura(financeiro(proprietario)), antes);
  }
  await assertFails(updateDoc(financeiro(proprietario), { historico: [], '_sync.revision': 3 }));
  await assertFails(updateDoc(financeiro(operadorFinanceiro), { historico: [], '_sync.revision': 3 }));
  await assert.rejects(escrever(2, { tipo: 'incluir', item: aporte('parceiro', 1) }, leitor), /permission/i);
  assert.equal(await leitura(path(proprietario, 'caixinhasRecibos', 'g0-r3')), undefined);
  assert.deepEqual(await leitura(financeiro(leitor)), antes);
  await assertFails(getDocFromServer(path(leitor, 'caixinhasRecibos', 'g0-r2')));
});

test('retiradas concorrentes, perda de resposta e cliente offline preservam saldo e um recibo por revisão', async () => {
  await executar(comando());
  const entrada = aporte('credito', 10);
  await escrever(1, { tipo: 'incluir', item: entrada });
  const saques = ['x', 'y'].map(id => ({ tipo: 'incluir', item: retiradaDoZero(id, 8) }));
  await disableNetwork(financeiroConcorrente);
  try {
    await assert.rejects(getDocFromServer(financeiro(financeiroConcorrente)), servidorIndisponivel);
    await assert.rejects(escrever(2, saques[0], financeiroConcorrente), servidorIndisponivel);
    assert.equal(await leitura(path(proprietario, 'caixinhasRecibos', 'g0-r3')), undefined);
  } finally {
    await enableNetwork(financeiroConcorrente);
  }
  const ambos = await Promise.allSettled(saques.map((s, i) => escrever(2, s, i ? financeiroConcorrente : operadorFinanceiro)));
  const vencedor = ambos.findIndex(r => r.status === 'fulfilled');
  assert.equal(ambos.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(ambos[1 - vencedor].reason.message, /Conflito/);
  assert.equal((await escrever(2, saques[vencedor], financeiroConcorrente)).repetida, true);
  await assert.rejects(escrever(3, saques[1 - vencedor]), /Saldo insuficiente/);
  const atual = await leitura(financeiro(proprietario));
  const resumo = resumir(atual.historico);
  assert.deepEqual(resumo, resumir([saques[vencedor].item, entrada, ...base.historico]));
  assert.equal(resumo.reservas[caixinhaZero.slice(7)].valor, 2);
  assert.equal(resumo.liquido, 93);
});

test('planeja adoção e restauração de backups antigos e atuais preservando IDs, eventos e geração', async () => {
  await executar(comando());
  await escrever(1, { tipo: 'incluir', item: aporte('preservado', 0) });
  await executar(comando('arquivar', caixinhaZero, 1, { revisaoFinanceira: 2 }));
  const evento = (await eventos(proprietario)).docs.map(item => item.data());
  const backup = JSON.parse(JSON.stringify({
    schema: 'appcar-ciclo-v1', uid, financeiro: await leitura(financeiro(proprietario)),
    catalogo: await consultarArquivadasEmulador(proprietario, uid),
    auditoria: [...evento, ...evento],
    recibos: Array(2).fill(await leitura(path(proprietario, 'caixinhasRecibos', 'g0-r2'))),
  }));
  const plano = prepararRestauracaoCaixinhas(backup, uid, backup);
  assert.equal(plano.auditoria.length, 2);
  assert.equal(plano.recibos.length, 1);
  assert.equal(plano.catalogo[0].estado, 'arquivada');
  assert.deepEqual(plano.financeiro, backup.financeiro);
  assert.deepEqual(resumir(plano.financeiro.historico), resumir(backup.financeiro.historico));
  assert.throws(() => prepararRestauracaoCaixinhas(backup, outro), /outro proprietário/);
  assert.throws(() => prepararRestauracaoCaixinhas(backup, uid, {
    ...backup, financeiro: { ...backup.financeiro, _sync: { generation: 1, revision: 0 } },
  }), /Destino divergente/);
  assert.throws(() => prepararRestauracaoCaixinhas({
    ...backup, auditoria: [...backup.auditoria, { ...backup.auditoria[0], motivo: 'Divergente' }],
  }, uid), /conteúdo divergente/);
  const legado = { ...base, historico: [...base.historico, lancamento('sem-id', {
    reservasDiariasDia: [{ nome: 'Nome registrado', valor: 4 }, ...aporte('outro', 3).reservasDiariasDia,
      { id: 'homonima', nome: 'Nome registrado', valor: 3 }],
  })] };
  const bruto = JSON.stringify(legado);
  for (const formato of [legado, { conta: { identificador: uid }, dadosEmUso: legado },
    { schema: 'appcar-reset-backup-v1', uid, remote: legado }]) {
    const previsao = prepararRestauracaoCaixinhas(formato, uid);
    assert.equal(previsao.modo, 'consulta-legada');
    assert.ok(previsao.adocao.identidades.some(c => c.id === caixinhaZero));
    assert.ok(previsao.adocao.identidades.some(c => c.id === 'diaria:homonima'));
    assert.ok(previsao.adocao.pendencias.some(p => p.motivo === 'sem-id'));
    assert.deepEqual(resumir(previsao.financeiro.historico), resumir(legado.historico));
  }
  assert.equal(JSON.stringify(legado), bruto);
  assert.deepEqual(await leitura(financeiro(proprietario)), backup.financeiro);
});
