import { doc, getDocFromServer, onSnapshot, runTransaction, type Firestore } from 'firebase/firestore';

export async function readWithTimeout<T>(read: () => Promise<T>, milliseconds = 10000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([read(), new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Leitura da nuvem demorou mais que o esperado')), milliseconds);
  })]); } finally { clearTimeout(timer); }
}
export function version(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(version).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => JSON.stringify(key) + ':' + version(item)).join(',') + '}';
  return JSON.stringify(value) ?? 'undefined';
}
type RecordData = Record<string, unknown>;
export interface SyncMetadata { generation: number; revision: number; resetId?: string; startedOn?: string }
function record(value: unknown): RecordData {
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Documento inválido');
  return value as RecordData;
}
export function metadata(value: unknown): SyncMetadata {
  const sync = record(value)._sync;
  if (!sync) return { generation: 0, revision: 0 };
  const entry = record(sync);
  if (!Number.isSafeInteger(entry.generation) || Number(entry.generation) < 0 || !Number.isSafeInteger(entry.revision) || Number(entry.revision) < 0) throw new Error('Versão inválida');
  return entry as unknown as SyncMetadata;
}
function financial(value: unknown) { const copy = { ...record(value) }; delete copy._sync; return copy; }
function equal(a: unknown, b: unknown) { return version(a) === version(b); }
export class SyncConflict extends Error {
  remote: unknown;
  paths: string[];
  constructor(remote: unknown, paths: string[] = []) { super('Conflito identificado'); this.remote = remote; this.paths = paths; }
}
export class GenerationConflict extends SyncConflict { constructor(remote: unknown) { super(remote, ['_sync.generation']); } }

// Financial entries are atomic by ID: independent additions merge, but concurrent
// changes to a single entry never combine computed totals field by field.
export function mergeFinancial(base: unknown, local: unknown, remote: unknown): RecordData {
  const b = financial(base), l = financial(local), r = financial(remote), result: RecordData = {};
  const conflicts: string[] = [];
  for (const key of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
    let chosen: unknown;
    if (equal(l[key], b[key])) chosen = r[key];
    else if (equal(r[key], b[key]) || equal(l[key], r[key])) chosen = l[key];
    else if (['historico', 'custosFixos', 'reservasDiarias'].includes(key) && [b[key] ?? [], l[key], r[key]].every(Array.isArray)) {
      const arrays = [b[key] ?? [], l[key], r[key]] as unknown[][];
      const valid = arrays.every(items => items.every(item => typeof record(item).id === 'string') && new Set(items.map(item => record(item).id)).size === items.length);
      if (!valid) { conflicts.push(key); continue; }
      const [bm, lm, rm] = arrays.map(items => new Map(items.map(item => [record(item).id as string, item])));
      const ids = [...new Set([...lm.keys()].filter(id => !bm.has(id)).concat([...rm.keys()], [...lm.keys()], [...bm.keys()]))];
      const merged: unknown[] = [];
      for (const id of ids) {
        const bv = bm.get(id), lv = lm.get(id), rv = rm.get(id);
        if (equal(lv, bv)) { if (rv !== undefined) merged.push(rv); }
        else if (equal(rv, bv) || equal(lv, rv)) { if (lv !== undefined) merged.push(lv); }
        else conflicts.push(`${key}/${id}`);
      }
      chosen = merged;
    } else { conflicts.push(key); continue; }
    if (chosen !== undefined) result[key] = chosen;
  }
  if (conflicts.length) throw new SyncConflict(remote, conflicts);
  return { ...result, ...(record(remote)._sync ? { _sync: record(remote)._sync } : {}) };
}

