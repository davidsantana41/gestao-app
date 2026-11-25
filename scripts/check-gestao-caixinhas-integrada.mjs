import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dadosPadrao } from '../src/lib/gestao.ts';
import {
  obterTodasCaixinhas,
  obterAuditoriaEspaco,
  executarCriarCaixinha,
  executarEditarCaixinha,
  executarArquivarCaixinha,
  executarReativarCaixinha,
  executarExcluirCaixinha,
  executarConciliarCaixinha,
} from '../src/lib/gestaoCaixinhasIntegrada.ts';

const turno = (id, campos) => ({
  id, data: '15/11/2026', diaSemana: 'domingo', tipo: 'turno',
  faturamentoBruto: 100, totalDespesas: 20, liquido: 80, combustivel: 5, litros: 1, kmTrabalhado: 10,
  ...campos,
});

test('criação de caixinha com ID permanente e auditoria', () => {
  const base = dadosPadrao();
  const alterado = executarCriarCaixinha(base, {
    nome: 'Manutenção Preventiva',
    finalidade: 'Troca de pneus e revisões',
    autorUid: 'user-123',
  });

  const { caixinhas } = obterTodasCaixinhas(alterado);
  const criada = caixinhas.find(c => c.nome === 'Manutenção Preventiva');

  assert.ok(criada, 'Caixinha deve existir');
  assert.ok(criada.id.startsWith('diaria:'), 'ID deve ser permanente com prefixo diaria:');
  assert.equal(criada.finalidade, 'Troca de pneus e revisões');
  assert.equal(criada.estado, 'ativa');
  assert.equal(criada.saldo, 0);
  assert.equal(criada.movimentos.length, 0);
  assert.equal(criada.podeExcluir, true, 'Sem movimentos, pode ser excluída');
  assert.equal(criada.podeArquivar, true, 'Com saldo zero, pode ser arquivada');

  const auditoria = obterAuditoriaEspaco(alterado);
  assert.equal(auditoria.length, 1);
  assert.equal(auditoria[0].acao, 'criar');
  assert.equal(auditoria[0].caixinhaId, criada.id);
  assert.equal(auditoria[0].autorUid, 'user-123');
});

test('homônimas: duas caixinhas com mesmo nome têm IDs permanentes diferentes e independentes', () => {
  let dados = dadosPadrao();
  dados = executarCriarCaixinha(dados, { nome: 'Reserva Especial', finalidade: 'Objetivo 1', autorUid: 'user-1' });
  dados = executarCriarCaixinha(dados, { nome: 'Reserva Especial', finalidade: 'Objetivo 2', autorUid: 'user-1' });

  const { caixinhas } = obterTodasCaixinhas(dados);
  const homonimas = caixinhas.filter(c => c.nome === 'Reserva Especial');

  assert.equal(homonimas.length, 2);
  assert.notEqual(homonimas[0].id, homonimas[1].id, 'IDs permanentes devem ser distintos');
});

test('edição e renomeação preservam histórico e registram auditoria', () => {
  let dados = dadosPadrao();
  dados = executarCriarCaixinha(dados, { nome: 'Pneus', finalidade: 'Troca futura', autorUid: 'user-1' });
  const { caixinhas } = obterTodasCaixinhas(dados);
  const criada = caixinhas.find(c => c.nome === 'Pneus');

  dados = executarEditarCaixinha(dados, {
    id: criada.id,
    nome: 'Pneus e Suspensão',
    finalidade: 'Troca de pneus e amortecedores',
    motivo: 'Ampliando escopo da caixinha',
    autorUid: 'user-1',
  });

  const { caixinhas: atualizadas } = obterTodasCaixinhas(dados);
  const editada = atualizadas.find(c => c.id === criada.id);

  assert.equal(editada.nome, 'Pneus e Suspensão');
  assert.equal(editada.finalidade, 'Troca de pneus e amortecedores');

  const auditoria = obterAuditoriaEspaco(dados);
  const eventoRenomear = auditoria.find(e => e.acao === 'renomear');
  assert.ok(eventoRenomear);
  assert.equal(eventoRenomear.nomeAnterior, 'Pneus');
  assert.equal(eventoRenomear.nomeNovo, 'Pneus e Suspensão');
  assert.equal(eventoRenomear.motivo, 'Ampliando escopo da caixinha');
});

