import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validarCicloCaixinha } from '../src/lib/cicloCaixinhas.ts';
import { conferirReferenciaMovimentacao, referenciarMovimentacao } from '../src/lib/referenciaMovimentacao.ts';

test('validação do ciclo exige motivo e respeita o estado e o saldo', () => {
  const ativa = { id: 'diaria:existente', nome: 'Viagem', finalidade: 'Deslocamento', estado: 'ativa' };
  const arquivada = { ...ativa, estado: 'arquivada' };
  const dados = { nome: 'Novo nome', motivo: 'Motivo informado', saldo: 0 };
  assert.equal(validarCicloCaixinha('criar', undefined, dados), undefined);
  assert.match(validarCicloCaixinha('criar', undefined, { ...dados, nome: ' ' }), /nome/);
  assert.equal(validarCicloCaixinha('arquivar', ativa, dados), undefined);
  assert.match(validarCicloCaixinha('arquivar', ativa, { ...dados, saldo: 0.01 }), /transferência explícita/);
  assert.match(validarCicloCaixinha('arquivar', ativa, { ...dados, saldo: -0.01 }), /saldo negativo/);
  assert.match(validarCicloCaixinha('arquivar', ativa, { ...dados, saldo: NaN }), /confirmado/);
  assert.match(validarCicloCaixinha('arquivar', arquivada, dados), /estado/);
  assert.equal(validarCicloCaixinha('renomear', ativa, { ...dados, saldo: 10 }), undefined);
  assert.match(validarCicloCaixinha('renomear', ativa, { ...dados, nome: ativa.nome }), /nome novo/);
  assert.equal(validarCicloCaixinha('reativar', arquivada, { ...dados, saldo: -10 }), undefined);
  assert.match(validarCicloCaixinha('reativar', ativa, dados), /estado/);
  for (const acao of ['renomear', 'arquivar', 'reativar']) {
    assert.match(validarCicloCaixinha(acao, acao === 'reativar' ? arquivada : ativa, { ...dados, motivo: '  ' }), /motivo/);
  }
});

const lancamento = {
  id: 'legado', data: '13/11/2026', tipo: 'turno',
  reservasDiariasDia: [{ nome: 'Mesmo nome', valor: 0.05 }, { id: 'id-antigo', nome: 'Mesmo nome', valor: 10 }],
  saidas: [{ id: 'saida-1', origem: 'diaria:nome:Mesmo nome', nome: 'Retirada', valor: 3 }],
  detalheCustosFixosDia: { 'fixo-antigo': 5.125 },
  reservaAcidente: 0,
};

test('referências são reprodutíveis sem regravação, inclusive para registro sem ID', async () => {
  const original = JSON.stringify(lancamento);
  const selecoes = [
    { fonte: 'reserva-diaria', indice: 0 }, { fonte: 'reserva-diaria', indice: 1 },
    { fonte: 'retirada', indice: 0 }, { fonte: 'rateio', chave: 'fixo-antigo' },
    { fonte: 'reserva-fixa', chave: 'reservaAcidente' },
  ];
  const referencias = await Promise.all(selecoes.map(s => referenciarMovimentacao([lancamento], lancamento.id, s)));
  assert.equal(new Set(referencias.map(r => r.sha256)).size, selecoes.length);
  assert.equal(referencias[0].chaveOriginal, null);
  assert.equal(referencias[1].chaveOriginal, 'id-antigo');
  const reordenado = { ...lancamento, reservasDiariasDia: [...lancamento.reservasDiariasDia].reverse() };
  assert.deepEqual(await referenciarMovimentacao([reordenado], lancamento.id, { fonte: 'reserva-diaria', indice: 1 }), referencias[0]);
  for (const referencia of referencias) {
    assert.equal(await conferirReferenciaMovimentacao([JSON.parse(original)], referencia), true);
    assert.equal(await conferirReferenciaMovimentacao([reordenado], referencia), true);
    assert.equal(await conferirReferenciaMovimentacao([{ ...reordenado, data: '14/11/2026' }], referencia), false);
  }
  assert.equal(JSON.stringify(lancamento), original);
});

test('duplicidades, ausência de ID pai e alterações na evidência invalidam a referência', async () => {
  const selecao = { fonte: 'reserva-diaria', indice: 0 };
  const referencia = await referenciarMovimentacao([lancamento], lancamento.id, selecao);
  const primeira = lancamento.reservasDiariasDia[0];
  const repetido = { ...lancamento, reservasDiariasDia: [primeira, { ...primeira, id: '' }] };
  const alterado = { ...lancamento, reservasDiariasDia: [{ ...primeira, valor: 2 }] };
  assert.equal(await referenciarMovimentacao([repetido], lancamento.id, selecao), undefined);
  assert.equal(await conferirReferenciaMovimentacao([repetido], referencia), false);
  assert.equal(await conferirReferenciaMovimentacao([alterado], referencia), false);
  assert.equal(await referenciarMovimentacao([lancamento, lancamento], lancamento.id, selecao), undefined);
  assert.equal(await referenciarMovimentacao([{ ...lancamento, id: '' }], '', selecao), undefined);
  const saidas = [...lancamento.saidas, { ...lancamento.saidas[0], valor: 2 }];
  assert.equal(await referenciarMovimentacao([{ ...lancamento, saidas }], lancamento.id, { fonte: 'retirada', indice: 0 }), undefined);
});
