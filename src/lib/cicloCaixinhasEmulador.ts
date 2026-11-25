import { createHash } from 'node:crypto';
import { collection, doc, getDocFromServer, getDocsFromServer, runTransaction, serverTimestamp, where, query, type Firestore, type Timestamp } from 'firebase/firestore';
import type { IdCaixinha } from './catalogoCaixinhas';
import { validarCicloCaixinha, type AcaoCaixinha, type CaixinhaCiclo } from './cicloCaixinhas.ts';
import { lerDados, type DadosPersistidos, type Lancamento } from './gestao.ts';
import { metadata, version } from './syncSession.ts';
import { caixinhasAfetadas, saldoVerificavelEmCentavos } from './integridadeCaixinhas.ts';
import { lerComandoFinanceiro, montarFinanceiro } from './comandoFinanceiro.ts';
import { reaisParaCentavos } from './centavosFinanceiros.ts';

export const projetoCiclo = 'demo-appcar-ciclo';
export const enderecoCiclo = '127.0.0.1:8089';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type CaixinhaArmazenada = CaixinhaCiclo & {
  proprietarioUid: string;
  criadoEm: Timestamp;
  atualizadoEm: Timestamp;
  versao: number;
  operacaoId: string;
};

type Comando = Readonly<{
  id: string;
  caixinhaId: IdCaixinha;
  acao: AcaoCaixinha;
  versao: number;
  geracao: number;
  revisaoFinanceira: number;
  nome?: string;
  finalidade?: string;
  motivo?: string;
}>;

type Retrato = Pick<CaixinhaCiclo, 'nome' | 'finalidade' | 'estado'>;
const retrato = ({ nome, finalidade, estado }: CaixinhaCiclo): Retrato => ({ nome, finalidade, estado });

function verificarEmulador(db: Firestore, uid: string) {
  const conexao = doc(db, 'users', uid).firestore.toJSON() as { settings?: { host?: string; ssl?: boolean } };
  if (process.env.FIRESTORE_EMULATOR_HOST !== enderecoCiclo || db.app.options.projectId !== projetoCiclo
      || conexao.settings?.host !== enderecoCiclo || conexao.settings.ssl !== false
      || !/^ficticio-[a-z0-9-]+$/.test(uid)) {
    throw new Error('Ciclo habilitado somente no emulador dedicado, com UID fictício.');
  }
}