test('regras de arquivamento: bloqueia saldo != 0 e permite quando saldo == 0', () => {
  let dados = dadosPadrao();
  dados = executarCriarCaixinha(dados, { nome: 'Fundo Viagem', finalidade: 'Férias', autorUid: 'user-1' });
  const { caixinhas } = obterTodasCaixinhas(dados);
  const criada = caixinhas.find(c => c.nome === 'Fundo Viagem');
  const idOriginal = criada.idOriginal;

  // 1. Simula entrada financeira na caixinha (saldo positivo = 50)
  const dadosComSaldo = {
    ...dados,
    historico: [
      turno('t1', { reservasDiariasDia: [{ id: idOriginal, nome: 'Fundo Viagem', valor: 50 }] }),
    ],
  };

  const { caixinhas: caixasComSaldo } = obterTodasCaixinhas(dadosComSaldo);
  const caixaComSaldo = caixasComSaldo.find(c => c.id === criada.id);
  assert.equal(caixaComSaldo.saldo, 50);
  assert.equal(caixaComSaldo.podeArquivar, false);
  assert.match(caixaComSaldo.motivoBloqueioArquivamento, /saldo positivo/);

  assert.throws(() => {
    executarArquivarCaixinha(dadosComSaldo, { id: criada.id, motivo: 'Tentando arquivar', autorUid: 'user-1' });
  }, /saldo positivo/);

  // 2. Agora zera o saldo com uma retirada de 50
  const dadosZerados = {
    ...dadosComSaldo,
    historico: [
      ...dadosComSaldo.historico,
      turno('t2', { saidas: [{ id: 's1', origem: criada.id, nome: 'Retirada férias', valor: 50 }] }),
    ],
  };

  const { caixinhas: caixasZeradas } = obterTodasCaixinhas(dadosZerados);
  const caixaZerada = caixasZeradas.find(c => c.id === criada.id);
  assert.equal(caixaZerada.saldo, 0);
  assert.equal(caixaZerada.podeArquivar, true);

  // 3. Arquiva a caixinha com saldo zerado
  const dadosArquivados = executarArquivarCaixinha(dadosZerados, {
    id: criada.id,
    motivo: 'Férias realizadas, caixinha concluída',
    autorUid: 'user-1',
  });

  const { caixinhas: caixasAposArquivar } = obterTodasCaixinhas(dadosArquivados);
  const caixaArquivada = caixasAposArquivar.find(c => c.id === criada.id);
  assert.equal(caixaArquivada.estado, 'arquivada');

  const auditoria = obterAuditoriaEspaco(dadosArquivados);
  const eventoArquivar = auditoria.find(e => e.acao === 'arquivar');
  assert.ok(eventoArquivar);
  assert.equal(eventoArquivar.motivo, 'Férias realizadas, caixinha concluída');

  // 4. Reativa a caixinha arquivada
  const dadosReativados = executarReativarCaixinha(dadosArquivados, {
    id: criada.id,
    motivo: 'Planejando nova viagem',
    autorUid: 'user-1',
  });

  const { caixinhas: caixasReativadas } = obterTodasCaixinhas(dadosReativados);
  const caixaReativada = caixasReativadas.find(c => c.id === criada.id);
  assert.equal(caixaReativada.estado, 'ativa');
});

