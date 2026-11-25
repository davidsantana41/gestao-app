import { projetarCatalogoCaixinhas, revisarPendenciasCaixinhas, type IdCaixinha } from './catalogoCaixinhas.ts';
import { reaisParaCentavos, centavosParaReais, somarCentavos } from './centavosFinanceiros.ts';
import { moeda, type DadosPersistidos, type ReservaDiariaItem, type CustoFixoItem } from './gestao.ts';

export type EventoAuditoriaCaixinha = {
  id: string;
  acao: 'criar' | 'renomear' | 'arquivar' | 'reativar' | 'excluir' | 'conciliar';
  caixinhaId: IdCaixinha;
  autorUid: string;
  confirmadoEm: string;
  motivo?: string;
  nomeAnterior?: string;
  nomeNovo?: string;
  finalidade?: string;
  saldoVerificado?: number | null;
  vinculo?: {
    referenciaSha256: string;
    lancamentoId?: string;
    fonte: string;
    valor: number;
    descricao?: string;
  };
};

export type VinculoRegistrado = {
  id: string;
  caixinhaId: IdCaixinha;
  lancamentoId?: string;
  fonte: string;
  valor: number;
  descricao?: string;
  data?: string;
  referenciaOriginal?: string;
  confirmadoEm: string;
  autorUid: string;
  motivo: string;
};

export type MovimentoCaixinha = {
  id: string;
  tipo: 'provisao-diaria' | 'rateio-fixo' | 'reserva-fixa' | 'retirada' | 'conciliacao';
  lancamentoId?: string;
  data: string;
  descricao: string;
  valor: number; // positivo para entradas/créditos, negativo para saídas/retiradas
};

export type CaixinhaCompleta = {
  id: IdCaixinha;
  familia: 'diaria' | 'fixo' | 'reserva-fixa';
  idOriginal: string;
  nome: string;
  finalidade: string;
  estado: 'ativa' | 'arquivada';
  editavel?: boolean;
  criadoEm?: string;
  saldo: number;
  saldoCentavos: number;
  saldoAtestado: boolean;
  motivoSaldoNaoAtestado?: string;
  totalCreditos: number;
  totalDebitos: number;
  movimentos: MovimentoCaixinha[];
  auditoria: EventoAuditoriaCaixinha[];
  podeArquivar: boolean;
  motivoBloqueioArquivamento?: string;
  podeExcluir: boolean;
  motivoBloqueioExclusao?: string;
};

export type PendenciaRevisao = {
  id: string;
  motivo: string;
  motivoDescricao: string;
  fonte: string;
  fonteDescricao: string;
  data?: string;
  valor: number;
  descricao: string;
  referenciaOriginal?: string;
  lancamentoId?: string;
  retiradaId?: string;
  candidatos: { id: IdCaixinha; nome: string; criterio: string }[];
  evidenciaRaw: unknown;
  referenciaVerificada?: string | null;
};

export type ReservaDiariaItemEstendido = ReservaDiariaItem & {
  finalidade?: string;
  estado?: 'ativa' | 'arquivada';
  criadoEm?: string;
  auditoria?: EventoAuditoriaCaixinha[];
  vinculos?: VinculoRegistrado[];
};

export type CustoFixoItemEstendido = CustoFixoItem & {
  finalidade?: string;
  estado?: 'ativa' | 'arquivada';
  criadoEm?: string;
  auditoria?: EventoAuditoriaCaixinha[];
  vinculos?: VinculoRegistrado[];
};

const rotulosMotivos: Record<string, string> = {
  'sem-id': 'Registro sem identificador',
  'id-duplicado': 'Identificador duplicado',
  'origem-por-nome': 'Referência legada por nome',
  'origem-sem-vinculo': 'Origem sem vínculo comprovável',
  'origem-em-conflito': 'Referência em conflito',
};

const rotulosFontes: Record<string, string> = {
  configuracao: 'Configuração',
  rateio: 'Rateio de custo fixo',
  'reserva-fixa': 'Reserva fixa',
  'reserva-diaria': 'Reserva diária',
  retirada: 'Retirada',
};