export async function conditionalWrite(db: Firestore, uid: string, base: unknown, next: object,
  normalize: (value: unknown) => object = value => record(value)): Promise<RecordData> {
  const ref = doc(db, 'users', uid, 'appData', 'main');
  await readWithTimeout(() => getDocFromServer(ref));
  for (let attempt = 0; ; attempt++) {
    let observed: unknown;
    try {
      return await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(ref);
        const remote = snapshot.exists() ? snapshot.data() : null;
        observed = remote;
        if (metadata(base).generation !== metadata(remote).generation) throw new GenerationConflict(remote);
        const merged = mergeFinancial(normalize(base), next, normalize(remote));
        if (remote !== null && equal(financial(merged), financial(normalize(remote)))) return record(remote);
        const committed = { ...merged, _sync: { ...metadata(remote), revision: metadata(remote).revision + 1 } };
        transaction.set(ref, committed);
        return committed;
      });
    } catch (error) {
      // Rules can reject an outdated revision before the transaction precondition
      // reports contention. Retry ONLY if a new server read proves a concurrent
      // change. Keep the original financial base on every retry.
      if (attempt >= 4 || record(error).code !== 'permission-denied' || observed === undefined) throw error;
      const latest = await readWithTimeout(() => getDocFromServer(ref));
      if (equal(observed, latest.exists() ? latest.data() : null)) throw error;
    }
  }
}
export function clearedFinancial(value: unknown, sync: SyncMetadata): RecordData {
  const source = record(value);
  return { ...source, historico: [], reservasDiarias: Array.isArray(source.reservasDiarias)
    ? source.reservasDiarias.map(item => ({ ...record(item), valor: 0 })) : [], _sync: sync };
}
export interface LocalStore {
  getItem(key: string): string | null; setItem(key: string, value: string): void;
  readonly length: number; key(index: number): string | null;
}
interface Envelope<T> { format: number; uid: string; base: unknown; data: T; pending: boolean; known: boolean }
export interface Recovery<T> { key: string; data: T; generation: number }
export interface ResetPlan {
  id: string; uid: string; expected: unknown; localVersion: string; backupKey: string;
  createdAt: string; startedOn: string; generation: number; remoteCount: number; localCount: number;
  hadPending: boolean; exported: boolean; phase: 'prepared' | 'executing' | 'uncertain' | 'committed';
}
export interface ResetConfirmation { uid: string; phrase: string; backupVerified: boolean }
export interface SyncTransport {
  read(): Promise<unknown>;
  write(base: unknown, next: object): Promise<unknown>;
  listen?(accept: (value: unknown) => void, offline: () => void): () => void;
  reset?(plan: ResetPlan): Promise<unknown>;
}
export async function resetTransaction(db: Firestore, uid: string, plan: ResetPlan): Promise<RecordData> {
  if (plan.uid !== uid) throw new Error('Conta incorreta');
  const ref = doc(db, 'users', uid, 'appData', 'main');
  await readWithTimeout(() => getDocFromServer(ref));
  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref), remote = snapshot.exists() ? snapshot.data() : null;
    // A lost acknowledgement must never clear movements entered after this reset.
    if (metadata(remote).resetId === plan.id && metadata(remote).generation === plan.generation) return record(remote);
    if (!equal(remote, plan.expected)) throw new SyncConflict(remote);
    if (plan.generation !== metadata(remote).generation + 1) throw new GenerationConflict(remote);
    const target = clearedFinancial(remote, { generation: plan.generation, revision: 0, resetId: plan.id, startedOn: plan.startedOn });
    transaction.set(ref, target);
    return target;
  });
}

