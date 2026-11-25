import type { IdCaixinha } from './catalogoCaixinhas.ts';
import { lerDados, resumir } from './gestao.ts';
import { planejarAdocaoCaixinhas } from './integridadeCaixinhas.ts';
import { metadata } from './syncSession.ts';

type IdentidadePersistida = Readonly<{ id: IdCaixinha; idOriginal: string; familia: string }>;
type Fonte = 'principal' | 'nuvem-carregada' | 'local-antes-do-reinicio' | 'base-antes-do-reinicio';
type AcaoAdocao = 'propor-cadastro' | 'reutilizar' | 'revisar-colisao';

/** Prévia local de um JSON legado. Nenhuma versão é mesclada ou enviada. */
export function preverAdocaoLegada(
  backup: unknown, uid: string, catalogoAtual: readonly IdentidadePersistida[], fonte: Fonte = 'principal',
) {
  const arquivo = structuredClone(backup);
  if (!arquivo || typeof arquivo !== 'object' || Array.isArray(arquivo)) throw new Error('Backup inválido.');
  const raiz = arquivo as Record<string, unknown>;
  const fontes: Partial<Record<Fonte, unknown>> = {};
  if (raiz.schema === 'appcar-reset-backup-v1') {
    if (raiz.uid !== uid) throw new Error('Backup de outro proprietário.');
    fontes.principal = raiz.remote;
    fontes['local-antes-do-reinicio'] = raiz.local;
    fontes['base-antes-do-reinicio'] = raiz.base;
  } else if (raiz.schema !== undefined) {
    throw new Error('Use um JSON de exportação legada nesta prévia.');
  } else if ('conta' in raiz) {
    const conta = raiz.conta;
    if (!conta || typeof conta !== 'object' || !('identificador' in conta) || conta.identificador !== uid) {
      throw new Error('Backup de outro proprietário.');
    }
    fontes.principal = raiz.dadosEmUso;
    fontes['nuvem-carregada'] = raiz.ultimaVersaoNuvemCarregada;
  } else {
    fontes.principal = raiz;
  }
  const disponiveis = (Object.keys(fontes) as Fonte[]).filter(chave => {
    const versao = fontes[chave];
    return !!versao && typeof versao === 'object' && 'historico' in versao && Array.isArray(versao.historico);
  });
  if (!disponiveis.includes(fonte)) throw new Error('Versão solicitada indisponível no backup.');
  const dados = lerDados(fontes[fonte]);
  const plano = planejarAdocaoCaixinhas(dados);
  const porId = new Map<string, IdentidadePersistida[]>();
  const porOrigem = new Map<string, IdentidadePersistida[]>();
  for (const existente of catalogoAtual) {
    const origem = `${existente.familia}:${existente.idOriginal}`;
    for (const [indice, chave] of [[porId, existente.id], [porOrigem, origem]] as const) {
      const grupo = indice.get(chave) ?? [];
      grupo.push(existente);
      indice.set(chave, grupo);
    }
  }
  const identidades = plano.identidades.map(identidade => {
    const ids = porId.get(identidade.id) ?? [];
    const origens = porOrigem.get(identidade.id) ?? [];
    const acao: AcaoAdocao = !ids.length && !origens.length ? 'propor-cadastro'
      : ids.length === 1 && origens.length === 1 && ids[0] === origens[0]
        ? 'reutilizar' : 'revisar-colisao';
    return { ...identidade, acao };
  });
  const { faturamento, despesas, liquido } = resumir(dados.historico);
  return {
    fonte, disponiveis, versao: metadata(fontes[fonte]), identidades, pendencias: plano.pendencias,
    totais: [faturamento, despesas, liquido].every(Number.isFinite) ? { faturamento, despesas, liquido } : null,
    arquivo,
  };
}
