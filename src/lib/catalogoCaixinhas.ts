import type { DadosPersistidos, Lancamento } from './gestao';

type Familia = 'fixo' | 'diaria' | 'reserva-fixa';
export type IdCaixinha = `${Familia}:${string}`;
type ReservaFixa = 'reserva1' | 'reserva2' | 'reserva3';

type Evidencia =
  | { fonte: 'configuracao'; indice: number; nome: string; valor?: number }
  | { fonte: 'rateio' | 'reserva-fixa'; lancamentoId: string; data: string; valor: number }
  | { fonte: 'reserva-diaria'; lancamentoId: string; data: string; indice: number; nome: string; valor: number }
  | { fonte: 'retirada'; lancamentoId: string; data: string; indice: number; retiradaId: string; origem: string; nome: string; valor: number };

type CaixinhaProjetada = Readonly<{
  id: IdCaixinha;
  familia: Familia;
  idOriginal: string;
  configurada: boolean;
  nomeConfigurado?: string;
  evidencias: readonly Readonly<Evidencia>[];
}>;

type Pendencia = Readonly<{
  motivo: 'sem-id' | 'id-duplicado' | 'origem-por-nome' | 'origem-sem-vinculo' | 'origem-em-conflito';
  referencia?: string;
  referenciaOriginal?: string;
  evidencia: Readonly<Evidencia>;
}>;

const reservasFixas = [
  ['reserva1', 'nomeReserva1', 'reservaFevereiro'],
  ['reserva2', 'nomeReserva2', 'reservaInvestimento'],
  ['reserva3', 'nomeReserva3', 'reservaAcidente'],
] as const satisfies readonly [ReservaFixa, keyof DadosPersistidos, keyof Lancamento][];

const chave = (familia: Familia, id: string): IdCaixinha => `${familia}:${id}`;
const temId = (id: unknown): id is string => typeof id === 'string' && id.trim().length > 0;

function idsDuplicados(itens: readonly { id?: unknown }[]) {
  const vistos = new Set<string>();
  const duplicados = new Set<string>();
  for (const { id } of itens) {
    if (!temId(id)) continue;
    if (vistos.has(id)) duplicados.add(id);
    vistos.add(id);
  }
  return duplicados;
}