export function obterVinculosEspaco(dados: DadosPersistidos): VinculoRegistrado[] {
  const vinculos: VinculoRegistrado[] = [];
  const diarias = (dados.reservasDiarias ?? []) as ReservaDiariaItemEstendido[];
  for (const r of diarias) {
    if (Array.isArray(r.vinculos)) vinculos.push(...r.vinculos);
  }
  const fixos = (dados.custosFixos ?? []) as CustoFixoItemEstendido[];
  for (const f of fixos) {
    if (Array.isArray(f.vinculos)) vinculos.push(...f.vinculos);
  }
  return vinculos;
}

export function obterAuditoriaEspaco(dados: DadosPersistidos): EventoAuditoriaCaixinha[] {
  const eventos: EventoAuditoriaCaixinha[] = [];
  const diarias = (dados.reservasDiarias ?? []) as ReservaDiariaItemEstendido[];
  for (const r of diarias) {
    if (Array.isArray(r.auditoria)) eventos.push(...r.auditoria);
  }
  const fixos = (dados.custosFixos ?? []) as CustoFixoItemEstendido[];
  for (const f of fixos) {
    if (Array.isArray(f.auditoria)) eventos.push(...f.auditoria);
  }
  return eventos.sort((a, b) => new Date(b.confirmadoEm).getTime() - new Date(a.confirmadoEm).getTime());
}

