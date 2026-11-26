import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dadosPadrao, novoFormulario } from '../src/lib/gestao.ts';
import { consultarCaixinhas, confirmarCaixinha } from '../src/lib/gestaoCaixinhasServidor.ts';

const uid = 'uid-teste-local';
const espacoId = 'espaco-teste-local';
const espaco = `espacosFinanceiros/${espacoId}`;
const financeiro = `users/${uid}/appData/main`;
const idInvestimento = 'diaria:a521d229-2e17-4ead-baff-79ee53b58a4e';
const idIncestimento = 'diaria:reserva-1794427483732-y5v7p9';

function criarBase() {
  const dados = {
    ...dadosPadrao(),
    // O código fixo do catálogo sempre inclui três identidades do legado.
    // O teste foca em reservas diárias e filtra essas três identidades da expectativa.
    custosFixos: [],
    nomeReserva1: undefined, nomeReserva2: undefined, nomeReserva3: undefined,
    _sync: { generation: 0, revision: 0 },
    reservasDiarias: [{ id: idInvestimento.slice(7), nome: 'Investimento', valor: 0 }],
    historico: [
      { id: 'turno-investimento', data: '18/11/2026', diaSemana: 'quarta-feira', tipo: 'turno', faturamentoBruto: 0,
        combustivel: 0, litros: 0, kmTrabalhado: 0, kmTotal: 0, reservaFevereiro: 0, reservaInvestimento: 0,
        reservaAcidente: 0, custosFixosDia: 0, saidas: [], totalDespesas: 0, liquido: 0,
        reservasDiariasDia: [{ id: idInvestimento.slice(7), nome: 'Investimento', valor: 25 }] },
      { id: 'retirada-investimento', data: '20/11/2026', diaSemana: 'sexta-feira', tipo: 'avulso_saida', faturamentoBruto: 0,
        combustivel: 0, litros: 0, kmTrabalhado: 0, kmTotal: 0, reservaFevereiro: 0, reservaInvestimento: 0,
        reservaAcidente: 0, custosFixosDia: 0, saidas: [{ id: 'saida-investimento', origem: idInvestimento, nome: 'carne', valor: 25 }],
        totalDespesas: 25, liquido: -25 },
      { id: 'turno-incestimento', data: '16/11/2026', diaSemana: 'segunda-feira', tipo: 'turno', faturamentoBruto: 0,
        combustivel: 0, litros: 0, kmTrabalhado: 0, kmTotal: 0, reservaFevereiro: 0, reservaInvestimento: 0,
        reservaAcidente: 0, custosFixosDia: 0, saidas: [], totalDespesas: 0, liquido: 0,
        reservasDiariasDia: [{ id: idIncestimento.slice(7), nome: 'incestimento', valor: 25 }] },
      { id: 'retirada-incestimento', data: '20/11/2026', diaSemana: 'sexta-feira', tipo: 'avulso_saida', faturamentoBruto: 0,
        combustivel: 0, litros: 0, kmTrabalhado: 0, kmTotal: 0, reservaFevereiro: 0, reservaInvestimento: 0,
        reservaAcidente: 0, custosFixosDia: 0, saidas: [{ id: 'saida-incestimento', origem: idIncestimento, nome: 'Alfaçe', valor: 25 }],
        totalDespesas: 25, liquido: -25 },
    ],
  };
  return dados;
}

function transacaoMemoria(dados) {
  const docs = new Map([
    [espaco, { proprietarioUid: uid, comandosFinanceiros: true,
      operacoesFinanceiras: ['caixinha-arquivar', 'caixinha-reativar'] }],
    [financeiro, dados],
    [`${espaco}/caixinhas/${encodeURIComponent(idInvestimento)}`,
      { id: idInvestimento, estado: 'ativa', nome: 'Investimento', finalidade: '' }],
    [`${espaco}/caixinhas/${encodeURIComponent(idIncestimento)}`,
      { id: idIncestimento, estado: 'arquivada', nome: idIncestimento.slice(7), finalidade: '' }],
  ]);
  return {
    docs,
    tx: {
      get: async path => docs.get(path),
      set: (path, value) => docs.set(path, path === financeiro ? { ...docs.get(path), ...value } : value),
      listar: async path => [...docs.entries()].filter(([key]) => key.startsWith(path + '/')).map(([, value]) => value),
      agora: () => new Date('2026-11-25T12:00:00.000Z'),
    },
  };
}

