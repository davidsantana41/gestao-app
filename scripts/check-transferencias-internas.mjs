import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmarComando } from '../src/lib/executorFinanceiroServidor.ts';
import { resumir } from '../src/lib/gestao.ts';
import { validarSaldoOrigemTransferencia, validarSaldosConciliados } from '../src/lib/gestaoCaixinhasServidor.ts';

const uid = 'teste-transferencias';
const espacoId = '00000000-0000-4000-8000-000000000021';
const espaco = `espacosFinanceiros/${espacoId}`;
const financeiro = `users/${uid}/appData/main`;
const idA = '11111111-1111-4111-8111-111111111111';
const idB = '22222222-2222-4222-8222-222222222222';
const op1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const op2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const op3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';

function banco() {
  const historico = [
    { id: 'entrada-legada', tipo: 'avulso_entrada', data: '26/11/2026', diaSemana: 'quinta-feira',
      faturamentoBruto: 100, combustivel: 0, litros: 0, kmTrabalhado: 0, kmTotal: 0,
      reservaFevereiro: 0, reservaInvestimento: 0, reservaAcidente: 0, custosFixosDia: 0,
      saidas: [], totalDespesas: 0, liquido: 100 },
    { id: 'reserva-legada', tipo: 'avulso_saida', data: '26/11/2026', diaSemana: 'quinta-feira',
      faturamentoBruto: 0, combustivel: 0, litros: 0, kmTrabalhado: 0, kmTotal: 0,
      reservaFevereiro: 0, reservaInvestimento: 0, reservaAcidente: 0, custosFixosDia: 0,
      reservasDiariasDia: [{ id: idA, nome: 'Reserva A', valor: 25 }],
      saidas: [{ id: 'debito-legado', origem: 'principal', nome: 'Reserva inicial', valor: 25 }], totalDespesas: 25, liquido: -25 },
  ];
  const base = { _sync: { generation: 0, revision: 1 }, historico, reservasDiarias: [
    { id: idA, nome: 'Reserva A', valor: 0 }, { id: idB, nome: 'Reserva B', valor: 0 },
  ] };
  const documentos = new Map([
    [espaco, { proprietarioUid: uid, comandosFinanceiros: true,
      operacoesFinanceiras: ['deposito-caixinha', 'retirada'] }],
    [financeiro, base],
  ]);
  for (const chave of [`diaria:${idA}`, `diaria:${idB}`, 'reserva-fixa:reserva1', 'reserva-fixa:reserva2', 'reserva-fixa:reserva3']) {
    documentos.set(`${espaco}/caixinhas/${encodeURIComponent(chave)}`, { id: chave, estado: 'ativa' });
  }
  const tx = {
    get: async caminho => documentos.get(caminho),
    set: (caminho, valor) => {
      documentos.set(caminho, caminho === financeiro ? { ...documentos.get(caminho), ...valor } : valor);
    },
    listar: async caminho => [...documentos.entries()].filter(([key]) => key.startsWith(`${caminho}/`)).map(([, value]) => value),
    agora: () => '2026-11-26T12:00:00.000Z',
  };
  return { documentos, tx };
}

function entrada(operacaoId, revisao, origem, destino, valorCentavos) {
  return { operacaoId, geracao: 0, revisao, alteracao: { tipo: 'transferencia-interna', data: '2026-11-26',
    origem, destino, nomeOrigem: origem === 'principal' ? 'Saldo principal' : 'Reserva A',
    nomeDestino: destino === 'principal' ? 'Saldo principal' : destino.endsWith(idB) ? 'Reserva B' : 'Reserva A',
    valorCentavos, descricao: 'Teste de transferência' } };
}

async function salvar(bancoTeste, comando) {
  return confirmarComando(bancoTeste.tx, uid, espacoId, financeiro, comando, {
    atualizarCampos: true, criarCusto: true, criarReservaDiaria: true,
    validarSaldoOrigemTransferencia: (antes, id, valor) => validarSaldoOrigemTransferencia(bancoTeste.tx, espaco, antes, id, valor),
    validarSaldos: (antes, depois, ids) => validarSaldosConciliados(bancoTeste.tx, espaco, antes, depois, ids),
  });
}

test('transferências principal-caixinha, caixinha-principal e caixinha-caixinha preservam o consolidado e são idempotentes', async () => {
  const db = banco();
  const operacionalAntes = resumir(db.documentos.get(financeiro).historico);
  assert.equal(operacionalAntes.liquido, 75);

  assert.equal((await salvar(db, entrada(op1, 1, 'principal', `diaria:${idB}`, 1000))).repetida, false);
  assert.equal((await salvar(db, entrada(op1, 1, 'principal', `diaria:${idB}`, 1000))).repetida, true);
  assert.equal((await salvar(db, entrada(op2, 2, `diaria:${idA}`, 'principal', 800))).repetida, false);
  assert.equal((await salvar(db, entrada(op3, 3, `diaria:${idA}`, `diaria:${idB}`, 500))).repetida, false);

  const dados = db.documentos.get(financeiro);
  const transferencias = dados.historico.filter(item => item.tipo === 'transferencia-interna');
  assert.equal(transferencias.length, 3, 'repetição do mesmo UUID não pode duplicar o lançamento');
  assert.equal(resumir(dados.historico).liquido, 73);
  assert.equal(resumir(dados.historico).faturamento, operacionalAntes.faturamento);
  assert.equal(resumir(dados.historico).despesas, operacionalAntes.despesas);
  assert.equal(resumir(dados.historico).dias, operacionalAntes.dias);
  assert.equal(db.documentos.get(`${espaco}/operacoes/${op1}`).revisao, 2);
  assert.ok(transferencias.every(item => item.confirmadoEm === '2026-11-26T12:00:00.000Z'));
});

test('bloqueia transferência acima do saldo da origem sem gravar qualquer documento', async () => {
  const db = banco();
  const estadoAntes = [...db.documentos.entries()];
  await assert.rejects(salvar(db, entrada(op1, 1, `diaria:${idA}`, 'principal', 2501)), /excede o saldo disponível/);
  assert.deepEqual([...db.documentos.entries()], estadoAntes);
});

test('permite receber de uma caixinha quando o saldo principal está negativo', async () => {
  const db = banco();
  const anterior = db.documentos.get(financeiro);
  anterior.historico.find(item => item.id === 'entrada-legada').faturamentoBruto = 20;
  anterior.historico.find(item => item.id === 'entrada-legada').liquido = 20;
  assert.equal(resumir(anterior.historico).liquido, -5);

  const recibo = await salvar(db, entrada(op2, 1, `diaria:${idA}`, 'principal', 800));
  assert.equal(recibo.repetida, false);
  const dados = db.documentos.get(financeiro);
  assert.equal(resumir(dados.historico).liquido, 3);
  assert.equal(dados.historico.find(item => item.id === 'reserva-legada').reservasDiariasDia[0].valor, 25);
  assert.equal(dados.historico[0].tipo, 'transferencia-interna');
});