export function obterTodasCaixinhas(dados: DadosPersistidos, servidor?: {
  catalogoComplementar: DadosPersistidos;
  vinculos: VinculoRegistrado[];
  referencias: readonly (string | null)[];
  confirmados: ReadonlySet<string>;
}): {
  caixinhas: CaixinhaCompleta[];
  pendencias: PendenciaRevisao[];
  totalSaldoCentavos: number;
  totalAtivas: number;
  totalArquivadas: number;
  totalPendencias: number;
} {
  const projecao = projetarCatalogoCaixinhas(dados);
  const pendenciasBrutas = revisarPendenciasCaixinhas(dados, projecao);
  const vinculos = servidor?.vinculos ?? obterVinculosEspaco(dados);
  const vinculosPorCaixinha = new Map<IdCaixinha, VinculoRegistrado[]>();
  const chavesVinculadas = new Set<string>();

  for (const v of vinculos) {
    chavesVinculadas.add(v.id);
    const lista = vinculosPorCaixinha.get(v.caixinhaId) ?? [];
    lista.push(v);
    vinculosPorCaixinha.set(v.caixinhaId, lista);
  }

  // Pendências que ainda não foram conciliadas
  const pendenciasAtivas: PendenciaRevisao[] = [];
  for (let idx = 0; idx < pendenciasBrutas.length; idx++) {
    const p = pendenciasBrutas[idx];
    const e = p.evidencia;
    const chaveUnica = `${p.motivo}-${p.referenciaOriginal ?? p.referencia ?? ''}-${'lancamentoId' in e ? e.lancamentoId : ''}-${'indice' in e ? e.indice : idx}`;
    const referenciaVerificada = servidor?.referencias[idx];
    if (servidor ? referenciaVerificada && servidor.confirmados.has(referenciaVerificada) : chavesVinculadas.has(chaveUnica)) continue;

    const candidatos = p.candidatos.map(({ caixinha, criterio }) => ({
      id: caixinha.id,
      nome: caixinha.nomeConfigurado || caixinha.id,
      criterio: criterio === 'nome' ? 'Mesmo nome' : 'Referência compatível',
    }));

    pendenciasAtivas.push({
      id: chaveUnica,
      motivo: p.motivo,
      motivoDescricao: rotulosMotivos[p.motivo] || p.motivo,
      fonte: e.fonte,
      fonteDescricao: rotulosFontes[e.fonte] || e.fonte,
      data: 'data' in e ? e.data : undefined,
      valor: e.valor ?? 0,
      descricao: ('nome' in e ? e.nome : undefined) || 'Movimentação sem descrição',
      referenciaOriginal: p.referenciaOriginal || p.referencia,
      lancamentoId: 'lancamentoId' in e ? e.lancamentoId : undefined,
      retiradaId: e.fonte === 'retirada' ? e.retiradaId : undefined,
      candidatos,
      evidenciaRaw: e,
      referenciaVerificada,
    });
  }

  const idsComPendencias = new Set<IdCaixinha>();
  for (const p of pendenciasAtivas) {
    for (const c of p.candidatos) idsComPendencias.add(c.id);
  }

  const configuracao = servidor?.catalogoComplementar ?? dados;
  const diariasMap = new Map<string, ReservaDiariaItemEstendido>(
    ((configuracao.reservasDiarias ?? []) as ReservaDiariaItemEstendido[]).map(r => [r.id, r]),
  );
  const fixosMap = new Map<string, CustoFixoItemEstendido>(
    (configuracao.custosFixos as CustoFixoItemEstendido[]).map(f => [f.id, f]),
  );

  const nomesReservaFixa: Record<string, string> = {
    reserva1: dados.nomeReserva1 || 'Reserva 1',
    reserva2: dados.nomeReserva2 || 'Reserva 2',
    reserva3: dados.nomeReserva3 || 'Reserva 3',
  };

  // Coleta todas as caixinhas projetadas + cadastradas
  const idsCaixinhas = new Set<IdCaixinha>(projecao.caixinhas.map(c => c.id));
  for (const r of diariasMap.values()) {
    idsCaixinhas.add(`diaria:${r.id}`);
  }
  for (const f of fixosMap.values()) {
    idsCaixinhas.add(`fixo:${f.id}`);
  }
  idsCaixinhas.add('reserva-fixa:reserva1');
  idsCaixinhas.add('reserva-fixa:reserva2');
  idsCaixinhas.add('reserva-fixa:reserva3');

  const caixinhas: CaixinhaCompleta[] = [];
  let totalSaldoCentavos = 0;
  let totalAtivas = 0;
  let totalArquivadas = 0;

  for (const id of idsCaixinhas) {
    const proj = projecao.caixinhas.find(c => c.id === id);
    const partes = id.split(':');
    const familia = partes[0] as 'diaria' | 'fixo' | 'reserva-fixa';
    const idOriginal = partes.slice(1).join(':');

    let nome: string = id;
    let finalidade = '';
    let estado: 'ativa' | 'arquivada' = 'ativa';
    let criadoEm: string | undefined;
    let auditoria: EventoAuditoriaCaixinha[] = [];

    if (familia === 'diaria') {
      const item = diariasMap.get(idOriginal);
      if (item) {
        nome = item.nome || proj?.nomeConfigurado || id;
        finalidade = item.finalidade || '';
        estado = item.estado === 'arquivada' ? 'arquivada' : 'ativa';
        criadoEm = item.criadoEm;
        auditoria = item.auditoria ?? [];
      } else {
        nome = proj?.nomeConfigurado || idOriginal;
      }
    } else if (familia === 'fixo') {
      const item = fixosMap.get(idOriginal);
      if (item) {
        nome = item.nome || proj?.nomeConfigurado || id;
        finalidade = item.finalidade || '';
        estado = item.estado === 'arquivada' ? 'arquivada' : 'ativa';
        criadoEm = item.criadoEm;
        auditoria = item.auditoria ?? [];
      } else {
        nome = proj?.nomeConfigurado || idOriginal;
      }
    } else {
      nome = nomesReservaFixa[idOriginal] || id;
      // Procura metadados gravados para reserva fixa
      const metaItem = diariasMap.get(`meta:${id}`);
      if (metaItem) {
        finalidade = metaItem.finalidade || '';
        estado = metaItem.estado === 'arquivada' ? 'arquivada' : 'ativa';
        auditoria = metaItem.auditoria ?? [];
      }
    }

    const movimentos: MovimentoCaixinha[] = [];
    const evidencias = proj?.evidencias ?? [];

    for (let idx = 0; idx < evidencias.length; idx++) {
      const e = evidencias[idx];
      if (e.fonte === 'configuracao') continue;
      if (e.fonte === 'reserva-diaria') {
        movimentos.push({
          id: `${e.lancamentoId}-reserva-${e.indice}`,
          tipo: 'provisao-diaria',
          lancamentoId: e.lancamentoId,
          data: e.data,
          descricao: e.nome ? `Reserva diária: ${e.nome}` : 'Reserva diária',
          valor: e.valor,
        });
      } else if (e.fonte === 'rateio') {
        movimentos.push({
          id: `${e.lancamentoId}-rateio-${idOriginal}`,
          tipo: 'rateio-fixo',
          lancamentoId: e.lancamentoId,
          data: e.data,
          descricao: `Rateio do turno (${e.data})`,
          valor: e.valor,
        });
      } else if (e.fonte === 'reserva-fixa') {
        if (e.valor !== 0) {
          movimentos.push({
            id: `${e.lancamentoId}-reserva-fixa-${idOriginal}`,
            tipo: 'reserva-fixa',
            lancamentoId: e.lancamentoId,
            data: e.data,
            descricao: `Provisão fixa (${nomesReservaFixa[idOriginal] || idOriginal})`,
            valor: e.valor,
          });
        }
      } else if (e.fonte === 'retirada') {
        movimentos.push({
          id: `${e.lancamentoId}-retirada-${e.retiradaId}`,
          tipo: 'retirada',
          lancamentoId: e.lancamentoId,
          data: e.data,
          descricao: e.nome ? `Retirada: ${e.nome}` : 'Retirada de caixinha',
          valor: -e.valor,
        });
      }
    }

    // Movimentações resultantes de vínculos conciliados
    const vinculosDaCaixa = vinculosPorCaixinha.get(id) ?? [];
    for (const v of vinculosDaCaixa) {
      movimentos.push({
        id: `vinculo-${v.id}`,
        tipo: 'conciliacao',
        lancamentoId: v.lancamentoId,
        data: v.data || v.confirmadoEm.split('T')[0],
          descricao: `Vínculo confirmado: ${v.descricao || v.fonte}${v.motivo ? ` (Motivo: ${v.motivo})` : ''}`,
        valor: v.fonte === 'retirada' ? -v.valor : v.valor,
      });
    }

    // Ordena movimentos: mais recentes primeiro
    movimentos.sort((a, b) => (b.data || '').localeCompare(a.data || ''));

    let saldoCentavos = 0;
    let saldoAtestado = true;
    let motivoSaldoNaoAtestado: string | undefined;

    if (idsComPendencias.has(id)) {
      saldoAtestado = false;
      motivoSaldoNaoAtestado = 'Revise as movimentações pendentes desta caixinha para confirmar o saldo.';
    }

    let creditosCentavos = 0;
    let debitosCentavos = 0;

    for (const m of movimentos) {
      try {
        const cent = reaisParaCentavos(Math.abs(m.valor));
        if (m.valor >= 0) {
          creditosCentavos = somarCentavos([creditosCentavos, cent]);
        } else {
          debitosCentavos = somarCentavos([debitosCentavos, cent]);
        }
      } catch {
        saldoAtestado = false;
        motivoSaldoNaoAtestado = 'Valores com fração ou inconsistência no histórico. Saldo não atestado.';
      }
    }

    saldoCentavos = creditosCentavos - debitosCentavos;
    const saldo = centavosParaReais(saldoCentavos);

    if (estado === 'ativa') {
      totalAtivas++;
      totalSaldoCentavos += saldoCentavos;
    } else {
      totalArquivadas++;
    }

    // Regras de arquivamento
    let podeArquivar = false;
    let motivoBloqueioArquivamento: string | undefined;

    if (estado === 'arquivada') {
      podeArquivar = false;
      motivoBloqueioArquivamento = 'A caixinha já está arquivada.';
    } else if (!saldoAtestado) {
      podeArquivar = false;
      motivoBloqueioArquivamento = 'Revise os vínculos pendentes antes de desativar a caixinha.';
    } else if (saldoCentavos > 0) {
      podeArquivar = false;
      motivoBloqueioArquivamento = `A caixinha possui saldo positivo de ${moeda(saldo)}. Para arquivar com segurança, o saldo deve ser zerado com uma movimentação válida (ex.: retirada em Entrada/Saída avulsa).`;
    } else if (saldoCentavos < 0) {
      podeArquivar = false;
      motivoBloqueioArquivamento = `A caixinha possui saldo negativo de ${moeda(saldo)}. Regularize o saldo com uma movimentação válida antes de arquivar.`;
    } else {
      podeArquivar = true;
    }

    // Regras de exclusão física
    let podeExcluir = false;
    let motivoBloqueioExclusao: string | undefined;

    if (movimentos.length > 0) {
      podeExcluir = false;
      motivoBloqueioExclusao = 'A caixinha possui movimentações registradas no histórico. Para preservar a integridade contábil e a auditoria, não é permitida a exclusão física; utilize a opção Arquivar.';
    } else if (familia !== 'diaria') {
      podeExcluir = false;
      motivoBloqueioExclusao = 'Caixinhas de custos fixos e reservas fixas são estruturais e não podem ser excluídas fisicamente. Gerencie-as na tela de Custos Fixos ou utilize Arquivar.';
    } else {
      podeExcluir = true;
    }

    caixinhas.push({
      id,
      familia,
      idOriginal,
      nome,
      finalidade,
      estado,
      criadoEm,
      saldo,
      saldoCentavos,
      saldoAtestado,
      motivoSaldoNaoAtestado,
      totalCreditos: centavosParaReais(creditosCentavos),
      totalDebitos: centavosParaReais(debitosCentavos),
      movimentos,
      auditoria: auditoria.sort((a, b) => new Date(b.confirmadoEm).getTime() - new Date(a.confirmadoEm).getTime()),
      podeArquivar,
      motivoBloqueioArquivamento,
      podeExcluir,
      motivoBloqueioExclusao,
    });
  }

  // Ordena caixinhas: ativas primeiro, depois alfabética
  caixinhas.sort((a, b) => {
    if (a.estado !== b.estado) return a.estado === 'ativa' ? -1 : 1;
    return a.nome.localeCompare(b.nome);
  });

  return {
    caixinhas,
    pendencias: pendenciasAtivas,
    totalSaldoCentavos,
    totalAtivas,
    totalArquivadas,
    totalPendencias: pendenciasAtivas.length,
  };
}