function comando(tipo, caixinhaId, revisao, operacaoId) {
  return { operacaoId, geracao: 0, revisao, alteracao: { tipo, caixinhaId, motivo: 'Validação de regressão local' } };
}

test('desativar e reativar atualizam estado, contadores e reservas de novos turnos, sem cruzar históricos', async () => {
  const dados = criarBase();
  const { tx, docs } = transacaoMemoria(dados);

  let leitura = await consultarCaixinhas(tx, espaco, dados, true);
  const caixasEsperadas = [
    [idInvestimento, 'Investimento', 'ativa'], [idIncestimento, 'incestimento', 'arquivada'],
  ];
  const diarias = caixas => caixas.filter(c => c.id.startsWith('diaria:'));
  assert.deepEqual(diarias(leitura.relatorio.caixinhas).map(c => [c.id, c.nome, c.estado]).sort(), caixasEsperadas.sort());
  assert.equal(diarias(leitura.relatorio.caixinhas).filter(c => c.estado === 'ativa').length, 1);
  assert.equal(diarias(leitura.relatorio.caixinhas).filter(c => c.estado === 'arquivada').length, 1);
  assert.deepEqual(diarias(leitura.relatorio.caixinhas).map(c => [c.id, c.totalCreditos, c.totalDebitos, c.saldo]).sort(), [
    [idInvestimento, 25, 25, 0], [idIncestimento, 25, 25, 0],
  ].sort());
  assert.deepEqual(novoFormulario(dados.reservasDiarias).reservas.map(r => r.id), [idInvestimento.slice(7)]);

  await confirmarCaixinha(tx, uid, espaco, financeiro,
    comando('caixinha-arquivar', idInvestimento, 0, '11111111-1111-4111-8111-111111111111'));
  let atualizado = docs.get(financeiro);
  leitura = await consultarCaixinhas(tx, espaco, atualizado, true);
  assert.equal(diarias(leitura.relatorio.caixinhas).filter(c => c.estado === 'ativa').length, 0);
  assert.equal(diarias(leitura.relatorio.caixinhas).filter(c => c.estado === 'arquivada').length, 2);
  assert.deepEqual(novoFormulario(atualizado.reservasDiarias).reservas, []);
  assert.equal(leitura.relatorio.caixinhas.find(c => c.id === idInvestimento).estado, 'arquivada');
  assert.equal(leitura.relatorio.caixinhas.find(c => c.id === idIncestimento).estado, 'arquivada');

  await confirmarCaixinha(tx, uid, espaco, financeiro,
    comando('caixinha-reativar', idInvestimento, 1, '22222222-2222-4222-8222-222222222222'));
  atualizado = docs.get(financeiro);
  leitura = await consultarCaixinhas(tx, espaco, atualizado, true);
  assert.equal(diarias(leitura.relatorio.caixinhas).filter(c => c.estado === 'ativa').length, 1);
  assert.equal(diarias(leitura.relatorio.caixinhas).filter(c => c.estado === 'arquivada').length, 1);
  assert.deepEqual(novoFormulario(atualizado.reservasDiarias).reservas.map(r => r.id), [idInvestimento.slice(7)]);
  assert.deepEqual(diarias(leitura.relatorio.caixinhas).map(c => [c.id, c.totalCreditos, c.totalDebitos, c.saldo]).sort(), [
    [idInvestimento, 25, 25, 0], [idIncestimento, 25, 25, 0],
  ].sort());
  assert.equal(dados.historico.length, 4, 'histórico de origem não deve ser alterado');
});
