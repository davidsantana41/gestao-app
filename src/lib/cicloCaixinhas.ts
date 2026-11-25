import type { IdCaixinha } from './catalogoCaixinhas';
import type { ReferenciaMovimentacao } from './referenciaMovimentacao';

export type CaixinhaCiclo = Readonly<{
  id: IdCaixinha;
  nome: string;
  finalidade: string;
  estado: 'ativa' | 'arquivada';
}>;

export type AcaoCaixinha = 'criar' | 'renomear' | 'arquivar' | 'reativar';

type MetadadosAuditoria = Readonly<{
  id: string;
  caixinhaId: IdCaixinha;
  autorUid: string;
  confirmadoEm: string;
}>;

export type EventoAuditoriaCaixinha = MetadadosAuditoria & Readonly<
  | { acao: 'criar'; nomeNovo: string; finalidade: string }
  | { acao: 'renomear'; nomeAnterior: string; nomeNovo: string; motivo: string }
  | { acao: 'arquivar'; nomeAnterior: string; motivo: string; transferenciaId?: string }
  | { acao: 'reativar'; nomeNovo: string; motivo: string }
  | { acao: 'conciliar'; movimentacao: ReferenciaMovimentacao; motivo: string }
>;

export function validarCicloCaixinha(
  acao: AcaoCaixinha, caixinha: CaixinhaCiclo | undefined,
  dados: { nome: string; motivo: string; saldo: number },
): string | undefined {
  const nome = dados.nome.trim();
  if (acao === 'criar') return nome ? undefined : 'Informe o nome da caixinha.';
  if (!caixinha) return 'Selecione uma caixinha.';
  const estadoEsperado = acao === 'reativar' ? 'arquivada' : 'ativa';
  if (caixinha.estado !== estadoEsperado) return 'A ação não está disponível para este estado.';
  if (acao === 'arquivar') {
    if (!Number.isFinite(dados.saldo)) return 'O saldo ainda precisa ser confirmado.';
    if (dados.saldo < 0) return 'Regularize o saldo negativo antes de arquivar.';
    if (dados.saldo > 0) return 'Saldo positivo exige transferência explícita para o Saldo principal ou outra caixinha ativa em uma etapa futura.';
  }
  if (!dados.motivo.trim()) return 'Informe o motivo.';
  if (acao === 'renomear' && (!nome || nome === caixinha.nome)) return 'Informe um nome novo.';
}