export class SyncSession<T extends object> {
  data: T | null = null;
  base: unknown = null;
  remote: unknown = null;
  pending = false;
  conflict = false;
  oldGeneration = false;
  known = false;
  status = 'Carregando seus dados…';
  error = '';
  recoveries: Recovery<T>[] = [];
  resetPlan: ResetPlan | null = null;
  readonly prefix: string;
  readonly branch: string;
  onChange = () => {};
  private editSequence = 0;
  private task: Promise<void> | null = null;
  private closed = false;
  private stopListening: (() => void) | null = null;
  private deferred: { value: unknown } | null = null;
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
    const ref = doc(db, 'users', uid, 'appData', 'main');
    this.transport = transport ?? {
      read: async () => { const s = await getDocFromServer(ref); return s.exists() ? s.data() : null; },
      write: (base, next) => conditionalWrite(db, uid, base, next, value => this.normalized(value)),
      reset: plan => resetTransaction(db, uid, plan),
      listen: (accept, offline) => onSnapshot(ref, { includeMetadataChanges: true }, snapshot => {
        if (snapshot.metadata.fromCache) { offline(); return; }
        if (!snapshot.metadata.hasPendingWrites) accept(snapshot.exists() ? snapshot.data() : null);
      }, offline),
    };
  }
  private normalized(value: unknown): T { return value === null ? this.defaults() : this.decode(value); }
  private emit() { if (!this.closed) this.onChange(); }
  private persist(data = this.data, pending = this.pending, base = this.base, known = this.known, shared = true) {
    if (!data) throw new Error('Dados indisponíveis');
    const entry: Envelope<T> = { format: 2, uid: this.uid, base, data, pending, known };
    this.local.setItem(this.branch, JSON.stringify(entry));
    this.tab.setItem(this.prefix + '-session', this.branch);
    if (shared) { this.local.setItem(this.prefix, JSON.stringify(data)); this.local.setItem(this.prefix + '-pendente', String(pending)); }
  }
  private backup(label: string, data: unknown) {
    const key = `${this.prefix}-${label}-${crypto.randomUUID()}`;
    this.local.setItem(key, JSON.stringify(data)); return key;
  }
  private savePlan(plan: ResetPlan) {
    const text = JSON.stringify(plan);
    this.local.setItem(this.prefix + '-reset-intent-' + plan.id, text);
    this.tab.setItem(this.prefix + '-reset-session', plan.id);
    this.local.setItem(this.prefix + '-reset-intent', text);
    this.resetPlan = plan;
  }
  private load() {
    const pointer = this.tab.getItem(this.prefix + '-session');
    let recovered: Envelope<T> | null = null;
    for (let i = 0; i < this.local.length; i++) {
      const key = this.local.key(i); if (!key?.startsWith(this.prefix + '-sync-')) continue;
      try {
        const e: Envelope<T> = JSON.parse(this.local.getItem(key) || 'null');
        if (![1, 2].includes(e?.format) || e.uid !== this.uid) continue;
        const data = this.decode(e.data);
        if (key === pointer) recovered = { ...e, data };
        else if (e.pending) this.recoveries.push({ key, data, generation: metadata(e.base ?? data).generation });
      } catch { /* Preserve unreadable backups. */ }
    }
    if (recovered) { this.data = recovered.data; this.base = recovered.base; this.known = recovered.known; this.pending = recovered.pending; }
    else {
      const legacy = this.local.getItem(this.prefix);
      if (legacy) {
        if (!this.local.getItem(this.prefix + '-antes-reconstrucao')) this.local.setItem(this.prefix + '-antes-reconstrucao', legacy);
        this.data = this.decode(JSON.parse(legacy));
        this.pending = this.local.getItem(this.prefix + '-pendente') !== 'false';
        if (!this.pending) { this.base = this.data; this.known = true; }
      }
    }
    const resetId = this.tab.getItem(this.prefix + '-reset-session');
    const intent = resetId ? this.local.getItem(this.prefix + '-reset-intent-' + resetId) : this.local.getItem(this.prefix + '-reset-intent');
    if (intent) { const plan: ResetPlan = JSON.parse(intent); if (plan.uid === this.uid) this.resetPlan = plan; }
  }
  async start() {
    try { this.load(); } catch { this.error = 'Não foi possível ler uma cópia local. As cópias existentes foram mantidas.'; }
    if (this.closed) return;
    if (this.data) { this.status = 'Salvo localmente. Verificando a nuvem…'; this.emit(); }
    await this.refresh();
    if (!this.closed && this.transport.listen) this.stopListening = this.transport.listen(cloud => {
      if (this.task) this.deferred = { value: cloud }; else this.accept(cloud);
    }, () => { if (!this.closed) { this.status = this.conflict ? 'Conflito identificado.' : 'Salvo localmente. Sem conexão confirmada.'; this.emit(); } });
  }
  private accept(cloud: unknown) {
    if (this.closed) return;
    try {
      // Ignore older server events already acknowledged by this session.
      if (this.known && metadata(cloud).generation < metadata(this.base).generation) return;
      if (this.known && metadata(cloud).generation === metadata(this.base).generation && metadata(cloud).revision < metadata(this.base).revision) return;
      this.remote = cloud;
      if (this.data && this.pending && (this.oldGeneration || metadata(this.data).generation !== metadata(this.known ? this.base : this.data).generation))
        throw new GenerationConflict(cloud);
      if (this.resetPlan && ['executing', 'uncertain'].includes(this.resetPlan.phase)) {
        if (metadata(cloud).resetId === this.resetPlan.id) this.finishReset(cloud);
        else { this.status = 'Reinicialização sem confirmação. Verifique o resultado antes de continuar.'; this.emit(); }
        return;
      }
      let next: T;
      let pending = this.pending;
      if (!this.data) {
        if (cloud && !this.local.getItem(this.prefix + '-nuvem-antes-reconstrucao'))
          this.local.setItem(this.prefix + '-nuvem-antes-reconstrucao', JSON.stringify(cloud));
        next = this.normalized(cloud); pending = false;
      }
      else if (metadata(this.known ? this.base : this.data).generation !== metadata(cloud).generation) {
        this.backup('geracao-anterior-local', this.data); this.backup('nova-geracao-nuvem', cloud);
        this.conflict = true; this.oldGeneration = true;
        this.status = 'Conflito identificado: a conta foi reinicializada. A cópia antiga foi preservada e não será reenviada.';
        this.emit(); return;
      } else if (!this.known && pending && !equal(financial(this.data), financial(this.normalized(cloud)))) throw new SyncConflict(cloud);
      else if (pending) {
        next = this.decode(mergeFinancial(this.normalized(this.base), this.data, this.normalized(cloud)));
        pending = !equal(financial(next), financial(this.normalized(cloud)));
      } else next = this.normalized(cloud);
      this.persist(next, pending, cloud, true, false);
      this.data = next; this.base = cloud; this.known = true; this.pending = pending;
      this.conflict = false; this.oldGeneration = false; this.error = '';
      this.status = pending ? 'Salvo localmente.' : 'Salvo na nuvem.';
      this.emit();
      if (pending) queueMicrotask(() => { void this.flush(); });
    } catch (error) {
      if (error instanceof SyncConflict) {
        this.conflict = true;
        if (error instanceof GenerationConflict) this.oldGeneration = true;
        try { this.backup('conflito-local', this.data); this.backup('conflito-nuvem', cloud); } catch { /* Original journal remains. */ }
        this.status = this.oldGeneration ? 'Conflito identificado: geração anterior bloqueada. As cópias foram preservadas.'
          : 'Conflito identificado. As versões foram preservadas.';
      } else this.error = 'Não foi possível preservar ou ler os dados recebidos. Exporte um backup e verifique o armazenamento.';
      this.emit();
    }
  }
  async refresh() {
    if (this.task) return this.task;
    const sequence = this.editSequence;
    try { const cloud = await readWithTimeout(() => this.transport.read()); if (sequence === this.editSequence) this.accept(cloud); }
    catch { this.status = 'Salvo localmente. Sem confirmação da nuvem.'; if (!this.data) this.error = 'Não foi possível recuperar seus dados. Verifique a conexão e tente novamente.'; this.emit(); }
  }
  update(transform: (data: T) => T, formBase?: T) {
    if (!this.data || this.closed || this.resetPlan && ['executing', 'uncertain'].includes(this.resetPlan.phase)) return false;
    try {
      const proposal = transform(structuredClone(formBase ?? this.data));
      let next = proposal, conflict = this.conflict;
      if (formBase) {
        if (metadata(formBase).generation !== metadata(this.data).generation) { this.oldGeneration = true; conflict = true; }
        else try { next = this.decode(mergeFinancial(formBase, proposal, this.data)); }
        catch (error) { if (!(error instanceof SyncConflict)) throw error; conflict = true; this.backup('antes-edicao-conflitante', this.data); }
      }
      this.persist(next, true);
      this.data = next; this.pending = true; this.conflict = conflict; this.editSequence++;
      this.error = ''; this.status = conflict ? 'Conflito identificado. Salvo localmente.' : 'Salvo localmente.';
      this.emit(); void this.flush(); return true;
    } catch { this.error = 'Não foi possível salvar neste navegador. Exporte um backup e libere espaço antes de continuar.'; this.emit(); return false; }
  }
  flush(): Promise<void> {
    if (this.task) return this.task;
    if (this.closed || !this.pending || this.conflict || !this.known || !this.data || this.resetPlan && ['executing', 'uncertain'].includes(this.resetPlan.phase)) return Promise.resolve();
    this.task = this.drain().finally(() => {
      this.task = null;
      const deferred = this.deferred; this.deferred = null;
      if (deferred) this.accept(deferred.value);
    }); return this.task;
  }
  private async drain() {
    while (!this.closed && this.pending && !this.conflict && this.data) {
      const sent = structuredClone(this.data), sequence = this.editSequence;
      this.status = 'Sincronizando.'; this.emit();
      try {
        const result = await this.transport.write(this.base, sent);
        if (this.closed) return;
        const committed = result ?? await this.transport.read();
        const current = sequence === this.editSequence ? this.normalized(committed)
          : this.decode(mergeFinancial(sent, this.data, this.normalized(committed)));
        const pending = !equal(financial(current), financial(this.normalized(committed)));
        this.persist(current, pending, committed, true);
        this.data = current; this.base = committed; this.remote = committed; this.pending = pending;
        this.status = pending ? 'Salvo localmente.' : 'Salvo na nuvem.';
      } catch (error) {
        if (error instanceof SyncConflict) {
          this.remote = error.remote; this.conflict = true; this.oldGeneration = error instanceof GenerationConflict;
          try { this.backup('conflito-local', this.data); this.backup('conflito-nuvem', error.remote); } catch { /* Keep journal. */ }
          this.status = this.oldGeneration ? 'Conflito identificado: geração anterior bloqueada.' : 'Conflito identificado.';
        } else this.status = 'Salvo localmente. A sincronização será tentada novamente quando houver conexão.';
        this.emit(); return;
      }
      this.emit();
    }
  }
  async resolve(source: 'local' | 'nuvem', expectedVersion = version(this.remote)) {
    if (!this.data || this.task || this.closed) return false;
    const sequence = this.editSequence;
    try {
      const cloud = await readWithTimeout(() => this.transport.read());
      if (this.closed || sequence !== this.editSequence) return false;
      this.backup('antes-resolver-local', this.data); this.backup('antes-resolver-nuvem', cloud);
      this.local.setItem(this.prefix + '-antes-resolver-local', JSON.stringify(this.data));
      this.local.setItem(this.prefix + '-antes-resolver-nuvem', JSON.stringify(cloud));
      if (!equal(expectedVersion, version(cloud))) { this.remote = cloud; this.status = 'A nuvem mudou novamente. Compare as versões antes de confirmar.'; this.emit(); return false; }
      if (source === 'local' && (this.oldGeneration || metadata(this.known ? this.base : this.data).generation !== metadata(cloud).generation)) {
        this.oldGeneration = true; this.conflict = true; this.status = 'A cópia pertence à geração anterior. Exporte-a; ela não pode substituir a geração atual.'; this.emit(); return false;
      }
      const next = source === 'local' ? this.data : this.normalized(cloud);
      this.persist(next, source === 'local', cloud, true);
      this.data = next; this.base = cloud; this.known = true; this.pending = source === 'local';
      this.conflict = false; this.oldGeneration = false; this.editSequence++; this.error = '';
      this.status = 'Salvo localmente.'; this.emit();
      if (this.pending) await this.flush(); else { this.status = 'Salvo na nuvem.'; this.emit(); }
      return !this.conflict;
    } catch { this.error = 'Não foi possível confirmar a escolha. As cópias locais foram mantidas.'; this.emit(); return false; }
  }
  recover(key: string) {
    const entry = this.recoveries.find(item => item.key === key);
    if (!entry || !this.data || this.task) return false;
    try {
      this.backup('antes-recuperar', this.data); this.persist(entry.data, true, this.base, false);
      this.oldGeneration = entry.generation !== metadata(this.remote).generation;
      this.data = entry.data; this.pending = true; this.known = false; this.conflict = true; this.editSequence++;
      this.status = 'Cópia preservada. Compare as versões antes de continuar.'; this.emit(); return true;
    } catch { this.error = 'Não foi possível preservar as cópias.'; this.emit(); return false; }
  }
  async prepareReset(startedOn = '2026-11-17') {
    if (!this.data || this.task || this.closed || this.resetPlan && ['executing', 'uncertain'].includes(this.resetPlan.phase)
      || !/^\d{4}-\d{2}-\d{2}$/.test(startedOn)) throw new Error('Verifique a sincronização e qualquer reinicialização pendente antes de preparar outra.');
    const sequence = this.editSequence, cloud = await readWithTimeout(() => this.transport.read());
    if (this.closed || sequence !== this.editSequence) throw new Error('Os dados mudaram; prepare um novo backup.');
    const localCopies: Record<string, unknown> = {};
    for (let i = 0; i < this.local.length; i++) {
      const key = this.local.key(i); if (!key || !(key === this.prefix || key.startsWith(this.prefix + '-'))) continue;
      const text = this.local.getItem(key); try { localCopies[key] = JSON.parse(text || 'null'); } catch { localCopies[key] = text; }
    }
    const backup = { schema: 'appcar-reset-backup-v1', uid: this.uid, createdAt: new Date().toISOString(),
      startedOn, remote: cloud, local: this.data, base: this.base, pending: this.pending, conflict: this.conflict, localCopies };
    const backupKey = this.backup('reset-backup', backup);
    const plan: ResetPlan = { id: crypto.randomUUID(), uid: this.uid, expected: cloud, localVersion: version(this.data), backupKey,
      createdAt: backup.createdAt, startedOn, generation: metadata(cloud).generation + 1,
      remoteCount: Array.isArray(record(cloud).historico) ? (record(cloud).historico as unknown[]).length : 0,
      localCount: Array.isArray(record(this.data).historico) ? (record(this.data).historico as unknown[]).length : 0,
      hadPending: this.pending || this.conflict, exported: false, phase: 'prepared' };
    this.savePlan(plan); this.emit(); return plan;
  }
  resetBackup(id: string): unknown {
    if (this.resetPlan?.id !== id) throw new Error('Preparação inválida');
    const text = this.local.getItem(this.resetPlan.backupKey); if (!text) throw new Error('Backup não encontrado');
    const backup = JSON.parse(text);
    if (backup.uid !== this.uid || backup.schema !== 'appcar-reset-backup-v1') throw new Error('Backup de outra conta');
    return backup;
  }
  markResetExported(id: string) {
    this.resetBackup(id); this.savePlan({ ...this.resetPlan!, exported: true }); this.emit();
  }
  async executeReset(id: string, confirmation: ResetConfirmation) {
    const plan = this.resetPlan;
    if (!plan || plan.id !== id || this.task || this.closed || !this.data) return false;
    if (confirmation.uid !== this.uid || confirmation.phrase !== 'REINICIAR MINHA CONTA' || !confirmation.backupVerified || !plan.exported)
      throw new Error('Confirme a conta, a frase e o backup exportado antes de reiniciar.');
    this.resetBackup(id);
    if (plan.localVersion !== version(this.data)) throw new Error('Há novas alterações locais. Prepare e confira outro backup.');
    this.savePlan({ ...plan, phase: 'executing' }); this.status = 'Verificando a reinicialização…'; this.emit();
    let success = false;
    this.task = (async () => {
      try {
        const cloud = await (this.transport.reset ? this.transport.reset(plan) : resetTransaction(this.db, this.uid, plan));
        if (!this.closed) { this.finishReset(cloud); success = true; }
      } catch (error) {
        this.savePlan({ ...plan, phase: error instanceof SyncConflict ? 'prepared' : 'uncertain' });
        this.error = error instanceof SyncConflict ? 'A nuvem mudou. Prepare e exporte um novo backup antes de confirmar.'
          : 'Reinicialização sem confirmação. Verifique o resultado; não repita a limpeza às cegas.';
        this.status = 'Salvo localmente. Reinicialização sem confirmação.'; this.emit();
      }
    })().finally(() => { this.task = null; const deferred = this.deferred; this.deferred = null; if (deferred) this.accept(deferred.value); });
    await this.task; return success || this.resetPlan?.id === id && this.resetPlan.phase === 'committed';
  }
  private finishReset(cloud: unknown) {
    const next = this.normalized(cloud); this.persist(next, false, cloud, true);
    this.data = next; this.base = cloud; this.remote = cloud; this.pending = false; this.known = true;
    this.conflict = false; this.oldGeneration = false; this.editSequence++;
    if (this.resetPlan) this.savePlan({ ...this.resetPlan, phase: 'committed' });
    this.error = ''; this.status = 'Salvo na nuvem. Nova geração financeira iniciada.'; this.emit();
  }
  async checkReset() {
    const plan = this.resetPlan; if (!plan || this.task) return false;
    const cloud = await readWithTimeout(() => this.transport.read());
    if (metadata(cloud).resetId === plan.id) { this.finishReset(cloud); return true; }
    else if (equal(cloud, plan.expected)) { this.savePlan({ ...plan, phase: 'prepared' }); this.error = 'Nenhuma reinicialização foi confirmada. Confira o backup e confirme novamente se desejar.'; this.emit(); }
    else { this.error = 'A nuvem mudou. Exporte as cópias e prepare uma nova reinicialização.'; this.emit(); }
    return false;
  }
  async retry() { await this.refresh(); if (!this.conflict) await this.flush(); }
  async wait() { await this.flush(); if (this.pending || this.conflict || this.resetPlan && ['executing', 'uncertain'].includes(this.resetPlan.phase)) throw new Error('Sincronização pendente'); }
  close() { this.closed = true; this.stopListening?.(); this.onChange = () => {}; }
}