export function executarCriarCaixinha(
  dados: DadosPersistidos,
  params: { nome: string; finalidade: string; autorUid: string },
): DadosPersistidos {
  const nome = params.nome.trim();
  const finalidade = params.finalidade.trim();
  if (!nome) throw new Error('Informe o nome da caixinha.');
  if (nome.length > 120) throw new Error('O nome da caixinha deve ter no máximo 120 caracteres.');
  if (finalidade.length > 300) throw new Error('A finalidade deve ter no máximo 300 caracteres.');

  const uuid = crypto.randomUUID();
  const caixinhaId: IdCaixinha = `diaria:${uuid}`;
  const agora = new Date().toISOString();

  const eventoAuditoria: EventoAuditoriaCaixinha = {
    id: crypto.randomUUID(),
    acao: 'criar',
    caixinhaId,
    autorUid: params.autorUid,
    confirmadoEm: agora,
    nomeNovo: nome,
    finalidade,
    motivo: 'Criação inicial da caixinha com identificador permanente.',
  };

  const novaReserva: ReservaDiariaItemEstendido = {
    id: uuid,
    nome,
    valor: 0,
    finalidade,
    estado: 'ativa',
    criadoEm: agora,
    auditoria: [eventoAuditoria],
    vinculos: [],
  };

  const reservasDiarias = [...(dados.reservasDiarias ?? []), novaReserva];
  return { ...dados, reservasDiarias };
}

