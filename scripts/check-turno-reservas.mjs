import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmarComando } from '../src/lib/executorFinanceiroServidor.ts';
import { dadosPadrao, resumir } from '../src/lib/gestao.ts';
import { uuidFinanceiro } from '../src/lib/comandoFinanceiro.ts';

const uid = 'motorista-teste';
const espacoId = '00000000-0000-4000-8000-000000000001';
const espaco = `espacosFinanceiros/${espacoId}`;
const financeiro = `users/${uid}/appData/main`;
const uuidReservaA = '11111111-1111-4111-8111-111111111111';
const uuidReservaB = '22222222-2222-4222-8222-222222222222';
const uuidOperacaoA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const uuidOperacaoB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const uuidOperacaoC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function bancoTeste() {
  const base = { ...dadosPadrao(), reservasDiarias: [], historico: [], _sync: { generation: 0, revision: 1 } };
  const documentos = new Map([
    [espaco, { proprietarioUid: uid, comandosFinanceiros: true, operacoesFinanceiras: ['turno'] }],
    [financeiro, base],
  ]);
  for (const custo of base.custosFixos) {
    const id = `fixo:${custo.id}`;
    documentos.set(`${espaco}/caixinhas/${encodeURIComponent(id)}`, { id, estado: 'ativa' });
  }
  for (const id of ['reserva1', 'reserva2', 'reserva3']) {
    const chave = `reserva-fixa:${id}`;
    documentos.set(`${espaco}/caixinhas/${encodeURIComponent(chave)}`, { id: chave, estado: 'ativa' });
  }
  return {
    documentos,
    tx: {
      get: async caminho => documentos.get(caminho),
      set: (caminho, valor) => {
        if (caminho === financeiro) documentos.set(caminho, { ...documentos.get(caminho), ...valor });
        else documentos.set(caminho, valor);
      },
      agora: () => 'agora-teste',
    },
  };
}

function comando(operacaoId, revisao, reservas, extra = {}) {
  return {
    operacaoId, geracao: 0, revisao,
    alteracao: {
      tipo: 'turno', data: '2026-11-26', faturamentoCentavos: 100000,
      combustivelCentavos: 10000, litrosCentesimos: 5000,
      kmTrabalhadoCentesimos: 3000, kmTotalCentesimos: 5000,
      reserva1Centavos: 0, reserva2Centavos: 0, reservas, ...extra,
    },
  };
}

async function salvar(banco, entrada) {
  return confirmarComando(banco.tx, uid, espacoId, financeiro, entrada, {
    atualizarCampos: true,
    criarCusto: true,
    criarReservaDiaria: true,
    validarSaldos: async () => {},
  });
}

