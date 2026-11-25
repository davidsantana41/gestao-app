import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projetarCatalogoCaixinhas, revisarPendenciasCaixinhas } from '../src/lib/catalogoCaixinhas.ts';
import { dadosPadrao, lerDados, resumir } from '../src/lib/gestao.ts';
import { planejarAdocaoCaixinhas, saldoVerificavelEmCentavos } from '../src/lib/integridadeCaixinhas.ts';
import { arredondarRazaoEmCentavos, centavosParaReais, distribuirCentavos, reaisParaCentavos, somarCentavos } from '../src/lib/centavosFinanceiros.ts';

const reserva = (id, nome, valor) => ({ id, nome, valor });
const retirada = (origem, valor) => ({ id: `saida-${origem}`, origem, nome: 'Descrição da retirada', valor });
const turno = (id, campos) => ({
  id, data: '15/11/2026', diaSemana: 'domingo', tipo: 'turno',
  faturamentoBruto: 100, totalDespesas: 20, liquido: 80, combustivel: 5, litros: 1, kmTrabalhado: 10,
  ...campos,
});
const dados = (campos) => ({ ...dadosPadrao(), custosFixos: [], ...campos });
const porId = (projecao, id) => projecao.caixinhas.find(c => c.id === id);

test('soma e distribui centavos com precisão e rejeita entradas fora do domínio', () => {
  assert.equal(somarCentavos([0.10, 0.20, -0.30].map(reaisParaCentavos)), 0);
  assert.deepEqual(distribuirCentavos(5, 3), [2, 2, 1]);
  assert.deepEqual(distribuirCentavos(2, 4), [1, 1, 0, 0]);
  assert.equal(arredondarRazaoEmCentavos(5, 2), 3);
  assert.equal(arredondarRazaoEmCentavos(-5, 2), -3);
  assert.equal(centavosParaReais(-3), -0.03);
  assert.throws(() => centavosParaReais(Number.MAX_SAFE_INTEGER), /limite/);
  assert.throws(() => somarCentavos([Number.MAX_SAFE_INTEGER, 1]), /limite/);
  for (const invalido of [0.005, 0.1 + 0.2, NaN, Infinity, '1.00']) {
    assert.throws(() => reaisParaCentavos(invalido), /inválido ou fracionário/);
  }
});

test('plano determinístico conserva IDs e nomes históricos e mantém evidências ambíguas pendentes', () => {
  const entrada = dados({
    reservasDiarias: [reserva('a', 'Carne', 0), reserva('b', 'Carne', 0)],
    historico: [
      turno('claro', { reservasDiariasDia: [reserva('a', 'Nome na época', 7)] }),
      turno('duplicado', { reservasDiariasDia: [reserva('a', 'Nome na época', 1)] }),
      turno('duplicado', { reservasDiariasDia: [reserva('a', 'Nome na época', 2)] }),
      turno('sem-origem', { reservasDiariasDia: [reserva('', 'Carne', 3)] }),
      turno('retiradas', { saidas: [{ ...retirada('diaria:b', 3), id: '' },
        retirada('diaria:b', 4), retirada('diaria:b', 5)] }),
    ],
  });
  const original = structuredClone(entrada);
  const plano = planejarAdocaoCaixinhas(entrada);
  const reordenado = { ...entrada, historico: [...entrada.historico].reverse(),
    reservasDiarias: [...entrada.reservasDiarias].reverse() };
  assert.deepEqual(planejarAdocaoCaixinhas(reordenado), plano);
  assert.deepEqual(plano.identidades.filter(c => c.familia === 'diaria').map(c => c.id), ['diaria:a', 'diaria:b']);
  assert.deepEqual(plano.identidades.find(c => c.id === 'diaria:a').evidencias
    .filter(e => e.fonte === 'reserva-diaria').map(e => [e.nome, e.valor]), [['Nome na época', 7]]);
  assert.equal(plano.pendencias.length, 6);
  assert.throws(() => saldoVerificavelEmCentavos(entrada, 'diaria:a'), /pendentes/);
  assert.throws(() => saldoVerificavelEmCentavos(entrada, 'diaria:b'), /pendentes/);
  assert.deepEqual(entrada, original);
  assert.deepEqual(resumir(entrada.historico), resumir(original.historico));
});

