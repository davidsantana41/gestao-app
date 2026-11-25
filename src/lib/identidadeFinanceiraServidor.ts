import type { ComandoFinanceiroValidado } from './comandoFinanceiro.ts';

export type VerificadorFirebaseServidor = {
  verifyIdToken(token: string, checkRevoked: true): Promise<{
    uid: string; sub: string; aud: string; iss: string; exp: number;
  }>;
};

/** Adaptador para Firebase Admin Auth. O verificador deve vir da infraestrutura do servidor. */
export function criarAutenticadorFirebase(verificador: VerificadorFirebaseServidor, projeto: string) {
  if (!projeto || projeto !== projeto.trim()) throw new Error('Projeto de identidade inválido.');
  return async (authorization: string | undefined) => {
    const token = /^Bearer ([\w.-]{1,8192})$/.exec(authorization ?? '')?.[1];
    if (!token) throw new Error('Sessão inválida.');
    try {
      const identidade = await verificador.verifyIdToken(token, true);
      const { uid, sub, aud, iss, exp } = identidade;
      if (typeof uid !== 'string' || !uid || uid.length > 128 || uid !== sub || aud !== projeto
          || iss !== `https://securetoken.google.com/${projeto}`
          || !Number.isSafeInteger(exp) || exp <= Math.floor(Date.now() / 1000)) throw new Error('Token inválido.');
      return Object.freeze({ uid });
    } catch {
      throw new Error('Sessão inválida.');
    }
  };
}

export type ControleFinanceiro = Readonly<{
  proprietarioUid: string;
  comandosFinanceiros: boolean;
  operacoesFinanceiras: readonly ComandoFinanceiroValidado['tipo'][];
}>;

export function podeExecutarComandoFinanceiro(
  uid: string, controle: Partial<ControleFinanceiro> | undefined, operacao: ComandoFinanceiroValidado['tipo'],
) {
  return controle?.proprietarioUid === uid && controle.comandosFinanceiros === true
    && Array.isArray(controle.operacoesFinanceiras) && controle.operacoesFinanceiras.includes(operacao);
}

type OperacaoAdministrativa = 'provisionar' | 'backup' | 'restaurar' | 'reiniciar' | 'manter';

/** Guarda para a futura camada administrativa. A concessão é lida de fonte privada no servidor. */
export function exigirOperacaoAdministrativa(opcoes: {
  uidVerificado: string;
  proprietarioUid: string;
  operacao: OperacaoAdministrativa;
  concessao: Readonly<{ uid: string; operacoes: readonly OperacaoAdministrativa[] }> | undefined;
  espacoId: string;
  espacoDaConcessao: string;
  confirmacao?: Readonly<{ uid: string; espacoId: string; operacao: OperacaoAdministrativa; geracao: number; revisao: number; backupConferido: boolean }>;
  atual?: Readonly<{ generation: number; revision: number }>;
}) {
  const { uidVerificado, proprietarioUid, operacao, concessao, espacoId, espacoDaConcessao, confirmacao, atual } = opcoes;
  if (!uidVerificado || proprietarioUid !== uidVerificado || !espacoId || espacoId !== espacoDaConcessao
      || concessao?.uid !== uidVerificado || !Array.isArray(concessao.operacoes)
      || !concessao.operacoes.includes(operacao)) throw new Error('Operação administrativa não autorizada.');
  if (operacao === 'provisionar') {
    if (atual) throw new Error('O espaço já foi provisionado.');
    return;
  }
  if (!atual) throw new Error('Espaço indisponível.');
  if (operacao !== 'backup' && (!confirmacao || confirmacao.uid !== uidVerificado || confirmacao.espacoId !== espacoId
      || confirmacao.operacao !== operacao || confirmacao.backupConferido !== true
      || confirmacao.geracao !== atual.generation || confirmacao.revisao !== atual.revision)) {
    throw new Error('Confirmação administrativa desatualizada ou incompleta.');
  }
}
