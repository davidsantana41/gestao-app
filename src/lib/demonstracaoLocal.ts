import type { IdCaixinha } from './catalogoCaixinhas';
import type { CaixinhaCiclo } from './cicloCaixinhas';
import type { DadosPersistidos } from './gestao';

export type PerfilDemonstracao = { nome?: string; nascimento?: string; email: string; celular?: string };
export type VeiculoDemonstracao = {
  id: string; placa: string; km: number; marca?: string; modelo?: string; versao?: string;
  anoFabricacao?: number; anoModelo?: number; combustivel?: string; cor?: string;
};
export const combustiveisDemonstracao = ['Flex', 'Gasolina', 'Etanol', 'Diesel', 'GNV', 'Híbrido', 'Elétrico'] as const;
export type CaixinhaDemonstracao = CaixinhaCiclo & { saldo: number | null; versao: number };
export type EventoDemonstracao = { id: string; acao: string; caixinhaId: IdCaixinha; autorUid: string;
  confirmadoEm: string; motivo: string | null; antes: { nome: string } | null; depois: { nome: string } };
export type EstadoDemonstracao = {
  perfil: PerfilDemonstracao; veiculos: VeiculoDemonstracao[]; financeiro: DadosPersistidos;
  caixinhas: CaixinhaDemonstracao[]; eventos: EventoDemonstracao[];
};