test('saldo separa famílias com a mesma chave e ignora o valor do modelo de reservas', () => {
  const entrada = dados({
    reservasDiarias: [reserva('x', 'Reserva X', 99)],
    historico: [turno('movimento', {
      detalheCustosFixosDia: { x: 0.15 },
      reservasDiariasDia: [reserva('x', 'Reserva X antiga', 0.05)],
      saidas: [retirada('x', 0.05), retirada('diaria:x', 0.10)],
    })],
  });
  assert.equal(saldoVerificavelEmCentavos(entrada, 'fixo:x'), 10);
  assert.equal(saldoVerificavelEmCentavos(entrada, 'diaria:x'), -5);
});

test('expõe homônimas como candidatas independentes e mantém referências incertas sem vínculo', () => {
  const entrada = dados({
    nomeReserva1: 'Emergência',
    custosFixos: [{ id: 'reserva1', nome: 'Custo com referência em conflito', valorMensal: 12 }],
    reservasDiarias: [reserva('a', 'Carne', 0), reserva('b', 'Carne', 0), reserva('c', 'Carnes', 0)],
    historico: [turno('movimento', {
      reservasDiariasDia: [reserva(undefined, 'Carne', 7), reserva('repetido', 'A', 1), reserva('repetido', 'B', 2)],
      saidas: [retirada('diaria:nome:Carne', 3), retirada('desconhecida', 4), retirada('reserva1', 5)],
    })],
  });
  const antes = projetarCatalogoCaixinhas(entrada);
  const revisao = revisarPendenciasCaixinhas(entrada);
  const ids = item => item.candidatos.map(({ caixinha, criterio }) => [caixinha.id, criterio]);
  assert.deepEqual(ids(revisao[0]), [['diaria:a', 'nome'], ['diaria:b', 'nome']]);
  assert.equal(revisao[0].evidencia.valor, 7);
  assert.equal(revisao[1].referenciaOriginal, 'repetido');
  assert.deepEqual(ids(revisao[1]), []);
  assert.deepEqual(ids(revisao[3]), ids(revisao[0]));
  assert.equal(revisao[3].referenciaOriginal, 'diaria:nome:Carne');
  assert.deepEqual(ids(revisao[4]), []);
  assert.deepEqual(ids(revisao[5]), [['fixo:reserva1', 'referencia'], ['reserva-fixa:reserva1', 'referencia']]);
  assert.deepEqual(projetarCatalogoCaixinhas(entrada), antes);
  assert.deepEqual(revisarPendenciasCaixinhas(entrada), revisao);
});

test('IDs de famílias distintas e homônimas permanecem separados ao renomear', () => {
  const original = dados({
    custosFixos: [{ id: '1', nome: 'Carne', valorMensal: 22 }],
    reservasDiarias: [reserva('2', 'Carne', 0), reserva('1', 'Carne', 0)],
    historico: [
      turno('a', { reservasDiariasDia: [reserva('1', 'Nome antigo', 7), reserva('2', 'Carne', 13)] }),
      turno('b', { reservasDiariasDia: [reserva('1', 'Carne', 9)] }),
    ],
  });
  const antes = projetarCatalogoCaixinhas(original);
  assert.deepEqual(antes.caixinhas.filter(c => c.nomeConfigurado === 'Carne').map(c => c.id),
    ['fixo:1', 'diaria:2', 'diaria:1']);
  assert.equal(antes.pendencias.length, 0);
  const depois = projetarCatalogoCaixinhas({
    ...original, reservasDiarias: [reserva('1', 'Nome atual', 0), original.reservasDiarias[0]],
    historico: [...original.historico].reverse(),
  });
  assert.equal(porId(depois, 'diaria:1').nomeConfigurado, 'Nome atual');
  assert.deepEqual(porId(depois, 'diaria:1').evidencias.filter(e => e.fonte === 'reserva-diaria')
    .map(e => [e.nome, e.valor]), [['Carne', 9], ['Nome antigo', 7]]);
  assert.deepEqual(depois.caixinhas.map(c => c.id).sort(), antes.caixinhas.map(c => c.id).sort());
});

test('encontra custo removido e reserva fora da configuração, inclusive em retiradas anteriores na lista', () => {
  const projecao = projetarCatalogoCaixinhas(dados({
    historico: [
      turno('saida', { saidas: [retirada('antigo', 2), retirada('diaria:alface', 3), retirada('reserva2', 4), retirada('principal', 5)] }),
      turno('credito', { detalheCustosFixosDia: { antigo: 11.125 }, reservasDiariasDia: [reserva('alface', 'Alface', 12)], reservaInvestimento: 8 }),
    ],
  }));
  const custo = porId(projecao, 'fixo:antigo');
  const diaria = porId(projecao, 'diaria:alface');
  assert.equal(custo.configurada, false);
  assert.equal(custo.nomeConfigurado, undefined);
  assert.deepEqual(custo.evidencias.map(e => e.valor), [11.125, 2]);
  assert.equal(diaria.configurada, false);
  assert.deepEqual(diaria.evidencias.map(e => [e.nome, e.valor]), [['Alface', 12], ['Descrição da retirada', 3]]);
  assert.deepEqual(porId(projecao, 'reserva-fixa:reserva2').evidencias.map(e => e.fonte),
    ['configuracao', 'reserva-fixa', 'retirada']);
  assert.deepEqual(projecao.pendencias, []);
});