export function executarEditarCaixinha(
  dados: DadosPersistidos,
  params: { id: IdCaixinha; nome: string; finalidade: string; motivo: string; autorUid: string },
): DadosPersistidos {
  const nome = params.nome.trim();
  const finalidade = params.finalidade.trim();
  const motivo = params.motivo.trim();
  if (!nome) throw new Error('Informe o nome da caixinha.');
  if (!motivo) throw new Error('Informe o motivo da alteração.');

  const partes = params.id.split(':');
  const familia = partes[0] as 'diaria' | 'fixo' | 'reserva-fixa';
  const idOriginal = partes.slice(1).join(':');
  const agora = new Date().toISOString();

  if (familia === 'diaria') {
    const reservasDiarias = ((dados.reservasDiarias ?? []) as ReservaDiariaItemEstendido[]).map(r => {
      if (r.id !== idOriginal) return r;
      const evento: EventoAuditoriaCaixinha = {
        id: crypto.randomUUID(),
        acao: 'renomear',
        caixinhaId: params.id,
        autorUid: params.autorUid,
        confirmadoEm: agora,
        nomeAnterior: r.nome,
        nomeNovo: nome,
        finalidade,
        motivo,
      };
      return {
        ...r,
        nome,
        finalidade,
        auditoria: [...(r.auditoria ?? []), evento],
      };
    });
    return { ...dados, reservasDiarias };
  }

  if (familia === 'fixo') {
    const custosFixos = ((dados.custosFixos ?? []) as CustoFixoItemEstendido[]).map(f => {
      if (f.id !== idOriginal) return f;
      const evento: EventoAuditoriaCaixinha = {
        id: crypto.randomUUID(),
        acao: 'renomear',
        caixinhaId: params.id,
        autorUid: params.autorUid,
        confirmadoEm: agora,
        nomeAnterior: f.nome,
        nomeNovo: nome,
        finalidade,
        motivo,
      };
      return {
        ...f,
        nome,
        finalidade,
        auditoria: [...(f.auditoria ?? []), evento],
      };
    });
    return { ...dados, custosFixos };
  }

  // Reserva fixa (reserva1, reserva2, reserva3)
  const campoNome = idOriginal === 'reserva1' ? 'nomeReserva1'
    : idOriginal === 'reserva2' ? 'nomeReserva2' : 'nomeReserva3';
  const nomeAnterior = dados[campoNome];

  const metaId = `meta:${params.id}`;
  const evento: EventoAuditoriaCaixinha = {
    id: crypto.randomUUID(),
    acao: 'renomear',
    caixinhaId: params.id,
    autorUid: params.autorUid,
    confirmadoEm: agora,
    nomeAnterior,
    nomeNovo: nome,
    finalidade,
    motivo,
  };

  const reservasDiarias = [...(dados.reservasDiarias ?? []) as ReservaDiariaItemEstendido[]];
  const idx = reservasDiarias.findIndex(r => r.id === metaId);
  if (idx >= 0) {
    reservasDiarias[idx] = {
      ...reservasDiarias[idx],
      finalidade,
      auditoria: [...(reservasDiarias[idx].auditoria ?? []), evento],
    };
  } else {
    reservasDiarias.push({
      id: metaId,
      nome,
      valor: 0,
      finalidade,
      estado: 'ativa',
      criadoEm: agora,
      auditoria: [evento],
      vinculos: [],
    });
  }

  return { ...dados, [campoNome]: nome, reservasDiarias };
}