/** Projeção por conta. As evidências preservam valores e nomes da origem. */
export function projetarCatalogoCaixinhas(dados: DadosPersistidos): Readonly<{
  caixinhas: readonly CaixinhaProjetada[];
  pendencias: readonly Pendencia[];
}> {
  const caixinhas = new Map<IdCaixinha, Omit<CaixinhaProjetada, 'evidencias'> & {
    evidencias: Evidencia[];
  }>();
  const pendencias: Pendencia[] = [];
  const custos = dados.custosFixos;
  const diarias = dados.reservasDiarias ?? [];
  const duplicados = new Set<IdCaixinha>();
  const paisDuplicados = idsDuplicados(dados.historico);

  for (const id of idsDuplicados(custos)) duplicados.add(chave('fixo', id));
  for (const lista of [diarias, ...dados.historico.map(h => h.reservasDiariasDia ?? [])]) {
    for (const id of idsDuplicados(lista)) duplicados.add(chave('diaria', id));
  }

  function registrar(familia: Familia, idOriginal: unknown, evidencia: Evidencia) {
    if (!temId(idOriginal)) {
      pendencias.push({ motivo: 'sem-id', referencia: typeof idOriginal === 'string' ? idOriginal : undefined, evidencia });
      return;
    }
    const id = chave(familia, idOriginal);
    if (duplicados.has(id)) {
      pendencias.push({ motivo: 'id-duplicado', referencia: id, referenciaOriginal: idOriginal, evidencia });
      return;
    }
    if (familia === 'diaria' && idOriginal.startsWith('nome:')) {
      pendencias.push({ motivo: 'origem-por-nome', referencia: id, referenciaOriginal: idOriginal, evidencia });
      return;
    }
    if ('lancamentoId' in evidencia && (!temId(evidencia.lancamentoId) || paisDuplicados.has(evidencia.lancamentoId))) {
      pendencias.push({
        motivo: temId(evidencia.lancamentoId) ? 'id-duplicado' : 'sem-id',
        referencia: id, referenciaOriginal: idOriginal, evidencia,
      });
      return;
    }
    const existente = caixinhas.get(id);
    if (existente) {
      existente.evidencias.push(evidencia);
      return;
    }
    caixinhas.set(id, {
      id, idOriginal, familia,
      configurada: evidencia.fonte === 'configuracao',
      nomeConfigurado: evidencia.fonte === 'configuracao' ? evidencia.nome : undefined,
      evidencias: [evidencia],
    });
  }

  custos.forEach((c, indice) => registrar('fixo', c.id, {
    fonte: 'configuracao', indice, nome: c.nome, valor: c.valorMensal,
  }));
  diarias.forEach((r, indice) => registrar('diaria', r.id, {
    fonte: 'configuracao', indice, nome: r.nome, valor: r.valor,
  }));
  reservasFixas.forEach(([id, nome], indice) => registrar('reserva-fixa', id, {
    fonte: 'configuracao', indice, nome: dados[nome],
  }));

  // Uma retirada só pode ser vinculada depois de levantar as referências
  // independentes da configuração e de todos os lançamentos.
  for (const h of dados.historico) {
    const origem = { lancamentoId: h.id, data: h.data };
    for (const [id, valor] of Object.entries(h.detalheCustosFixosDia ?? {})) {
      registrar('fixo', id, { ...origem, fonte: 'rateio', valor });
    }
    h.reservasDiariasDia?.forEach((r, indice) => registrar('diaria', r.id, {
      ...origem, fonte: 'reserva-diaria', indice, nome: r.nome, valor: r.valor,
    }));
    for (const [id, , campo] of reservasFixas) {
      if (h[campo] !== undefined) {
        registrar('reserva-fixa', id, { ...origem, fonte: 'reserva-fixa', valor: h[campo] });
      }
    }
  }

  for (const h of dados.historico) {
    const saidasDuplicadas = idsDuplicados(h.saidas ?? []);
    h.saidas?.forEach((s, indice) => {
      if (s.origem === 'principal') return;
      const evidencia: Evidencia = {
        fonte: 'retirada', lancamentoId: h.id, data: h.data, indice,
        retiradaId: s.id, origem: s.origem, nome: s.nome, valor: s.valor,
      };
      const referencia = s.origem;
      if (!temId(referencia)) {
        pendencias.push({ motivo: 'sem-id', referencia, evidencia });
        return;
      }
      const fixo = chave('fixo', referencia);
      const reservaFixa = caixinhas.get(chave('reserva-fixa', referencia));
      if (reservaFixa && (caixinhas.has(fixo) || duplicados.has(fixo))) {
        pendencias.push({ motivo: 'origem-em-conflito', referencia, evidencia });
        return;
      }
      const diaria = referencia.startsWith('diaria:');
      const idDiaria = diaria ? referencia.slice('diaria:'.length) : '';
      if (diaria && (caixinhas.has(fixo) || duplicados.has(fixo))) {
        pendencias.push({ motivo: 'origem-em-conflito', referencia, evidencia });
        return;
      }
      const id = diaria ? chave('diaria', idDiaria) : fixo;
      if (diaria && !temId(idDiaria)) {
        pendencias.push({ motivo: 'sem-id', referencia, evidencia });
      } else if (diaria && idDiaria.startsWith('nome:')) {
        pendencias.push({ motivo: 'origem-por-nome', referencia, evidencia });
      } else if (!temId(h.id) || !temId(s.id) || paisDuplicados.has(h.id) || saidasDuplicadas.has(s.id)) {
        pendencias.push({
          motivo: !temId(h.id) || !temId(s.id) ? 'sem-id' : 'id-duplicado',
          referencia: reservaFixa?.id ?? id, evidencia,
        });
      } else if (duplicados.has(id)) {
        pendencias.push({ motivo: 'id-duplicado', referencia, evidencia });
      } else {
        const destino = reservaFixa ?? caixinhas.get(id);
        if (destino) destino.evidencias.push(evidencia);
        else pendencias.push({ motivo: 'origem-sem-vinculo', referencia, evidencia });
      }
    });
  }

  return { caixinhas: [...caixinhas.values()], pendencias };
}

/** Sugestões exibidas para consulta. Nenhuma delas resolve uma pendência. */
export function revisarPendenciasCaixinhas(dados: DadosPersistidos, projecao = projetarCatalogoCaixinhas(dados)) {
  const { caixinhas, pendencias } = projecao;
  const porId = new Map<string, CaixinhaProjetada>(caixinhas.map(c => [c.id, c]));
  const porNome = new Map<string, CaixinhaProjetada[]>();

  for (const caixinha of caixinhas) {
    const nomes = new Set(caixinha.evidencias.flatMap(e =>
      (e.fonte === 'configuracao' || e.fonte === 'reserva-diaria') && e.nome ? [e.nome] : [],
    ));
    for (const nome of nomes) {
      const grupo = porNome.get(nome) ?? [];
      grupo.push(caixinha);
      porNome.set(nome, grupo);
    }
  }

  return pendencias.map(pendencia => {
    const { evidencia, referencia, motivo } = pendencia;
    const referenciaOriginal = evidencia.fonte === 'retirada'
      ? evidencia.origem : pendencia.referenciaOriginal ?? referencia;
    const candidatos = new Map<IdCaixinha, {
      caixinha: CaixinhaProjetada;
      criterio: 'referencia' | 'nome';
    }>();

    if (motivo === 'origem-em-conflito' && referencia) {
      for (const id of [`fixo:${referencia}`, `reserva-fixa:${referencia}`, referencia]) {
        const caixinha = porId.get(id);
        if (caixinha) candidatos.set(caixinha.id, { caixinha, criterio: 'referencia' });
      }
    }

    let nome: string | undefined;
    if (motivo === 'origem-por-nome') nome = referencia?.slice('diaria:nome:'.length);
    if (motivo === 'origem-sem-vinculo' && !referencia?.startsWith('diaria:')) nome = referencia;
    if (motivo === 'sem-id' && evidencia.fonte === 'reserva-diaria') nome = evidencia.nome;
    for (const caixinha of nome ? porNome.get(nome) ?? [] : []) {
      candidatos.set(caixinha.id, { caixinha, criterio: 'nome' });
    }

    return { ...pendencia, referenciaOriginal, candidatos: [...candidatos.values()] };
  });
}