test('separa registros sem ID, duplicidades e origens ambíguas sem inferir vínculo por nome', () => {
  const projecao = projetarCatalogoCaixinhas(dados({
    custosFixos: [
      { id: 'reserva1', nome: 'Colisão', valorMensal: 0 },
      { id: 'duplicado', nome: 'A', valorMensal: 0 },
      { id: 'duplicado', nome: 'B', valorMensal: 0 },
    ],
    reservasDiarias: [reserva('valida', 'Carne', 0)],
    historico: [turno('a', {
      detalheCustosFixosDia: { duplicado: 5 },
      reservasDiariasDia: [reserva(undefined, 'Carne', 4), reserva('', 'Carne', 6),
        reserva('dupla', 'A', 1), reserva('dupla', 'B', 2)],
      saidas: [retirada('diaria:nome:Carne', 2), retirada('Carne', 3), retirada('diaria:desconhecida', 5),
        retirada('reserva1', 6), retirada('diaria:dupla', 7), retirada('duplicado', 8)],
    })],
  }));
  assert.equal(porId(projecao, 'diaria:valida').evidencias.length, 1);
  assert.equal(porId(projecao, 'diaria:dupla'), undefined);
  assert.equal(porId(projecao, 'fixo:duplicado'), undefined);
  assert.deepEqual(projecao.pendencias.filter(p => p.motivo === 'sem-id').map(p => p.evidencia.valor), [4, 6]);
  assert.deepEqual(projecao.pendencias.filter(p => p.evidencia.fonte === 'retirada')
    .map(p => [p.referencia, p.motivo]), [
    ['diaria:nome:Carne', 'origem-por-nome'], ['Carne', 'origem-sem-vinculo'],
    ['diaria:desconhecida', 'origem-sem-vinculo'], ['reserva1', 'origem-em-conflito'],
    ['diaria:dupla', 'id-duplicado'], ['duplicado', 'id-duplicado'],
  ]);
});

test('projeção repetida e leitura de JSON preservam histórico e totais, inclusive nas pendências', () => {
  const json = JSON.stringify(dados({
    reservasDiarias: undefined,
    historico: [
      turno('credito', { detalheCustosFixosDia: { antigo: 5.125 }, reservasDiariasDia: [
        reserva(undefined, 'Carne', 4), reserva(undefined, 'Carne', 9), reserva('unica', 'Carne', 6),
      ], reservaFevereiro: 7 }),
      turno('saida', { tipo: 'avulso_saida', faturamentoBruto: 0, combustivel: 0, kmTrabalhado: 0, litros: 0,
        saidas: [retirada('principal', 2), retirada('antigo', 1), retirada('diaria:nome:Carne', 3)] }),
    ],
  }));
  const entrada = lerDados(JSON.parse(json));
  function congelar(objeto) {
    Object.values(objeto).filter(v => v && typeof v === 'object').forEach(congelar);
    Object.freeze(objeto);
  }
  congelar(entrada);
  const antes = resumir(entrada.historico);
  const original = JSON.stringify(entrada);
  const projecao = projetarCatalogoCaixinhas(entrada);
  assert.deepEqual(projetarCatalogoCaixinhas(entrada), projecao);
  assert.deepEqual(projetarCatalogoCaixinhas(lerDados(JSON.parse(json))), projecao);
  assert.equal(JSON.stringify(entrada), original);
  assert.deepEqual(resumir(entrada.historico), antes);
  assert.equal(antes.liquido, 78);
  const evidencias = [...projecao.caixinhas.flatMap(c => c.evidencias), ...projecao.pendencias.map(p => p.evidencia)];
  const totalProjetado = evidencias.reduce((total, e) => {
    if (e.fonte === 'configuracao') return total;
    return total + (e.fonte === 'retirada' ? -e.valor : e.valor);
  }, 0);
  const totalLegado = [...Object.values(antes.caixinhas), ...Object.values(antes.reservas).map(r => r.valor)]
    .reduce((total, valor) => total + valor, 0);
  assert.equal(totalProjetado, totalLegado);
  assert.equal(totalProjetado, 27.125);
});
