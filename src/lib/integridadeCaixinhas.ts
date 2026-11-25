import { projetarCatalogoCaixinhas, revisarPendenciasCaixinhas, type IdCaixinha } from './catalogoCaixinhas.ts';
import type { DadosPersistidos } from './gestao.ts';
import { reaisParaCentavos, somarCentavos } from './centavosFinanceiros.ts';
import { version } from './syncSession.ts';

type Catalogo = ReturnType<typeof projetarCatalogoCaixinhas>;

function evidenciaSemPosicao(evidencia: Catalogo['pendencias'][number]['evidencia']) {
  const campos = { ...evidencia } as typeof evidencia & { indice?: number };
  delete campos.indice;
  return campos;
}

function assinaturas(projecao: Catalogo) {
  const vinculos = new Map(projecao.caixinhas.map(c => [
    c.id, c.evidencias
      .filter(e => e.fonte !== 'reserva-fixa' || e.valor !== 0)
      .map(e => version(evidenciaSemPosicao(e))).sort(),
  ]));
  const pendencias = projecao.pendencias.map(p => version({
    ...p, evidencia: evidenciaSemPosicao(p.evidencia),
  })).sort();
  return { vinculos, pendencias };
}

export function caixinhasAfetadas(antes: DadosPersistidos, depois: DadosPersistidos) {
  const origem = assinaturas(projetarCatalogoCaixinhas(antes));
  const destino = assinaturas(projetarCatalogoCaixinhas(depois));
  const ids = [...new Set([...origem.vinculos.keys(), ...destino.vinculos.keys()])].filter(id =>
    version(origem.vinculos.get(id)) !== version(destino.vinculos.get(id)),
  );
  return { ids, alteraPendencias: version(origem.pendencias) !== version(destino.pendencias) };
}

export function planejarAdocaoCaixinhas(dados: DadosPersistidos) {
  const { caixinhas, pendencias } = projetarCatalogoCaixinhas(dados);
  const ordenar = (a: unknown, b: unknown) => {
    const primeira = version(a), segunda = version(b);
    return primeira < segunda ? -1 : Number(primeira > segunda);
  };
  return {
    versao: 1 as const,
    identidades: caixinhas.map(({ id, familia, idOriginal, nomeConfigurado, evidencias }) => ({
      id, familia, idOriginal, nomeConfigurado, evidencias: evidencias.map(evidenciaSemPosicao).sort(ordenar),
    })).sort((a, b) => ordenar(a.id, b.id)),
    pendencias: pendencias.map(p => ({ ...p, evidencia: evidenciaSemPosicao(p.evidencia) })).sort(ordenar),
  };
}

/** Atesta em centavos as evidências históricas da identidade explícita. */
export function saldoVerificavelEmCentavos(dados: DadosPersistidos, id: IdCaixinha) {
  const projecao = projetarCatalogoCaixinhas(dados);
  if (revisarPendenciasCaixinhas(dados, projecao).some(p => p.referencia === id || p.candidatos.some(c => c.caixinha.id === id))) {
    throw new Error('Há referências pendentes para esta caixinha. Saldo não atestado.');
  }
  const caixinha = projecao.caixinhas.find(c => c.id === id);
  return somarCentavos((caixinha?.evidencias ?? []).flatMap(e => {
    if (e.fonte === 'configuracao') return [];
    const valor = reaisParaCentavos(e.valor);
    if (valor < 0) throw new Error('Valor histórico negativo. Conciliação necessária.');
    return [e.fonte === 'retirada' ? -valor : valor];
  }));
}
