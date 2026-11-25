import { createHash, type KeyObject } from 'node:crypto';
import { doc, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';
import { verificarBackupFinanceiro } from './backupFinanceiroServidor.ts';
import { uuidFinanceiro } from './comandoFinanceiro.ts';
import type { IdCaixinha } from './catalogoCaixinhas.ts';
import { dadosPadrao, lerDados } from './gestao.ts';
import { saldoVerificavelEmCentavos } from './integridadeCaixinhas.ts';
import { clearedFinancial, metadata, version } from './syncSession.ts';

export class ErroAdministrativo extends Error {
  readonly status: number;
  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.status = status;
  }
}

function objeto(valor: unknown, chaves: string[]) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)
      || Object.keys(valor).some(chave => !chaves.includes(chave))) {
    throw new ErroAdministrativo(400, 'Comando administrativo inválido.');
  }
  return valor as Record<string, unknown>;
}

function texto(valor: unknown, limite = 120) {
  if (typeof valor !== 'string' || !valor.trim() || valor.length > limite) throw new ErroAdministrativo(400, 'Texto administrativo inválido.');
  return valor.trim();
}

export async function executarAdministracaoEmulador(
  db: Firestore, uid: string, espacoId: string, entrada: unknown, chavesConfiaveis: ReadonlyMap<string, KeyObject>,
) {
  const conexao = db.toJSON() as { settings?: { host?: string; ssl?: boolean } };
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8091' || db.app.options.projectId !== 'demo-appcar-financeiro'
      || conexao.settings?.host !== '127.0.0.1:8091' || conexao.settings.ssl !== false
      || !uid || !uuidFinanceiro.test(espacoId)) throw new ErroAdministrativo(403, 'Administração fora do piloto.');
  const corpo = objeto(entrada, ['operacaoId', 'tipo', 'geracao', 'revisao', 'backup', 'alteracao', 'confirmacao', 'motivo']);
  const { operacaoId, tipo, geracao, revisao } = corpo;
  if (typeof operacaoId !== 'string' || !uuidFinanceiro.test(operacaoId)
      || (tipo !== 'provisionar' && tipo !== 'restaurar' && tipo !== 'reiniciar' && tipo !== 'manter')) {
    throw new ErroAdministrativo(400, 'Identidade ou operação administrativa inválida.');
  }
  if (tipo === 'provisionar' ? Object.keys(corpo).length !== 2
    : !Number.isSafeInteger(geracao) || Number(geracao) < 0 || Number(geracao) >= Number.MAX_SAFE_INTEGER
      || !Number.isSafeInteger(revisao) || Number(revisao) < 0 || Number(revisao) >= Number.MAX_SAFE_INTEGER
      || !corpo.backup || ((tipo === 'manter') !== Object.hasOwn(corpo, 'alteracao'))
      || ((tipo === 'manter') !== Object.hasOwn(corpo, 'motivo'))
      || (tipo === 'reiniciar' ? corpo.confirmacao !== 'REINICIAR ESPAÇO FICTÍCIO' : Object.hasOwn(corpo, 'confirmacao'))) {
    throw new ErroAdministrativo(400, 'Base ou confirmação de backup inválida.');
  }
  const motivo = tipo === 'manter' ? texto(corpo.motivo, 500) : null;
  const assinatura = createHash('sha256').update(version(corpo)).digest('hex');
  const espaco = doc(db, 'espacosFinanceiros', espacoId);
  const financeiro = doc(espaco, 'dados', 'main');
  const concessao = doc(db, 'concessoesAdministrativas', espacoId);
  const evento = doc(espaco, 'administracao', operacaoId);
  const inicial = { ...dadosPadrao(), custosFixos: [], _sync: { generation: 0, revision: 0 } };
  return runTransaction(db, async tx => {
    const [autorizacao, controle, anterior, dados] = await Promise.all(
      [concessao, espaco, evento, financeiro].map(ref => tx.get(ref)),
    );
    const acesso = autorizacao.data();
    if (acesso?.uid !== uid || acesso.espacoId !== espacoId || !Array.isArray(acesso.operacoes)
        || !acesso.operacoes.includes(tipo) || (controle.exists() && controle.data()?.proprietarioUid !== uid)) {
      throw new ErroAdministrativo(403, 'Operação administrativa não autorizada.');
    }
    const gravado = anterior.data();
    if (gravado) {
      if (gravado.autorUid !== uid || gravado.assinatura !== assinatura) throw new ErroAdministrativo(409, 'ID administrativo já utilizado.');
      return { ...gravado.resultado, repetida: true };
    }
    if ((await tx.get(doc(espaco, 'operacoes', operacaoId))).exists()) {
      throw new ErroAdministrativo(409, 'ID administrativo já utilizado.');
    }
    const atual = dados.data();
    let resultado;
    let mudanca: { antes: Record<string, unknown>; depois: Record<string, unknown> } | null = null;
    if (tipo === 'provisionar') {
      if (controle.exists() || atual) throw new ErroAdministrativo(409, 'Espaço já provisionado.');
      tx.set(espaco, { proprietarioUid: uid, comandosFinanceiros: false, operacoesFinanceiras: [] });
      tx.set(financeiro, inicial);
      for (const id of ['reserva-fixa:reserva1', 'reserva-fixa:reserva2', 'reserva-fixa:reserva3']) {
        tx.set(doc(espaco, 'caixinhas', encodeURIComponent(id)), { id, estado: 'ativa' });
      }
      resultado = { operacaoId, tipo, geracao: 0, revisao: 0 };
    } else {
      const sync = metadata(atual);
      if (!controle.exists() || !atual?._sync || sync.generation !== geracao || sync.revision !== revisao) {
        throw new ErroAdministrativo(409, 'Geração ou revisão administrativa divergente.');
      }
      let backup;
      try {
        backup = verificarBackupFinanceiro(corpo.backup, { uid, espacoId, chavesConfiaveis });
      } catch (erro) {
        throw new ErroAdministrativo(422, (erro as Error).message);
      }
      const versaoBackup = metadata(backup.financeiro);
      if (versaoBackup.generation !== sync.generation) throw new ErroAdministrativo(409, 'Geração do backup divergente.');
      if (tipo === 'restaurar') {
        const financeiroIdentico = version(atual) === version(backup.financeiro);
        const destinoInicial = version(atual) === version(inicial);
        if (!destinoInicial) throw new ErroAdministrativo(409, 'Destino não vazio. Revise antes de restaurar.');
        resultado = { operacaoId, tipo, geracao, revisao, modo: 'somente-preparo', financeiroIdentico,
          revisaoBackup: versaoBackup.revision };
      } else {
        if (version(atual) !== version(backup.financeiro)) throw new ErroAdministrativo(409, 'Backup não corresponde à base atual.');
        if (tipo === 'reiniciar') {
          const proximaGeracao = sync.generation + 1;
          const arquivo = doc(espaco, 'geracoesArquivadas', String(sync.generation));
          if ((await tx.get(arquivo)).exists()) throw new ErroAdministrativo(409, 'Arquivo anterior já existe. Revise a recuperação.');
          tx.set(arquivo, atual);
          const startedOn = new Date().toISOString().slice(0, 10);
          tx.set(financeiro, clearedFinancial(atual, { generation: proximaGeracao, revision: 0, resetId: operacaoId, startedOn }));
          resultado = { operacaoId, tipo, geracao: proximaGeracao, revisao: 0, geracaoArquivada: geracao };
        } else {
          const alteracao = objeto(corpo.alteracao, ['caixinhaId', 'nome', 'finalidade', 'estado', 'nomeEspaco']);
          if (Object.hasOwn(alteracao, 'nomeEspaco')) {
            if (Object.keys(alteracao).length !== 1) throw new ErroAdministrativo(400, 'Separe as alterações administrativas.');
            const nome = texto(alteracao.nomeEspaco);
            mudanca = { antes: { nome: controle.data()?.nome ?? null }, depois: { nome } };
            tx.update(espaco, { nome });
          } else {
            const id = texto(alteracao.caixinhaId, 200);
            if (!/^(?:diaria|fixo|reserva-fixa):.+$/.test(id) || Object.keys(alteracao).length < 2) {
              throw new ErroAdministrativo(400, 'Identidade de caixinha inválida.');
            }
            const ref = doc(espaco, 'caixinhas', encodeURIComponent(id));
            const existente = (await tx.get(ref)).data();
            if (existente?.id !== id || (existente.estado !== 'ativa' && existente.estado !== 'arquivada')) {
              throw new ErroAdministrativo(409, 'Caixinha indisponível.');
            }
            if (Object.hasOwn(alteracao, 'estado')) {
              if (Object.keys(alteracao).length !== 2) throw new ErroAdministrativo(400, 'Separe mudança de estado e metadados.');
              if (alteracao.estado === existente.estado) throw new ErroAdministrativo(409, 'A caixinha já está nesse estado.');
            } else if (existente.estado === 'arquivada') {
              throw new ErroAdministrativo(409, 'Reative a caixinha antes de editar seus metadados.');
            }
            const mudancas: Record<string, string> = {};
            if (Object.hasOwn(alteracao, 'nome')) mudancas.nome = texto(alteracao.nome);
            if (Object.hasOwn(alteracao, 'finalidade')) mudancas.finalidade = texto(alteracao.finalidade, 300);
            if (Object.hasOwn(alteracao, 'estado')) {
              if (alteracao.estado !== 'ativa' && alteracao.estado !== 'arquivada') throw new ErroAdministrativo(400, 'Estado inválido.');
              let saldo: number;
              try { saldo = saldoVerificavelEmCentavos(lerDados(atual), id as IdCaixinha); }
              catch { throw new ErroAdministrativo(422, 'Saldo pendente de conciliação.'); }
              if (alteracao.estado === 'arquivada' && saldo !== 0) throw new ErroAdministrativo(422, 'Arquivamento exige saldo zero.');
              mudancas.estado = alteracao.estado;
            }
            mudanca = { antes: Object.fromEntries(Object.keys(mudancas).map(campo => [campo, existente[campo] ?? null])), depois: mudancas };
            tx.update(ref, mudancas);
          }
          tx.update(financeiro, { '_sync.revision': sync.revision + 1 });
          resultado = { operacaoId, tipo, geracao, revisao: sync.revision + 1 };
        }
      }
    }
    tx.set(evento, { id: operacaoId, autorUid: uid, espacoId, assinatura, tipo, resultado,
      base: tipo === 'provisionar' ? null : { geracao, revisao },
      alteracao: tipo === 'manter' ? corpo.alteracao : null,
      mudanca, motivo,
      confirmadoEm: serverTimestamp() });
    return { ...resultado, repetida: false };
  });
}