test('adicionar, renomear e remover linhas mantém catálogo estável e credita cada turno uma vez', async () => {
  const banco = bancoTeste();
  const primeiro = comando(uuidOperacaoA, 1, [
    { id: uuidReservaA, nome: 'Viagem', valorCentavos: 3000 },
    { id: uuidReservaB, nome: 'Manutenção', valorCentavos: 0 },
  ]);
  assert.equal(uuidFinanceiro.test(primeiro.alteracao.reservas[0].id), true);
  await salvar(banco, primeiro);

  let atual = banco.documentos.get(financeiro);
  assert.equal(atual._sync.revision, 2);
  assert.deepEqual(atual.reservasDiarias, [
    { id: uuidReservaA, nome: 'Viagem', valor: 0 },
    { id: uuidReservaB, nome: 'Manutenção', valor: 0 },
  ]);
  assert.deepEqual(atual.historico[0].reservasDiariasDia, [
    { id: uuidReservaA, nome: 'Viagem', valor: 30 },
    { id: uuidReservaB, nome: 'Manutenção', valor: 0 },
  ]);
  assert.equal(banco.documentos.get(`${espaco}/caixinhas/diaria%3A${uuidReservaA}`).estado, 'ativa');
  assert.equal(banco.documentos.get(`${espaco}/caixinhas/diaria%3A${uuidReservaB}`).estado, 'ativa');
  const caixinhasAfetadas = banco.documentos.get(`${espaco}/operacoes/${uuidOperacaoA}`).caixinhas;
  assert.equal(caixinhasAfetadas.includes(`diaria:${uuidReservaA}`), true);
  assert.equal(caixinhasAfetadas.includes(`diaria:${uuidReservaB}`), true);

  // Reenvio do mesmo UUID devolve o recibo e não grava uma segunda movimentação.
  assert.equal((await salvar(banco, primeiro)).repetida, true);
  assert.equal(banco.documentos.get(financeiro).historico.length, 1);

  const segundo = comando(uuidOperacaoB, 2, [
    { id: uuidReservaA, nome: 'Férias', valorCentavos: 550 },
    { id: uuidReservaB, nome: 'Manutenção', valorCentavos: 1200 },
  ]);
  await salvar(banco, segundo);
  atual = banco.documentos.get(financeiro);
  assert.deepEqual(atual.historico[0].reservasDiariasDia, [
    { id: uuidReservaA, nome: 'Férias', valor: 5.5 },
    { id: uuidReservaB, nome: 'Manutenção', valor: 12 },
  ]);
  assert.deepEqual(atual.reservasDiarias, [
    { id: uuidReservaA, nome: 'Férias', valor: 0 },
    { id: uuidReservaB, nome: 'Manutenção', valor: 0 },
  ]);
  assert.equal(atual.historico[0].reservasDiariasDia[0].nome, 'Férias');
  assert.equal(atual.historico[1].reservasDiariasDia[0].nome, 'Viagem', 'O nome gravado no turno antigo permanece intacto.');
  assert.equal(resumir(atual.historico).reservas[uuidReservaA].valor, 35.5);
  assert.equal(resumir(atual.historico).reservas[uuidReservaB].valor, 12);
  assert.equal([...banco.documentos.keys()].filter(caminho => caminho === `${espaco}/caixinhas/diaria%3A${uuidReservaA}`).length, 1);

  const terceiro = comando(uuidOperacaoC, 3, [{ id: uuidReservaB, nome: 'Manutenção', valorCentavos: 0 }]);
  await salvar(banco, terceiro);
  atual = banco.documentos.get(financeiro);
  assert.equal(atual.historico[0].reservasDiariasDia.some(r => r.id === uuidReservaA), false,
    'Remover a linha deixa de provisionar somente neste turno.');
  assert.equal(atual.reservasDiarias.some(r => r.id === uuidReservaA && r.nome === 'Férias' && r.valor === 0), true,
    'A caixinha removida da linha permanece ativa para turnos futuros.');
  assert.equal(atual.historico.length, 3, 'Os registros financeiros anteriores são preservados.');
});

test('IDs repetidos no comando e IDs históricos reutilizados como novos cadastros são rejeitados', async () => {
  const banco = bancoTeste();
  await assert.rejects(
    salvar(banco, comando(uuidOperacaoA, 1, [
      { id: uuidReservaA, nome: 'Uma', valorCentavos: 0 },
      { id: uuidReservaA, nome: 'Outra', valorCentavos: 0 },
    ])),
    /IDs duplicados/,
  );
  const idLegado = '33333333-3333-4333-8333-333333333333';
  const original = banco.documentos.get(financeiro);
  original.historico = [{
    id: 'turno-legado', data: '26/11/2026', tipo: 'turno', faturamentoBruto: 0, totalDespesas: 0, liquido: 0,
    combustivel: 0, litros: 0, kmTrabalhado: 0, kmTotal: 0, reservaFevereiro: 0, reservaInvestimento: 0,
    reservaAcidente: 0, custosFixosDia: 0, detalheCustosFixosDia: {}, reservasDiariasDia: [{ id: idLegado, nome: 'Histórica', valor: 0 }], saidas: [],
  }];
  original._sync.revision = 1;
  await assert.rejects(
    salvar(banco, comando(uuidOperacaoB, 1, [{ id: idLegado, nome: 'Histórica', valorCentavos: 100 }])),
    /identidade permanente disponível/,
  );
  assert.equal(banco.documentos.get(financeiro).historico.length, 1, 'A operação recusada não altera o histórico.');
});