export async function executarCicloEmulador(db: Firestore, uid: string, comando: Comando) {
  verificarEmulador(db, uid);
  const { id, caixinhaId, acao, versao, geracao, revisaoFinanceira } = comando;
  const identificador = caixinhaId.slice('diaria:'.length);
  if (!uuid.test(id) || !caixinhaId.startsWith('diaria:') || !uuid.test(identificador)) throw new Error('Identificador inválido.');
  if (!['criar', 'renomear', 'arquivar', 'reativar'].includes(acao)) throw new Error('Ação inválida.');
  const nome = comando.nome?.trim() ?? '';
  const finalidade = comando.finalidade?.trim() ?? '';
  const motivo = (acao === 'criar' ? null : comando.motivo?.trim()) ?? null;
  if (nome.length > 120 || finalidade.length > 300 || (motivo?.length ?? 0) > 500) throw new Error('Campos excedem o limite.');
  const evento = doc(db, 'users', uid, 'caixinhasAuditoria', id);
  const caixinha = doc(db, 'users', uid, 'caixinhasCatalogo', caixinhaId);
  const financeiro = doc(db, 'users', uid, 'appData', 'main');

  const confirmar = () => runTransaction(db, async tx => {
    const repetida = (await tx.get(evento)).data();
    if (repetida) {
      if (repetida.caixinhaId !== caixinhaId || repetida.acao !== acao || repetida.versaoAnterior !== versao
          || repetida.geracao !== geracao || repetida.revisaoFinanceira !== revisaoFinanceira || repetida.motivo !== motivo
          || ((acao === 'criar' || acao === 'renomear') && repetida.depois.nome !== nome)
          || (acao === 'criar' && repetida.depois.finalidade !== finalidade)) throw new Error('ID da operação já utilizado.');
      return { operacaoId: id, caixinhaId, versao: repetida.versaoNova as number, repetida: true };
    }
    const atual = (await tx.get(caixinha)).data() as CaixinhaArmazenada | undefined;
    const documento = (await tx.get(financeiro)).data();
    if (!documento?._sync || !Array.isArray(documento.historico)) throw new Error('Versão financeira indisponível.');
    const sync = metadata(documento);
    if (sync.generation !== geracao || sync.revision !== revisaoFinanceira || (atual?.versao ?? 0) !== versao
        || (acao === 'criar' && atual)) throw new Error('Conflito de versão. Revise a operação.');
    const saldo = acao === 'arquivar'
      ? saldoVerificavelEmCentavos(lerDados(documento), caixinhaId)
      : 0;
    const erro = validarCicloCaixinha(acao, atual, { nome, motivo: motivo ?? '', saldo });
    if (erro) throw new Error(erro);
    const depois: Retrato = {
      nome: acao === 'criar' || acao === 'renomear' ? nome : atual!.nome,
      finalidade: atual?.finalidade ?? finalidade,
      estado: acao === 'arquivar' ? 'arquivada' : 'ativa',
    };
    const versaoNova = versao + 1;
    const agora = serverTimestamp();
    tx.set(caixinha, {
      id: caixinhaId, proprietarioUid: uid, ...depois, criadoEm: atual?.criadoEm ?? agora,
      atualizadoEm: agora, versao: versaoNova, operacaoId: id,
    });
    tx.set(evento, {
      id, caixinhaId, acao, autorUid: uid, confirmadoEm: agora,
      geracao, revisaoFinanceira, versaoAnterior: versao, versaoNova,
      antes: atual ? retrato(atual) : null, depois, motivo, saldoVerificado: acao === 'arquivar' ? saldo : null,
    });
    return { operacaoId: id, caixinhaId, versao: versaoNova, repetida: false };
  });
  try {
    return await confirmar();
  } catch (erro) {
    if (!(erro instanceof Error) || !('code' in erro) || erro.code !== 'permission-denied') throw erro;
    // As regras podem rejeitar a versão concorrente antes da precondição da transação.
    const [recibo, atual, dados] = await Promise.all([
      getDocFromServer(evento), getDocFromServer(caixinha), getDocFromServer(financeiro),
    ]);
    const sync = metadata(dados.data());
    if (!recibo.exists() && (atual.data()?.versao ?? 0) === versao
        && sync.generation === geracao && sync.revision === revisaoFinanceira) throw erro;
    return confirmar();
  }
}

export async function consultarArquivadasEmulador(db: Firestore, uid: string) {
  verificarEmulador(db, uid);
  const resultado = await getDocsFromServer(query(collection(db, 'users', uid, 'caixinhasCatalogo'), where('estado', '==', 'arquivada')));
  return resultado.docs.map(item => item.data() as CaixinhaArmazenada);
}

type AlteracaoFinanceira =
  | { tipo: 'incluir' | 'editar'; item: Lancamento }
  | { tipo: 'excluir'; lancamentoId: string }
  | { tipo: 'configurar'; campos: Partial<Pick<DadosPersistidos, 'custosFixos' | 'reservasDiarias' | 'nomeReserva1' | 'nomeReserva2' | 'nomeReserva3'>> };

function aplicarAlteracao(dados: DadosPersistidos, alteracao: AlteracaoFinanceira): DadosPersistidos {
  if (alteracao.tipo === 'configurar') {
    const permitidos = ['custosFixos', 'reservasDiarias', 'nomeReserva1', 'nomeReserva2', 'nomeReserva3'];
    if (Object.keys(alteracao.campos).some(campo => !permitidos.includes(campo))) throw new Error('Configuração inválida.');
    alteracao.campos.custosFixos?.forEach(c => reaisParaCentavos(c.valorMensal));
    alteracao.campos.reservasDiarias?.forEach(r => reaisParaCentavos(r.valor));
    return { ...dados, ...alteracao.campos };
  }
  const id = alteracao.tipo === 'excluir' ? alteracao.lancamentoId : alteracao.item.id;
  const encontrados = dados.historico.filter(h => h.id === id).length;
  if (typeof id !== 'string' || !id.trim() || encontrados !== (alteracao.tipo === 'incluir' ? 0 : 1)) {
    throw new Error('Identidade de lançamento ausente ou em conflito.');
  }
  if (alteracao.tipo === 'excluir') return { ...dados, historico: dados.historico.filter(h => h.id !== id) };
  const item = alteracao.item;
  for (const valor of [item.faturamentoBruto, item.combustivel, item.reservaFevereiro, item.reservaInvestimento,
    item.reservaAcidente, item.custosFixosDia, item.totalDespesas, item.liquido,
    ...Object.values(item.detalheCustosFixosDia ?? {}), ...(item.reservasDiariasDia ?? []).map(r => r.valor),
    ...(item.saidas ?? []).map(s => s.valor)]) {
    if (valor !== undefined) reaisParaCentavos(valor);
  }
  if (alteracao.tipo === 'incluir') return { ...dados, historico: [item, ...dados.historico] };
  return { ...dados, historico: dados.historico.map(h => h.id === id ? alteracao.item : h) };
}