export function executarArquivarCaixinha(
  dados: DadosPersistidos,
  params: { id: IdCaixinha; motivo: string; autorUid: string },
): DadosPersistidos {
  const motivo = params.motivo.trim();
  if (!motivo) throw new Error('Informe o motivo do arquivamento.');

  const todas = obterTodasCaixinhas(dados);
  const caixinha = todas.caixinhas.find(c => c.id === params.id);
  if (!caixinha) throw new Error('Caixinha não encontrada.');
  if (!caixinha.podeArquivar) {
    throw new Error(caixinha.motivoBloqueioArquivamento || 'Esta caixinha não pode ser arquivada no momento.');
  }

  const partes = params.id.split(':');
  const familia = partes[0] as 'diaria' | 'fixo' | 'reserva-fixa';
  const idOriginal = partes.slice(1).join(':');
  const agora = new Date().toISOString();

  const evento: EventoAuditoriaCaixinha = {
    id: crypto.randomUUID(),
    acao: 'arquivar',
    caixinhaId: params.id,
    autorUid: params.autorUid,
    confirmadoEm: agora,
    motivo,
    saldoVerificado: 0,
  };

  if (familia === 'diaria') {
    const reservasDiarias = ((dados.reservasDiarias ?? []) as ReservaDiariaItemEstendido[]).map(r => {
      if (r.id !== idOriginal) return r;
      return {
        ...r,
        estado: 'arquivada' as const,
        auditoria: [...(r.auditoria ?? []), evento],
      };
    });
    return { ...dados, reservasDiarias };
  }

  if (familia === 'fixo') {
    const custosFixos = ((dados.custosFixos ?? []) as CustoFixoItemEstendido[]).map(f => {
      if (f.id !== idOriginal) return f;
      return {
        ...f,
        estado: 'arquivada' as const,
        auditoria: [...(f.auditoria ?? []), evento],
      };
    });
    return { ...dados, custosFixos };
  }

  // Reserva fixa
  const metaId = `meta:${params.id}`;
  const reservasDiarias = [...(dados.reservasDiarias ?? []) as ReservaDiariaItemEstendido[]];
  const idx = reservasDiarias.findIndex(r => r.id === metaId);
  if (idx >= 0) {
    reservasDiarias[idx] = {
      ...reservasDiarias[idx],
      estado: 'arquivada',
      auditoria: [...(reservasDiarias[idx].auditoria ?? []), evento],
    };
  } else {
    reservasDiarias.push({
      id: metaId,
      nome: caixinha.nome,
      valor: 0,
      estado: 'arquivada',
      criadoEm: agora,
      auditoria: [evento],
      vinculos: [],
    });
  }

  return { ...dados, reservasDiarias };
}

