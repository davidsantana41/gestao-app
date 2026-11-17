import { doc, getDocFromServer, runTransaction, type Firestore } from 'firebase/firestore';

export async function readWithTimeout<T>(read: () => Promise<T>, milliseconds = 10000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([read(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Leitura da nuvem demorou mais que o esperado')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

// Content is the version: preserves the existing schema and legacy fields.
export function version(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(version).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + version(item)).join(',') + '}';
  return JSON.stringify(value) ?? 'undefined';
}
export class SyncConflict extends Error {
  remote: unknown;
  constructor(remote: unknown) { super('Conflito identificado'); this.remote = remote; }
}
export async function conditionalWrite(db: Firestore, uid: string, base: unknown, next: object) {
  const ref = doc(db, 'users', uid, 'appData', 'main');
  // Require a server read before attempting a write. This also respects SDK
  // disableNetwork(), which transaction RPCs alone need not respect.
  await readWithTimeout(() => getDocFromServer(ref));
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref);
    const remote = snapshot.exists() ? snapshot.data() : null;
    // Every SDK retry compares with the ORIGINAL base, never silently rebases.
    if (version(remote) !== version(base)) throw new SyncConflict(remote);
    transaction.set(ref, next);
  });
}
export interface LocalStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  readonly length: number;
  key(index: number): string | null;
}
interface Envelope<T> { format: 1; uid: string; base: unknown; data: T; pending: boolean; known: boolean }
export interface Recovery<T> { key: string; data: T }
export interface SyncTransport {
  read(): Promise<unknown>;
  write(base: unknown, next: object): Promise<void>;
}
export class SyncSession<T extends object> {
  data: T | null = null;
  base: unknown = null;
  remote: unknown = null;
  pending = false;
  conflict = false;
  known = false;
  status = 'Carregando seus dados…';
  error = '';
  recoveries: Recovery<T>[] = [];
  private generation = 0;
  private task: Promise<void> | null = null;
  private closed = false;
  readonly prefix: string;
  readonly branch: string;
  onChange = () => {};
  private db: Firestore;
  private local: LocalStore;
  private tab: Pick<LocalStore, 'getItem' | 'setItem'>;
  private decode: (value: unknown) => T;
  private defaults: () => T;
  private transport: SyncTransport;
  readonly uid: string;
  constructor(db: Firestore, uid: string, local: LocalStore, tab: Pick<LocalStore, 'getItem' | 'setItem'>,
    decode: (value: unknown) => T, defaults: () => T, transport?: SyncTransport) {
    this.db = db; this.uid = uid; this.local = local; this.tab = tab; this.decode = decode; this.defaults = defaults;
    this.prefix = `gestao-app-dados-v2-${uid}`;
    this.branch = this.prefix + '-sync-' + crypto.randomUUID();
    this.transport = transport ?? {
      read: async () => {
        const snapshot = await getDocFromServer(doc(this.db, 'users', this.uid, 'appData', 'main'));
        return snapshot.exists() ? snapshot.data() : null;
      },
      write: (base, next) => conditionalWrite(this.db, this.uid, base, next),
    };
  }
  private emit() { if (!this.closed) this.onChange(); }
  private persist(data = this.data, pending = this.pending, base = this.base, known = this.known, compatibility = true) {
    if (!data) throw new Error('Dados indisponíveis');
    const entry: Envelope<T> = { format: 1, uid: this.uid, base, data, pending, known };
    // A unique journal per mounted tab is authoritative. Compatibility keys shared
    // between tabs are never the only copy of an edit.
    this.local.setItem(this.branch, JSON.stringify(entry));
    this.tab.setItem(this.prefix + '-session', this.branch);
    if (compatibility) {
      this.local.setItem(this.prefix, JSON.stringify(data));
      this.local.setItem(this.prefix + '-pendente', String(pending));
    }
  }
  private load() {
    const pointer = this.tab.getItem(this.prefix + '-session');
    let recovered: Envelope<T> | null = null;
    for (let i = 0; i < this.local.length; i++) {
      const key = this.local.key(i);
      if (!key?.startsWith(this.prefix + '-sync-')) continue;
      try {
        const entry: Envelope<T> = JSON.parse(this.local.getItem(key) || 'null');
        if (entry?.format !== 1 || entry.uid !== this.uid) continue;
        const data = this.decode(entry.data);
        if (key === pointer) recovered = { ...entry, data };
        else if (entry.pending) this.recoveries.push({ key, data });
      } catch { /* Never delete unreadable recovery data. */ }
    }
    if (recovered) {
      this.data = recovered.data; this.base = recovered.base; this.known = recovered.known; this.pending = recovered.pending;
    } else {
      const legacy = this.local.getItem(this.prefix);
      if (legacy) {
        // Preserve the pre-upgrade browser copy before adopting the new protocol.
        if (!this.local.getItem(this.prefix + '-antes-reconstrucao'))
          this.local.setItem(this.prefix + '-antes-reconstrucao', legacy);
        this.data = this.decode(JSON.parse(legacy)); this.pending = true;
      }
      // Legacy backups have no trustworthy base.
    }
  }
  async start() {
    try { this.load(); } catch { this.error = 'Não foi possível ler a cópia local. As cópias de recuperação foram mantidas.'; }
    if (this.closed) return;
    if (this.data) { this.status = 'Dados locais carregados. Verificando a nuvem…'; this.emit(); }
    await this.refresh();
  }
  async refresh() {
    if (this.task) return this.task;
    const generation = this.generation;
    try {
      const cloud = await readWithTimeout(() => this.transport.read());
      if (this.closed || generation !== this.generation) return;
      this.remote = cloud;
      if (!this.data) {
        this.data = cloud === null ? this.defaults() : this.decode(cloud); this.base = cloud; this.known = true;
        if (cloud && !this.local.getItem(this.prefix + '-nuvem-antes-reconstrucao'))
          this.local.setItem(this.prefix + '-nuvem-antes-reconstrucao', JSON.stringify(cloud));
      } else if (this.pending) {
        if (version(this.data) === version(cloud)) {
          this.base = cloud; this.known = true; this.pending = false; this.conflict = false;
        }
        else if (!this.known || version(this.base) !== version(cloud)) this.conflict = true;
      } else if (version(this.base) !== version(cloud)) {
        // Keep forms stable: even a clean tab explicitly adopts a changed remote.
        this.conflict = true;
      } else this.conflict = false;
      // A refresh triggered by another tab must not echo its storage event back.
      this.persist(this.data, this.pending, this.base, this.known, false);
      this.status = this.conflict ? 'Conflito identificado. As versões foram preservadas.'
        : this.pending ? 'Salvo localmente. Sincronização pendente.'
        : cloud === null ? 'Dados iniciais carregados. Nenhuma alteração pendente.' : 'Dados carregados. Salvo na nuvem.';
      this.error = '';
    } catch {
      this.status = 'Salvo localmente. Sem confirmação da nuvem.';
      if (!this.data) this.error = 'Não foi possível recuperar seus dados. Verifique a conexão e tente novamente.';
    }
    this.emit();
  }
  update(transform: (data: T) => T) {
    if (!this.data || this.closed) return false;
    try {
      const next = transform(structuredClone(this.data));
      this.persist(next, true); this.data = next; this.pending = true; this.generation++;
      this.error = '';
      this.status = this.conflict ? 'Salvo localmente. Conflito identificado; compare as versões.'
        : 'Salvo localmente. Sincronização pendente.'; this.emit();
      void this.flush(); return true;
    } catch {
      this.error = 'Não foi possível salvar neste navegador. Exporte um backup e libere espaço antes de continuar.';
      this.emit(); return false;
    }
  }
  flush(): Promise<void> {
    if (this.task) return this.task;
    if (this.closed || !this.pending || this.conflict || !this.known || !this.data) return Promise.resolve();
    this.task = this.drain().finally(() => { this.task = null; }); return this.task;
  }
  private async drain() {
    while (!this.closed && this.pending && !this.conflict && this.data) {
      const next = structuredClone(this.data), generation = this.generation;
      this.status = 'Sincronizando…'; this.emit();
      try {
        await this.transport.write(this.base, next);
        if (this.closed) return;
        this.base = next; this.remote = next;
        const pending = generation !== this.generation;
        this.persist(this.data, pending, next, true); this.pending = pending;
        this.status = pending ? 'Salvo localmente. Sincronização pendente.' : 'Salvo na nuvem e neste navegador.';
      } catch (error) {
        if (error instanceof SyncConflict) {
          this.remote = error.remote; this.conflict = true;
          try { this.backup('conflito-nuvem', error.remote); } catch { /* Local journal remains intact. */ }
          this.status = 'Conflito identificado. Suas alterações locais foram preservadas.';
        } else this.status = 'Salvo localmente. Não foi possível confirmar a sincronização; tente novamente.';
        this.emit(); return;
      }
      this.emit();
    }
  }
  private backup(label: string, data: unknown) {
    this.local.setItem(`${this.prefix}-${label}-${crypto.randomUUID()}`, JSON.stringify(data));
  }
  async resolve(source: 'local' | 'nuvem', expectedVersion = version(this.remote)) {
    if (!this.data || this.task || this.closed) return false;
    const generation = this.generation;
    try {
      const cloud = await readWithTimeout(() => this.transport.read());
      if (this.closed || generation !== this.generation) return false;
      this.backup('antes-resolver-local', this.data); this.backup('antes-resolver-nuvem', cloud);
      this.local.setItem(this.prefix + '-antes-resolver-local', JSON.stringify(this.data));
      this.local.setItem(this.prefix + '-antes-resolver-nuvem', JSON.stringify(cloud));
      if (expectedVersion !== version(cloud)) {
        this.remote = cloud; this.conflict = true;
        this.status = 'A nuvem mudou novamente. Compare as versões antes de confirmar.'; this.emit(); return false;
      }
      const next = source === 'local' ? this.data : cloud === null ? this.defaults() : this.decode(cloud);
      this.persist(next, source === 'local', cloud, true);
      this.data = next; this.base = cloud; this.known = true; this.pending = source === 'local';
      this.conflict = false; this.generation++; this.error = '';
      this.status = source === 'nuvem' ? 'Versão da nuvem carregada. As cópias anteriores foram preservadas.'
        : 'Salvo localmente. As cópias anteriores foram preservadas.'; this.emit();
      if (this.pending) await this.flush();
      return !this.conflict;
    } catch {
      this.error = 'Não foi possível confirmar a escolha. As cópias locais foram mantidas; tente novamente.';
      this.emit(); return false;
    }
  }
  recover(key: string) {
    const entry = this.recoveries.find(item => item.key === key);
    if (!entry || !this.data || this.task) return false;
    try {
      this.backup('antes-recuperar', this.data); this.persist(entry.data, true, this.base, false);
      this.data = entry.data; this.pending = true; this.known = false; this.conflict = true; this.generation++;
      this.status = 'Cópia recuperada. Compare com a nuvem antes de sincronizar.'; this.emit(); return true;
    } catch { this.error = 'Não foi possível preservar as cópias. Libere espaço antes de recuperar.'; this.emit(); return false; }
  }
  async retry() { await this.flush(); await this.refresh(); if (!this.conflict) await this.flush(); }
  async wait() { await this.flush(); if (this.pending || this.conflict) throw new Error('Sincronização pendente'); }
  close() { this.closed = true; this.onChange = () => {}; }
}