/** Entrada do operador financeiro do piloto. Monta o próximo estado a partir do documento confirmado. */
export async function executarFinanceiroEmulador(db: Firestore, uid: string,
  geracao: number, revisao: number, alteracao: AlteracaoFinanceira) {
  return confirmarFinanceiro(db, uid, geracao, revisao, alteracao, dados => aplicarAlteracao(dados, alteracao));
}

export async function executarComandoFinanceiroEmulador(db: Firestore, uid: string, entrada: unknown) {
  verificarEmulador(db, uid);
  const comando = lerComandoFinanceiro(entrada);
  return confirmarFinanceiro(db, uid, comando.geracao, comando.revisao, comando, dados => montarFinanceiro(dados, comando));
}

async function confirmarFinanceiro(db: Firestore, uid: string,
  geracao: number, revisao: number, alteracao: unknown, montar: (dados: DadosPersistidos) => DadosPersistidos) {
  verificarEmulador(db, uid);
  if (![geracao, revisao, revisao + 1].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('Versão inválida.');
  const assinatura = createHash('sha256').update(version(alteracao)).digest('hex');
  const id = `g${geracao}-r${revisao + 1}`;
  const recibo = doc(db, 'users', uid, 'caixinhasRecibos', id);
  const financeiro = doc(db, 'users', uid, 'appData', 'main');
  const conferirRecibo = (gravado: string) => {
    if (gravado !== assinatura) throw new Error('Conflito de versão financeira. Revise a operação.');
    return { id, repetida: true };
  };
  // O SDK usa um transporte separado para transações. Confirme a conexão
  // antes de enviar o comando, inclusive quando o cliente desativa a rede.
  await getDocFromServer(financeiro);
  try {
    return await runTransaction(db, async tx => {
      const anterior = (await tx.get(recibo)).data();
      if (anterior) return conferirRecibo(anterior.assinatura);
      const documento = (await tx.get(financeiro)).data();
      const sync = metadata(documento);
      if (!documento?._sync || sync.generation !== geracao || sync.revision !== revisao) {
        throw new Error('Conflito de versão financeira. Revise a operação.');
      }
      const dados = lerDados(documento);
      const depois = montar(dados);
      const { ids, alteraPendencias } = caixinhasAfetadas(dados, depois);
      const catalogo = await Promise.all(ids.filter(chave => chave.startsWith('diaria:') && uuid.test(chave.slice(7)))
        .map(chave => tx.get(doc(db, 'users', uid, 'caixinhasCatalogo', chave))));
      if (catalogo.some(item => item.data()?.estado === 'arquivada')) throw new Error('Movimentação em caixinha arquivada.');
      if (alteraPendencias) throw new Error('A alteração afeta referências ambíguas. Mantenha o registro pendente.');
      for (const item of catalogo) {
        if (!item.exists()) continue;
        const chave = item.id as IdCaixinha;
        const saldoAnterior = saldoVerificavelEmCentavos(dados, chave);
        const novoSaldo = saldoVerificavelEmCentavos(depois, chave);
        if (novoSaldo < 0 && novoSaldo < saldoAnterior) throw new Error('Saldo insuficiente na caixinha.');
      }
      tx.set(financeiro, { ...depois, _sync: { ...sync, revision: revisao + 1 } });
      tx.set(recibo, { id, autorUid: uid, assinatura, confirmadoEm: serverTimestamp() });
      return { id, repetida: false };
    });
  } catch (erro) {
    if (!(erro instanceof Error) || !('code' in erro) || erro.code !== 'permission-denied') throw erro;
    const gravado = (await getDocFromServer(recibo)).data();
    if (gravado) return conferirRecibo(gravado.assinatura);
    throw erro;
  }
}