export function executarReativarCaixinha(
  dados: DadosPersistidos,
  params: { id: IdCaixinha; motivo: string; autorUid: string },
): DadosPersistidos {
  const motivo = params.motivo.trim();
  if (!motivo) throw new Error('Informe o motivo da reativação.');

  const partes = params.id.split(':');
  const familia = partes[0] as 'diaria' | 'fixo' | 'reserva-fixa';
  const idOriginal = partes.slice(1).join(':');
  const agora = new Date().toISOString();

  const evento: EventoAuditoriaCaixinha = {
    id: crypto.randomUUID(),
    acao: 'reativar',
    caixinhaId: params.id,
    autorUid: params.autorUid,
    confirmadoEm: agora,
    motivo,
  };

  if (familia === 'diaria') {
    const reservasDiarias = ((dados.reservasDiarias ?? []) as ReservaDiariaItemEstendido[]).map(r => {
      if (r.id !== idOriginal) return r;
      return {
        ...r,
        estado: 'ativa' as const,
        auditoria: [...(r.auditoria ?? []), evento],
      };
    });
    return { ...dados, reservasDiarias };
  }

  if (familia === 'fixo') {
    const custosFixos = ((dados.custosFixos ?? []) as CustoFixoItemEstendido[]).map(f => {
      if (f.id !== idOriginal) return f;
      return {
        ...f,
        estado: 'ativa' as const,
        auditoria: [...(f.auditoria ?? []), evento],
      };
    });
    return { ...dados, custosFixos };
  }

  const metaId = `meta:${params.id}`;
  const reservasDiarias = [...(dados.reservasDiarias ?? []) as ReservaDiariaItemEstendido[]];
  const idx = reservasDiarias.findIndex(r => r.id === metaId);
  if (idx >= 0) {
    reservasDiarias[idx] = {
      ...reservasDiarias[idx],
      estado: 'ativa',
      auditoria: [...(reservasDiarias[idx].auditoria ?? []), evento],
    };
  }

  return { ...dados, reservasDiarias };
}

