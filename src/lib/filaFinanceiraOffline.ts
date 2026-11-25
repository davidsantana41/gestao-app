type Escopo = Readonly<{ uid: string; espacoId: string; geracao: number }>;
type Comando = Readonly<{ operacaoId: string; geracao: number; revisao: number; alteracao: Record<string, unknown> }>;
type Recibo = Readonly<{ operacaoId: string; revisao: number; repetida: boolean }>;
type Estado = 'pendente' | 'enviando' | 'confirmado' | 'conflito' | 'rejeitado';
type Item = { comando: Comando; estado: Estado; recibo?: Recibo; confirmadoEm?: number; motivo?: string };
type Envelope = { iv: Uint8Array<ArrayBuffer>; conteudo: ArrayBuffer };
const schemaCopia = 'appcar-fila-criptografada-v1';
const credencial = /^(?:authorization|bearer|token|(?:id|access|refresh|session)Token|senha|password|credencia(?:l|is)|credentials?|private[_-]?key|secret|segredo|api[_-]?key|sessionCookie|cookie)$/i;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const nomeBanco = 'appcar-fila-financeira-v1';
const tabela = 'filas';
const codificador = new TextEncoder();

function serializarItens(valor: unknown) {
  return JSON.stringify(valor, (chave, item) => {
    if (credencial.test(chave)) throw new Error('Credenciais não podem ser guardadas na fila.');
    return item;
  });
}

function abrirBanco(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const abertura = indexedDB.open(nomeBanco, 1);
    abertura.onupgradeneeded = () => abertura.result.createObjectStore(tabela);
    abertura.onsuccess = () => resolve(abertura.result);
    abertura.onerror = () => reject(abertura.error);
  });
}

async function acessarBanco<T>(modo: IDBTransactionMode, executar: (loja: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const banco = await abrirBanco();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = banco.transaction(tabela, modo, modo === 'readwrite' ? { durability: 'strict' } : undefined);
      const pedido = executar(tx.objectStore(tabela));
      tx.oncomplete = () => resolve(pedido.result);
      tx.onabort = () => reject(tx.error ?? new Error('Falha ao salvar fila.'));
    });
  } finally {
    banco.close();
  }
}

async function chaveLocal(segredo: string, contexto: Uint8Array<ArrayBuffer>) {
  const material = await crypto.subtle.importKey('raw', codificador.encode(segredo), 'PBKDF2', false, ['deriveKey']);
  const salt = await crypto.subtle.digest('SHA-256', contexto);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600_000 },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

function reciboValido(dados: unknown, comando: Comando): dados is Recibo {
  if (typeof dados !== 'object' || dados === null) return false;
  const recibo = dados as Partial<Recibo>;
  return recibo.operacaoId === comando.operacaoId && recibo.revisao === comando.revisao + 1
    && typeof recibo.repetida === 'boolean';
}