test('regras de exclusão: bloqueia exclusão quando há histórico e permite quando não há', () => {
  let dados = dadosPadrao();
  dados = executarCriarCaixinha(dados, { nome: 'Caixinha Com Histórico', finalidade: 'Teste', autorUid: 'user-1' });
  dados = executarCriarCaixinha(dados, { nome: 'Caixinha Sem Histórico', finalidade: 'Teste', autorUid: 'user-1' });

  const { caixinhas } = obterTodasCaixinhas(dados);
  const comHistorico = caixinhas.find(c => c.nome === 'Caixinha Com Histórico');
  const semHistorico = caixinhas.find(c => c.nome === 'Caixinha Sem Histórico');

  // Adiciona movimentação para a primeira
  dados = {
    ...dados,
    historico: [
      turno('t1', { reservasDiariasDia: [{ id: comHistorico.idOriginal, nome: 'Caixinha Com Histórico', valor: 10 }] }),
    ],
  };

  const { caixinhas: caixasChecadas } = obterTodasCaixinhas(dados);
  const checadaComHist = caixasChecadas.find(c => c.id === comHistorico.id);
  const checadaSemHist = caixasChecadas.find(c => c.id === semHistorico.id);

  assert.equal(checadaComHist.podeExcluir, false);
  assert.match(checadaComHist.motivoBloqueioExclusao, /histórico/);
  assert.throws(() => {
    executarExcluirCaixinha(dados, { id: comHistorico.id, autorUid: 'user-1' });
  }, /histórico/);

  assert.equal(checadaSemHist.podeExcluir, true);
  const dadosAposExclusao = executarExcluirCaixinha(dados, { id: semHistorico.id, autorUid: 'user-1' });
  const { caixinhas: caixasFinais } = obterTodasCaixinhas(dadosAposExclusao);
  assert.equal(caixasFinais.some(c => c.id === semHistorico.id), false);
});

test('conciliação vincula pendência sem alterar o histórico original e registra na auditoria', () => {
  // Lançamento legado com saída por nome não vinculado
  let dados = {
    ...dadosPadrao(),
    historico: [
      turno('t-legado', {
        saidas: [{ id: 's-legada', origem: 'diaria:nome:Alimentacao', nome: 'Almoço na estrada', valor: 25 }],
      }),
    ],
  };

  // Verifica que há pendência ativa
  const antes = obterTodasCaixinhas(dados);
  assert.ok(antes.pendencias.length > 0, 'Deve ter pendência de referência por nome');
  const pendencia = antes.pendencias[0];
  assert.equal(pendencia.valor, 25);

  // Cria caixinha destino
  dados = executarCriarCaixinha(dados, { nome: 'Alimentação', finalidade: 'Refeições', autorUid: 'user-1' });
  const { caixinhas } = obterTodasCaixinhas(dados);
  const caixinhaAlvo = caixinhas.find(c => c.nome === 'Alimentação');

  // Executa conciliação
  const historicoAntes = JSON.stringify(dados.historico);
  const dadosConciliados = executarConciliarCaixinha(dados, {
    pendencia,
    caixinhaId: caixinhaAlvo.id,
    motivo: 'Vinculando retirada legada à caixinha permanente de Alimentação',
    autorUid: 'user-1',
  });

  // O lançamento histórico original NÃO deve ter sido modificado
  assert.equal(JSON.stringify(dadosConciliados.historico), historicoAntes, 'Histórico original intacto');

  // A pendência foi resolvida e não aparece mais na lista de pendências
  const depois = obterTodasCaixinhas(dadosConciliados);
  assert.equal(depois.pendencias.length, 0, 'Pendência deve ter sido resolvida');

  // A movimentação agora integra a caixinha alvo
  const caixinhaAtualizada = depois.caixinhas.find(c => c.id === caixinhaAlvo.id);
  assert.equal(caixinhaAtualizada.movimentos.length, 1);
  assert.equal(caixinhaAtualizada.saldo, -25);

  // Auditoria registrou o vínculo
  const auditoria = obterAuditoriaEspaco(dadosConciliados);
  const eventoConciliar = auditoria.find(e => e.acao === 'conciliar');
  assert.ok(eventoConciliar);
  assert.equal(eventoConciliar.caixinhaId, caixinhaAlvo.id);
  assert.equal(eventoConciliar.motivo, 'Vinculando retirada legada à caixinha permanente de Alimentação');
  assert.equal(eventoConciliar.vinculo.valor, 25);
});
