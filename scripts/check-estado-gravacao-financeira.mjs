import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decidirEstadoGravacao } from '../src/lib/estadoGravacaoFinanceira.ts';

const base = {
  gravavel: true,
  somenteLeitura: false,
  ocupado: false,
  aguardandoLeitura: false,
  temPendenciasFila: false,
  producao: true,
  conectada: true,
  filaLocalVerificada: true,
  quantidadeFilasLocais: 0,
  filaEstaAberta: false,
  filaAtualAberta: false,
};

test('owner online pode gravar no servidor sem desbloquear uma fila offline vazia', () => {
  assert.deepEqual(decidirEstadoGravacao(base), { modo: 'direto', podeSalvar: true });
});

test('fila criptografada aberta continua permitindo gravação offline', () => {
  const resultado = decidirEstadoGravacao({ ...base, conectada: false, filaEstaAberta: true, filaAtualAberta: true });
  assert.equal(resultado.modo, 'fila');
  assert.equal(resultado.podeSalvar, true);
});

test('fila aberta de geração anterior nunca é contornada por envio direto', () => {
  const resultado = decidirEstadoGravacao({ ...base, filaEstaAberta: true, filaAtualAberta: false });
  assert.equal(resultado.modo, 'bloqueado');
  assert.match(resultado.motivo, /geração anterior/);
});

test('fila local existente e fechada precisa ser desbloqueada antes de novas gravações', () => {
  const resultado = decidirEstadoGravacao({ ...base, quantidadeFilasLocais: 1 });
  assert.equal(resultado.modo, 'bloqueado');
  assert.match(resultado.motivo, /fila local protegida/);
});

test('owner offline sem fila aberta recebe o motivo e não pode gravar', () => {
  const resultado = decidirEstadoGravacao({ ...base, conectada: false });
  assert.equal(resultado.modo, 'bloqueado');
  assert.match(resultado.motivo, /Sem conexão/);
});

test('permissão de leitura não habilita gravação direta', () => {
  const resultado = decidirEstadoGravacao({ ...base, gravavel: false, somenteLeitura: true });
  assert.equal(resultado.podeSalvar, false);
  assert.match(resultado.motivo, /somente visualização/);
});

test('operação local pendente pausa o envio de outra operação', () => {
  const resultado = decidirEstadoGravacao({ ...base, temPendenciasFila: true, filaEstaAberta: true, filaAtualAberta: true });
  assert.equal(resultado.podeSalvar, false);
  assert.match(resultado.motivo, /aguardando confirmação/);
});

test('espaço local de emulador preserva a exigência da fila aberta', () => {
  const resultado = decidirEstadoGravacao({ ...base, producao: false });
  assert.equal(resultado.podeSalvar, false);
  assert.match(resultado.motivo, /Desbloqueie a fila/);
});