export function executarExcluirCaixinha(
  dados: DadosPersistidos,
  params: { id: IdCaixinha; motivo?: string; autorUid: string },
): DadosPersistidos {
  const todas = obterTodasCaixinhas(dados);
  const caixinha = todas.caixinhas.find(c => c.id === params.id);
  if (!caixinha) throw new Error('Caixinha não encontrada.');
  if (!caixinha.podeExcluir) {
    throw new Error(caixinha.motivoBloqueioExclusao || 'Esta caixinha não pode ser excluída.');
  }

  const partes = params.id.split(':');
  const familia = partes[0] as 'diaria' | 'fixo' | 'reserva-fixa';
  const idOriginal = partes.slice(1).join(':');

  if (familia === 'diaria') {
    const reservasDiarias = ((dados.reservasDiarias ?? []) as ReservaDiariaItemEstendido[]).filter(
      r => r.id !== idOriginal,
    );
    return { ...dados, reservasDiarias };
  }

  throw new Error('Apenas caixinhas diárias criadas sem histórico podem ser excluídas fisicamente.');
}

export function executarConciliarCaixinha(
  dados: DadosPersistidos,
  params: { pendencia: PendenciaRevisao; caixinhaId: IdCaixinha; motivo: string; autorUid: string },
): DadosPersistidos {
  const motivo = params.motivo.trim();
  if (!motivo) throw new Error('Informe o motivo do vínculo.');

  const todas = obterTodasCaixinhas(dados);
  const caixinha = todas.caixinhas.find(c => c.id === params.caixinhaId);
  if (!caixinha) throw new Error('Caixinha selecionada não encontrada.');
  if (caixinha.estado !== 'ativa') throw new Error('Reative a caixinha antes de vincular movimentações.');

  const agora = new Date().toISOString();
  const vinculo: VinculoRegistrado = {
    id: params.pendencia.id,
    caixinhaId: params.caixinhaId,
    lancamentoId: params.pendencia.lancamentoId,
    fonte: params.pendencia.fonte,
    valor: params.pendencia.valor,
    descricao: params.pendencia.descricao,
    data: params.pendencia.data,
    referenciaOriginal: params.pendencia.referenciaOriginal,
    confirmadoEm: agora,
    autorUid: params.autorUid,
    motivo,
  };

  const evento: EventoAuditoriaCaixinha = {
    id: crypto.randomUUID(),
    acao: 'conciliar',
    caixinhaId: params.caixinhaId,
    autorUid: params.autorUid,
    confirmadoEm: agora,
    motivo,
    vinculo: {
      referenciaSha256: vinculo.id,
      lancamentoId: vinculo.lancamentoId,
      fonte: vinculo.fonte,
      valor: vinculo.valor,
      descricao: vinculo.descricao,
    },
  };

  const partes = params.caixinhaId.split(':');
  const familia = partes[0] as 'diaria' | 'fixo' | 'reserva-fixa';
  const idOriginal = partes.slice(1).join(':');

  if (familia === 'diaria') {
    const reservasDiarias = ((dados.reservasDiarias ?? []) as ReservaDiariaItemEstendido[]).map(r => {
      if (r.id !== idOriginal) return r;
      return {
        ...r,
        vinculos: [...(r.vinculos ?? []), vinculo],
        auditoria: [...(r.auditoria ?? []), evento],
      };
    });
    return { ...dados, reservasDiarias };
  }

  if (familia === 'fixo') {
    const custosFixos = ((dados.custosFixos ?? []) as CustoFixoItemEstendido[]).map(f => {
      if (f.id !== idOriginal) return f;
      return {
        ...f,
        vinculos: [...(f.vinculos ?? []), vinculo],
        auditoria: [...(f.auditoria ?? []), evento],
      };
    });
    return { ...dados, custosFixos };
  }

  // Reserva fixa
  const metaId = `meta:${params.caixinhaId}`;
  const reservasDiarias = [...(dados.reservasDiarias ?? []) as ReservaDiariaItemEstendido[]];
  const idx = reservasDiarias.findIndex(r => r.id === metaId);
  if (idx >= 0) {
    reservasDiarias[idx] = {
      ...reservasDiarias[idx],
      vinculos: [...(reservasDiarias[idx].vinculos ?? []), vinculo],
      auditoria: [...(reservasDiarias[idx].auditoria ?? []), evento],
    };
  } else {
    reservasDiarias.push({
      id: metaId,
      nome: caixinha.nome,
      valor: 0,
      estado: 'ativa',
      criadoEm: agora,
      auditoria: [evento],
      vinculos: [vinculo],
    });
  }

  return { ...dados, reservasDiarias };
}