export async function abrirFilaFinanceiraOffline(opcoes: {
  escopo: Escopo;
  segredoLocal: string;
  obterToken: () => Promise<string | null>;
}) {
  const { uid, espacoId, geracao } = opcoes.escopo;
  const { obterToken } = opcoes;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid) || !uuid.test(espacoId)
      || !Number.isSafeInteger(geracao) || geracao < 0 || opcoes.segredoLocal.length < 16) {
    throw new Error('Escopo ou segredo local inválido.');
  }
  if (!globalThis.indexedDB || !navigator.locks || !crypto.subtle) throw new Error('Armazenamento seguro indisponível.');
  const escopo = JSON.stringify([uid, espacoId, geracao]);
  const contexto = codificador.encode(JSON.stringify([nomeBanco, location.origin, escopo]));
  let chave: CryptoKey | null = await chaveLocal(opcoes.segredoLocal, contexto);

  async function decifrar(envelope: Envelope, ativa: CryptoKey) {
    const claro = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: envelope.iv, additionalData: contexto }, ativa, envelope.conteudo,
    );
    const itens: unknown = JSON.parse(new TextDecoder().decode(claro));
    if (!Array.isArray(itens)) throw new Error('Cópia de fila inválida.');
    return itens as Item[];
  }

  async function comFila<T>(acao: (itens: Item[], salvar: () => Promise<void>, gravado?: Envelope) => Promise<T>) {
    return navigator.locks.request(nomeBanco + escopo, async () => {
      const ativa = chave;
      if (!ativa) throw new Error('Fila bloqueada.');
      const gravado: Envelope | undefined = await acessarBanco('readonly', loja => loja.get(escopo));
      let itens: Item[] = [];
      if (gravado) {
        try {
          itens = await decifrar(gravado, ativa);
        } catch {
          throw new Error('Não foi possível desbloquear a fila. Os dados locais foram preservados.');
        }
      }
      const salvar = async () => {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const conteudo = await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv, additionalData: contexto }, ativa, codificador.encode(serializarItens(itens)),
        );
        await acessarBanco('readwrite', loja => loja.put({ iv, conteudo }, escopo));
      };
      return acao(itens, salvar, gravado);
    });
  }

  async function enviar(item: Item) {
    const comando = item.comando;
    const token = await obterToken();
    if (!token || !chave) return { estado: 'pendente' as const, motivo: 'Autenticação necessária.' };
    const resposta = await fetch(`/espacos/${espacoId}/comandos`, {
      method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(12_000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Appcar-Conta-Fila': uid },
      body: JSON.stringify(comando),
    });
    if (resposta.status === 401) return { estado: 'pendente' as const, motivo: 'Autenticação necessária.' };
    if (resposta.ok) {
      const recibo: unknown = await resposta.json();
      if (!reciboValido(recibo, comando)) return { estado: 'pendente' as const, motivo: 'Recibo ainda não reconciliado.' };
      return { estado: 'confirmado' as const, recibo, confirmadoEm: Date.now() };
    }
    if ([400, 403, 409, 422].includes(resposta.status)) {
      const erro = await resposta.json() as { erro?: string; codigo?: string };
      if (erro.codigo === 'conta-divergente') return { estado: 'pendente' as const, motivo: 'Autentique a conta da fila.' };
      return {
        estado: resposta.status === 409 && erro.codigo !== 'geracao-divergente' ? 'conflito' as const : 'rejeitado' as const,
        motivo: typeof erro.erro === 'string' ? erro.erro : 'Comando recusado pelo serviço.',
      };
    }
    return { estado: 'pendente' as const, motivo: 'Serviço indisponível.' };
  }

  return {
    bloquear() { chave = null; },
    listar: () => comFila(async itens => structuredClone(itens)),
    exportarCopiaProtegida: () => comFila(async (itens, _salvar, gravado) => {
      if (!gravado) return undefined;
      serializarItens(itens);
      return {
        schema: schemaCopia, origem: location.origin, uid, espacoId, geracao,
        iv: Array.from(gravado.iv), conteudo: Array.from(new Uint8Array(gravado.conteudo)),
      };
    }),
    conferirCopiaProtegida: async (arquivo: unknown) => {
      const ativa = chave;
      if (!ativa || !arquivo || typeof arquivo !== 'object') throw new Error('Cópia de fila indisponível.');
      const copia = arquivo as Record<string, unknown>;
      if (copia.schema !== schemaCopia || copia.origem !== location.origin || copia.uid !== uid
          || copia.espacoId !== espacoId || copia.geracao !== geracao || !bytes(copia.iv)
          || copia.iv.length !== 12 || !bytes(copia.conteudo) || copia.conteudo.length < 16) {
        throw new Error('Versão ou escopo incompatível com a fila.');
      }
      try {
        const itens = await decifrar({
          iv: Uint8Array.from(copia.iv), conteudo: Uint8Array.from(copia.conteudo).buffer,
        }, ativa);
        serializarItens(itens);
        return itens;
      } catch {
        throw new Error('Integridade da cópia ou segredo local incompatível.');
      }
    },
    enfileirar: async (revisao: number, alteracao: Record<string, unknown>) => {
      if (!Number.isSafeInteger(revisao) || revisao < 0 || revisao >= Number.MAX_SAFE_INTEGER
          || !alteracao || typeof alteracao !== 'object' || Array.isArray(alteracao)) throw new Error('Comando local inválido.');
      const comando = { operacaoId: crypto.randomUUID(), geracao, revisao, alteracao };
      const texto = serializarItens(comando);
      if (codificador.encode(texto).length > 32_768) throw new Error('Comando local excede o limite.');
      const item: Item = { comando: JSON.parse(texto) as Comando, estado: 'pendente' };
      return comFila(async (itens, salvar) => {
        itens.push(item);
        await salvar();
        return structuredClone(item);
      });
    },
    enviarProximo: () => comFila(async (itens, salvar) => {
      const indice = itens.findIndex(item => item.estado === 'enviando' || item.estado === 'pendente');
      if (indice < 0) return undefined;
      const comando = itens[indice].comando;
      itens[indice] = { comando, estado: 'enviando' };
      await salvar();
      let resultado;
      try {
        resultado = await enviar(itens[indice]);
      } catch {
        resultado = { estado: 'pendente' as const, motivo: 'Confirmação indisponível. Reenvie o mesmo comando.' };
      }
      const item = { comando, ...resultado };
      itens[indice] = item;
      await salvar();
      return structuredClone(item);
    }),
    limparConfirmados: (anterioresA: number) => comFila(async (itens, salvar) => {
      if (!Number.isSafeInteger(anterioresA) || anterioresA < 0 || anterioresA > Date.now()) throw new Error('Data de limpeza inválida.');
      const mantidos = itens.filter(item => item.estado !== 'confirmado' || !item.recibo
        || item.confirmadoEm === undefined || item.confirmadoEm >= anterioresA);
      const removidos = itens.length - mantidos.length;
      if (removidos) {
        itens.splice(0, itens.length, ...mantidos);
        await salvar();
      }
      return removidos;
    }),
  };
}

function bytes(valor: unknown): valor is number[] {
  return Array.isArray(valor) && valor.every(item => Number.isInteger(item) && item >= 0 && item <= 255);
}
