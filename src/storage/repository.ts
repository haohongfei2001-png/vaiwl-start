import type { AccountScope, CandidateResolution, ConfirmedOpenDay, ConversationRecord, EvidenceWitness, ImportCheckpoint, Membership, OpenDisposition, OpenIntent, OpenIntentEvidence, ProjectRecord, StartSettings, Tombstone, WebsiteShortcut } from '../../contracts/free-v1.js';
import { conversationKey, parseConversationUrl, parseProjectUrl, projectKey, scopeKey, stagingKey, tupleHash, validateWebsiteUrl } from '../domain/ids.js';
import { parseLocalProjectCandidate } from '../collectors/chatgpt/project-candidate.js';
import { activitySummary, upsertOpenDay } from '../domain/open-activity.js';
import { reduceMembership, validateMembership } from '../domain/membership.js';
import { dayLabel, instant, localDay, validateTimeZone } from '../domain/time.js';
import { boundedString, exactObject, iso, nonnegative, title } from '../domain/validation.js';
import { openDatabase, request, STORE_NAMES, transactionDone } from './db.js';

export interface CandidateInput { url: string; title?: string | null; lastVisitAt?: string | null; source?: 'local' | 'synced' | 'unknown'; titleBasis?: 'browser-history' | 'native-label' | 'unknown' }
export interface RuntimeImportJob extends ImportCheckpoint { includeSynced?: boolean; seenKeys?: string[]; errorCode?: string; pendingCandidates?: CandidateInput[]; failureCode?: 'history-api-failed' | 'saturated-time-slice' | null }
export interface CatalogSnapshot { revision: number; settings: StartSettings; localProfileKey: string; scopes: AccountScope[]; conversations: ConversationRecord[]; projects: ProjectRecord[]; shortcuts: WebsiteShortcut[]; importJobs: RuntimeImportJob[]; tombstones: Tombstone[] }
interface SettingsRow extends StartSettings { key: 'main'; localProfileKey: string }
interface RevisionRow { key: 'main'; value: number; nextRank: number }
type StoredConversation = ConversationRecord & { ownerKey: string; membershipState: Membership['state']; projectId?: string; lastActiveAt?: string; browserSource?: 'local' | 'synced' | 'unknown' };
interface StoredTombstone extends Tombstone { record?: StoredConversation }
export interface IntentBinding { targetTabId: number; targetDocumentId: string; routeEpoch: number; scopeEpoch: number }
interface StoredIntent extends OpenIntent { binding?: IntentBinding }
export interface IssueIntentInput { id?: string; browserSessionId: string; targetRecordKey: string; evidence: OpenIntentEvidence; disposition: OpenDisposition; sourceTabId: number; sourceScopeEpoch: number }
export interface ArrivalInput extends IntentBinding { intentId: string; browserSessionId: string; conversationId: string; canonicalUrl: string; scopeKey: string | null; evidenceId?: string; nativeTitle?: string | null; arrivalConfirmed: true; confirmationBasis?: 'browser-navigation' | 'metadata-arrival' }
export interface ObservationInput { scope: AccountScope; witness: EvidenceWitness; documentId: string; routeEpoch: number; scopeEpoch: number; conversationUrl: string; nativeTitle: string | null; membership: Membership; project?: ProjectRecord }
type MutationContext = { tx: IDBTransaction; revision: RevisionRow; settings: SettingsRow; changed: () => void; rank: () => number };

function defaults(timeZone: string, profile = crypto.randomUUID()): SettingsRow {
  return { key: 'main', localProfileKey: profile, schemaVersion: 1, libraryTimeZone: validateTimeZone(timeZone), shortcutSectionCollapsed: false, selectedScope: 'unassigned', currentSegment: 0, captureEnabled: false };
}
function decorate(record: ConversationRecord, browserSource?: StoredConversation['browserSource']): StoredConversation {
  const out: StoredConversation = { ...record, ownerKey: record.owner.kind === 'scoped' ? record.owner.scopeKey : `unassigned:${record.owner.localProfileKey}`, membershipState: record.membership.state };
  if (record.membership.state === 'PROJECT') out.projectId = record.membership.projectId;
  if (record.activity) out.lastActiveAt = record.activity.lastConfirmedOpenAt;
  if (browserSource) out.browserSource = browserSource;
  return out;
}
function publicRecord(record: StoredConversation): ConversationRecord {
  const { ownerKey: _owner, membershipState: _membership, projectId: _project, lastActiveAt: _activity, browserSource: _source, ...rest } = record;
  return rest as ConversationRecord;
}
function settingsValue(row: SettingsRow): StartSettings { const { key: _key, localProfileKey: _profile, ...rest } = row; return rest; }
function newCandidate(key: string, profile: string, identity: NonNullable<ReturnType<typeof parseConversationUrl>>, input: CandidateInput, now: string, rank: number, revision: number): StoredConversation {
  return decorate({ key, provider: 'chatgpt', owner: { kind: 'unassigned', localProfileKey: profile, accountKey: null }, conversationId: identity.conversationId, canonicalUrl: identity.canonicalUrl, nativeTitle: title(input.title), titleBasis: input.title ? input.titleBasis ?? 'browser-history' : 'unknown', titleObservedAt: input.title ? now : null, availability: 'unverified', firstSeenAt: now, lastSeenAt: now, browserLastVisitAt: input.lastVisitAt ? iso(input.lastVisitAt) : null, activity: null, stableRank: rank, revision, membership: { state: 'UNKNOWN', projectId: null, reason: 'scope-unverified' } }, input.source ?? 'unknown');
}

export class Repository {
  constructor(private readonly db: IDBDatabase, private readonly clock: () => string) {}
  close(): void { this.db.close(); }
  private now(): string { return iso(this.clock()); }
  private async mutate<T>(fn: (ctx: MutationContext) => Promise<T>, expectedRevision?: number): Promise<T> {
    const tx = this.db.transaction([...STORE_NAMES], 'readwrite'); const done = transactionDone(tx);
    try {
      const revision = await request<RevisionRow>(tx.objectStore('revisions').get('main'));
      const settings = await request<SettingsRow>(tx.objectStore('settings').get('main'));
      if (!revision || !settings) throw Error('database-not-initialized');
      if (expectedRevision !== undefined && nonnegative(expectedRevision) !== revision.value) throw Error('revision-conflict');
      let dirty = false;
      const result = await fn({ tx, revision, settings, changed: () => { dirty = true; }, rank: () => { dirty = true; return revision.nextRank++; } });
      if (dirty) { revision.value++; await request(tx.objectStore('revisions').put(revision)); }
      await done; return result;
    } catch (error) { try { tx.abort(); } catch {} await done.catch(() => {}); throw error; }
  }
  async getSnapshot(selectedScope?: string): Promise<CatalogSnapshot> {
    const tx = this.db.transaction([...STORE_NAMES], 'readonly'); const done = transactionDone(tx);
    const [settings, revision, scopes, records, projects, shortcuts, importJobs, tombstones, links] = await Promise.all([
      request<SettingsRow>(tx.objectStore('settings').get('main')),
      request<RevisionRow>(tx.objectStore('revisions').get('main')),
      request<AccountScope[]>(tx.objectStore('scopes').getAll()),
      request<StoredConversation[]>(tx.objectStore('conversations').getAll()),
      request<ProjectRecord[]>(tx.objectStore('projects').getAll()),
      request<WebsiteShortcut[]>(tx.objectStore('shortcuts').getAll()),
      request<RuntimeImportJob[]>(tx.objectStore('importJobs').getAll()),
      request<StoredTombstone[]>(tx.objectStore('tombstones').getAll()),
      request<CandidateResolution[]>(tx.objectStore('candidateLinks').getAll()),
    ]);
    await done;
    const selected = selectedScope ?? settings.selectedScope;
    if (selected !== 'unassigned' && !scopes.some(s => s.key === selected)) throw Error('unknown-scope');
    const removed = new Set(tombstones.map(t => t.key));
    const resolvedCandidates = new Set(links.map(link => link.candidateRecordKey));
    return { revision: revision.value, settings: settingsValue(settings), localProfileKey: settings.localProfileKey, scopes, conversations: records.filter(r => !removed.has(r.key) && (selected === 'unassigned' ? r.owner.kind === 'unassigned' && !resolvedCandidates.has(r.key) : r.owner.kind === 'scoped' && r.owner.scopeKey === selected)).map(publicRecord), projects: projects.filter(p => p.scopeKey === selected), shortcuts: shortcuts.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)), importJobs, tombstones: tombstones.filter(t => t.record && (selected === 'unassigned' ? t.record.owner.kind === 'unassigned' : t.record.owner.kind === 'scoped' && t.record.owner.scopeKey === selected)).map(({ key, removedAt, reason }) => ({ key, removedAt, reason })) };
  }
  async discoverCandidates(inputs: CandidateInput[], expectedRevision?: number, checkpoint?: RuntimeImportJob): Promise<{ accepted: number; inserted: number }> {
    if (!Array.isArray(inputs) || inputs.length > 200) throw Error('invalid-candidate-batch');
    const initial = await this.getSnapshot('unassigned');
    const prepared = await Promise.all(inputs.map(async input => {
      exactObject(input, ['url'], ['title', 'lastVisitAt', 'source', 'titleBasis']);
      const identity = parseConversationUrl(input.url); if (!identity) throw Error('invalid-conversation-url');
      title(input.title); if (input.lastVisitAt) iso(input.lastVisitAt);
      if (input.source && !['local', 'synced', 'unknown'].includes(input.source)) throw Error('invalid-history-source');
      if (input.titleBasis && !['browser-history', 'native-label', 'unknown'].includes(input.titleBasis)) throw Error('invalid-title-basis');
      return { input, identity, key: await stagingKey(initial.localProfileKey, identity.conversationId) };
    }));
    if (checkpoint) validateImportJob(checkpoint);
    const now = this.now();
    return this.mutate(async ctx => {
      if (ctx.settings.localProfileKey !== initial.localProfileKey) throw Error('profile-changed');
      const store = ctx.tx.objectStore('conversations'); let accepted = 0, inserted = 0;
      for (const p of prepared) {
        if (await request(ctx.tx.objectStore('tombstones').get(p.key))) continue;
        const previous = await request<StoredConversation | undefined>(store.get(p.key));
        const fresh = newCandidate(p.key, ctx.settings.localProfileKey, p.identity, p.input, now, previous?.stableRank ?? ctx.rank(), ctx.revision.value + 1);
        if (previous) {
          fresh.firstSeenAt = previous.firstSeenAt; fresh.activity = previous.activity; fresh.availability = previous.availability;
          if (previous.localProjectCandidate) fresh.localProjectCandidate = previous.localProjectCandidate;
          if (!fresh.nativeTitle || previous.titleBasis === 'native-label' && fresh.titleBasis !== 'native-label') { fresh.nativeTitle = previous.nativeTitle; fresh.titleBasis = previous.titleBasis; fresh.titleObservedAt = previous.titleObservedAt; }
          if (!fresh.browserLastVisitAt || previous.browserLastVisitAt && instant(previous.browserLastVisitAt)! > instant(fresh.browserLastVisitAt)!) fresh.browserLastVisitAt = previous.browserLastVisitAt;
        } else inserted++;
        await request(store.put(decorate(fresh, p.input.source))); accepted++; ctx.changed();
      }
      if (checkpoint) { await request(ctx.tx.objectStore('importJobs').put(checkpoint)); ctx.changed(); }
      return { accepted, inserted };
    }, expectedRevision);
  }
  /** A bounded Project observation stays in the local Profile library. It never
   * grants ownership, creates AccountScope/Project assets, or writes activity. */
  async observeLocalProjectCandidate(value: unknown, context: { browserSessionId: string; bindingId: string; observationId: string; sourceHref: string }): Promise<number> {
    exactObject(context, ['browserSessionId', 'bindingId', 'observationId', 'sourceHref']);
    boundedString(context.browserSessionId, 128); boundedString(context.bindingId, 128); boundedString(context.observationId, 128);
    const candidate = parseLocalProjectCandidate(value, context.sourceHref);
    const initial = await this.getSnapshot('unassigned');
    const candidateKey = await tupleHash('local-project', initial.localProfileKey, context.browserSessionId, context.bindingId, context.observationId, candidate.projectId);
    const prepared = await Promise.all(candidate.members.map(async member => ({ member, key: await stagingKey(initial.localProfileKey, member.conversationId) })));
    const now = this.now();
    return this.mutate(async ctx => {
      if (!ctx.settings.captureEnabled || ctx.settings.localProfileKey !== initial.localProfileKey) throw Error('PERMISSION_REQUIRED');
      const conversations = ctx.tx.objectStore('conversations'); let accepted = 0;
      for (const { member, key } of prepared) {
        if (await request(ctx.tx.objectStore('tombstones').get(key))) continue;
        const old = await request<StoredConversation | undefined>(conversations.get(key));
        if (old && (old.owner.kind !== 'unassigned' || old.owner.localProfileKey !== ctx.settings.localProfileKey || old.membership.state !== 'UNKNOWN')) continue;
        const record = old ?? newCandidate(key, ctx.settings.localProfileKey, parseConversationUrl(member.canonicalUrl)!, { url: member.canonicalUrl, title: member.nativeTitle, titleBasis: 'native-label' }, now, ctx.rank(), ctx.revision.value + 1);
        record.localProjectCandidate = { key: candidateKey, projectId: candidate.projectId, nativeTitle: candidate.nativeTitle, canonicalUrl: candidate.canonicalUrl, observedAt: now, basis: 'local-project-observation' };
        record.nativeTitle = member.nativeTitle; record.titleBasis = 'native-label'; record.titleObservedAt = now;
        record.lastSeenAt = now; record.revision = ctx.revision.value + 1;
        await request(conversations.put(decorate(record, old?.browserSource))); accepted++; ctx.changed();
      }
      return accepted;
    });
  }
  async saveImportJob(job: RuntimeImportJob, expectedRevision?: number): Promise<void> {
    validateImportJob(job);
    await this.mutate(async ctx => { await request(ctx.tx.objectStore('importJobs').put(job)); ctx.changed(); }, expectedRevision);
  }
  async setSettings(patch: Partial<StartSettings>, expectedRevision?: number): Promise<void> {
    exactObject(patch, [], ['libraryTimeZone', 'shortcutSectionCollapsed', 'selectedScope', 'currentSegment', 'captureEnabled']);
    if (patch.libraryTimeZone !== undefined) validateTimeZone(patch.libraryTimeZone);
    if (patch.shortcutSectionCollapsed !== undefined && typeof patch.shortcutSectionCollapsed !== 'boolean' || patch.captureEnabled !== undefined && typeof patch.captureEnabled !== 'boolean') throw Error('invalid-settings');
    if (patch.currentSegment !== undefined) nonnegative(patch.currentSegment);
    await this.mutate(async ctx => {
      if (patch.selectedScope !== undefined && patch.selectedScope !== 'unassigned' && !await request(ctx.tx.objectStore('scopes').get(patch.selectedScope))) throw Error('unknown-scope');
      await request(ctx.tx.objectStore('settings').put({ ...ctx.settings, ...patch })); ctx.changed();
    }, expectedRevision);
  }
  async saveShortcut(input: { id?: string; label: string; url: string; pinned?: boolean }, expectedRevision?: number): Promise<WebsiteShortcut> {
    exactObject(input, ['label', 'url'], ['id', 'pinned']);
    const label = boundedString(input.label, 100), url = validateWebsiteUrl(input.url), id = input.id ? boundedString(input.id, 128) : crypto.randomUUID();
    if (input.pinned !== undefined && typeof input.pinned !== 'boolean') throw Error('invalid-shortcut');
    const now = this.now();
    return this.mutate(async ctx => {
      const store = ctx.tx.objectStore('shortcuts'); const old = await request<WebsiteShortcut | undefined>(store.get(id));
      if (input.id && !old) throw Error('shortcut-not-found');
      const all = await request<WebsiteShortcut[]>(store.getAll());
      const item: WebsiteShortcut = { id, label, url, icon: { kind: 'monogram', value: [...label][0]!.toLocaleUpperCase() }, pinned: input.pinned ?? old?.pinned ?? false, order: old?.order ?? (all.length ? Math.max(...all.map(s => s.order)) + 1 : 0), createdAt: old?.createdAt ?? now, updatedAt: now };
      await request(store.put(item)); ctx.changed(); return item;
    }, expectedRevision);
  }
  async moveShortcut(id: string, toIndex: number, expectedRevision?: number): Promise<void> {
    nonnegative(toIndex); const now = this.now();
    await this.mutate(async ctx => {
      const store = ctx.tx.objectStore('shortcuts'); const all = (await request<WebsiteShortcut[]>(store.getAll())).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
      const from = all.findIndex(s => s.id === id); if (from < 0 || toIndex >= all.length) throw Error('invalid-shortcut-position');
      all.splice(toIndex, 0, all.splice(from, 1)[0]!);
      for (const [order, item] of all.entries()) await request(store.put({ ...item, order, updatedAt: now }));
      ctx.changed();
    }, expectedRevision);
  }
  async removeShortcut(id: string, expectedRevision?: number): Promise<void> {
    boundedString(id, 128); await this.mutate(async ctx => { await request(ctx.tx.objectStore('shortcuts').delete(id)); ctx.changed(); }, expectedRevision);
  }
  async removeConversation(key: string, expectedRevision?: number): Promise<void> {
    boundedString(key, 128); const now = this.now();
    await this.mutate(async ctx => { const store = ctx.tx.objectStore('conversations'), record = await request<StoredConversation | undefined>(store.get(key)); if (!record) throw Error('conversation-not-found'); await request(ctx.tx.objectStore('tombstones').put({ key, removedAt: now, reason: 'user-removed', record } satisfies StoredTombstone)); await request(store.delete(key)); ctx.changed(); }, expectedRevision);
  }
  async restoreConversation(key: string, expectedRevision?: number): Promise<void> {
    boundedString(key, 128);
    await this.mutate(async ctx => { const store = ctx.tx.objectStore('tombstones'); const removed = await request<StoredTombstone | undefined>(store.get(key)); if (!removed) return; if (removed.record) await request(ctx.tx.objectStore('conversations').put({ ...removed.record, revision: ctx.revision.value + 1 })); await request(store.delete(key)); ctx.changed(); }, expectedRevision);
  }
  async clearLocalData(expectedRevision?: number): Promise<void> {
    const profile = crypto.randomUUID();
    await this.mutate(async ctx => { for (const store of STORE_NAMES) if (!['settings', 'revisions'].includes(store)) await request(ctx.tx.objectStore(store).clear()); await request(ctx.tx.objectStore('settings').put(defaults(ctx.settings.libraryTimeZone, profile))); ctx.revision.nextRank = 0; ctx.changed(); }, expectedRevision);
  }
  async issueIntent(input: IssueIntentInput): Promise<OpenIntent> {
    exactObject(input, ['browserSessionId', 'targetRecordKey', 'evidence', 'disposition', 'sourceTabId', 'sourceScopeEpoch'], ['id']);
    boundedString(input.browserSessionId, 128); boundedString(input.targetRecordKey, 128); nonnegative(input.sourceTabId); nonnegative(input.sourceScopeEpoch);
    if (!['same-tab', 'new-background-tab', 'new-foreground-tab', 'new-window'].includes(input.disposition)) throw Error('invalid-disposition');
    validateIntentEvidence(input.evidence);
    const now = this.now(), id = input.id ? boundedString(input.id, 128) : crypto.randomUUID();
    return this.mutate(async ctx => {
      const store = ctx.tx.objectStore('openIntents');
      const existing = await request<StoredIntent | undefined>(store.get(id));
      if (existing) {
        if (existing.browserSessionId !== input.browserSessionId || existing.targetRecordKey !== input.targetRecordKey || existing.sourceTabId !== input.sourceTabId || JSON.stringify(existing.evidence) !== JSON.stringify(input.evidence)) throw Error('intent-id-conflict');
        return existing;
      }
      const record = await request<StoredConversation | undefined>(ctx.tx.objectStore('conversations').get(input.targetRecordKey));
      if (!record || await request(ctx.tx.objectStore('tombstones').get(record.key))) throw Error('conversation-not-found');
      const intent: StoredIntent = { id, browserSessionId: input.browserSessionId, targetRecordKey: record.key, resolvedRecordKey: null, committedRecordKey: null, targetConversationId: record.conversationId, expectedScopeKey: record.owner.kind === 'scoped' ? record.owner.scopeKey : null, targetUrl: record.canonicalUrl, evidence: input.evidence, disposition: input.disposition, sourceTabId: input.sourceTabId, targetTabId: null, targetDocumentId: null, sourceScopeEpoch: input.sourceScopeEpoch, issuedAt: now, issuedTimeZone: ctx.settings.libraryTimeZone, issuedLocalDate: dayLabel(localDay(now, ctx.settings.libraryTimeZone)), expiresAt: new Date(instant(now)! + 60_000).toISOString(), state: 'issued' };
      await request(store.put(intent)); ctx.changed(); return intent;
    });
  }
  async dispatchIntent(id: string, browserSessionId: string, binding: { targetTabId: number; targetDocumentId?: string; routeEpoch?: number; scopeEpoch?: number }): Promise<OpenIntent> {
    nonnegative(binding.targetTabId);
    return this.mutate(async ctx => {
      const store = ctx.tx.objectStore('openIntents'), intent = await request<StoredIntent | undefined>(store.get(id));
      if (!intent || intent.browserSessionId !== browserSessionId || !['issued', 'navigation-dispatched'].includes(intent.state)) throw Error('invalid-intent-state');
      if (intent.targetTabId !== null && intent.targetTabId !== binding.targetTabId) throw Error('intent-target-conflict');
      intent.targetTabId = binding.targetTabId; intent.state = 'navigation-dispatched';
      if (binding.targetDocumentId !== undefined) {
        if (binding.routeEpoch === undefined || binding.scopeEpoch === undefined) throw Error('incomplete-arrival-binding');
        intent.targetDocumentId = boundedString(binding.targetDocumentId, 128);
        intent.binding = { targetTabId: binding.targetTabId, targetDocumentId: binding.targetDocumentId, routeEpoch: nonnegative(binding.routeEpoch), scopeEpoch: nonnegative(binding.scopeEpoch) };
      }
      await request(store.put(intent)); ctx.changed(); return intent;
    });
  }
  async bindIntentTarget(id: string, browserSessionId: string, binding: IntentBinding): Promise<void> {
    boundedString(binding.targetDocumentId, 128); nonnegative(binding.targetTabId); nonnegative(binding.routeEpoch); nonnegative(binding.scopeEpoch);
    await this.mutate(async ctx => {
      const store = ctx.tx.objectStore('openIntents'), intent = await request<StoredIntent | undefined>(store.get(id));
      if (!intent || intent.browserSessionId !== browserSessionId || intent.state !== 'navigation-dispatched' || intent.targetTabId !== binding.targetTabId || intent.sourceScopeEpoch !== binding.scopeEpoch) throw Error('stale-intent-binding');
      if (intent.binding && JSON.stringify(intent.binding) !== JSON.stringify(binding)) throw Error('intent-binding-conflict');
      if (intent.evidence.kind === 'native-link-gesture' && intent.evidence.sourceDocumentId === binding.targetDocumentId && binding.routeEpoch <= intent.evidence.routeEpoch) throw Error('stale-route-epoch');
      intent.targetDocumentId = binding.targetDocumentId; intent.binding = { ...binding }; await request(store.put(intent)); ctx.changed();
    });
  }
  async getIntent(id: string): Promise<OpenIntent | undefined> { const tx = this.db.transaction('openIntents', 'readonly'); const done = transactionDone(tx); const value = await request<StoredIntent | undefined>(tx.objectStore('openIntents').get(id)); await done; return value; }
  async listIntents(): Promise<OpenIntent[]> { const tx = this.db.transaction('openIntents', 'readonly'); const done = transactionDone(tx); const value = await request<StoredIntent[]>(tx.objectStore('openIntents').getAll()); await done; return value; }
  async rejectIntent(id: string, code: NonNullable<OpenIntent['rejectionCode']>): Promise<void> {
    if (!['scope-mismatch', 'target-mismatch', 'stale-document', 'ambiguous-arrival', 'navigation-failed', 'clock-anomaly'].includes(code)) throw Error('invalid-rejection-code');
    await this.mutate(async ctx => { const store = ctx.tx.objectStore('openIntents'), item = await request<StoredIntent | undefined>(store.get(id)); if (!item || ['committed', 'expired', 'rejected'].includes(item.state)) return; item.state = 'rejected'; item.rejectionCode = code; await request(store.put(item)); ctx.changed(); });
  }
  async expireIntents(browserSessionId: string): Promise<void> {
    const now = instant(this.now())!;
    await this.mutate(async ctx => {
      const store = ctx.tx.objectStore('openIntents'); const all = await request<StoredIntent[]>(store.getAll());
      for (const item of all) {
        if (['committed', 'rejected', 'expired'].includes(item.state)) { if (now - instant(item.expiresAt)! > 86_400_000) { await request(store.delete(item.id)); ctx.changed(); } continue; }
        if (item.browserSessionId !== browserSessionId || now > instant(item.expiresAt)! || now < instant(item.issuedAt)!) { item.state = now < instant(item.issuedAt)! ? 'rejected' : 'expired'; if (now < instant(item.issuedAt)!) item.rejectionCode = 'clock-anomaly'; await request(store.put(item)); ctx.changed(); }
      }
    });
  }
  /** Only the verified background adapter can call this method. It is never an IPC command. */
  async commitArrival(input: ArrivalInput): Promise<{ state: OpenIntent['state']; recordKey: string | null }> {
    exactObject(input, ['intentId', 'browserSessionId', 'targetTabId', 'targetDocumentId', 'routeEpoch', 'scopeEpoch', 'conversationId', 'canonicalUrl', 'scopeKey', 'arrivalConfirmed'], ['evidenceId', 'nativeTitle', 'confirmationBasis']);
    if (input.arrivalConfirmed !== true) throw Error('arrival-unconfirmed');
    if (input.confirmationBasis !== undefined && !['browser-navigation', 'metadata-arrival'].includes(input.confirmationBasis)) throw Error('invalid-confirmation-basis');
    const parsed = parseConversationUrl(input.canonicalUrl);
    if (!parsed || parsed.conversationId !== input.conversationId) throw Error('invalid-arrival-target');
    nonnegative(input.targetTabId); nonnegative(input.routeEpoch); nonnegative(input.scopeEpoch); boundedString(input.targetDocumentId, 128); title(input.nativeTitle);
    const resolvedKey = input.scopeKey ? await conversationKey(input.scopeKey, input.conversationId) : null, now = this.now();
    return this.mutate(async ctx => {
      const store = ctx.tx.objectStore('openIntents'), intent = await request<StoredIntent | undefined>(store.get(input.intentId));
      if (!intent) throw Error('intent-not-found');
      if (intent.state === 'committed') return { state: intent.state, recordKey: intent.committedRecordKey };
      if (['expired', 'rejected'].includes(intent.state)) return { state: intent.state, recordKey: null };
      const reject = async (code: NonNullable<OpenIntent['rejectionCode']>, expired = false) => { intent.state = expired ? 'expired' : 'rejected'; intent.rejectionCode = code; await request(store.put(intent)); ctx.changed(); return { state: intent.state, recordKey: null }; };
      if (input.confirmationBasis === 'browser-navigation' && !ctx.settings.captureEnabled) return reject('stale-document');
      if (instant(now)! < instant(intent.issuedAt)! || instant(now)! > instant(intent.expiresAt)!) return reject('clock-anomaly', instant(now)! > instant(intent.expiresAt)!);
      if (intent.browserSessionId !== input.browserSessionId || intent.state !== 'navigation-dispatched' || !intent.binding || intent.targetTabId !== input.targetTabId || intent.binding.targetDocumentId !== input.targetDocumentId || intent.binding.routeEpoch !== input.routeEpoch || intent.binding.scopeEpoch !== input.scopeEpoch || intent.sourceScopeEpoch !== input.scopeEpoch) return reject('stale-document');
      if (intent.targetConversationId !== input.conversationId) return reject('target-mismatch');
      if (intent.expectedScopeKey !== null && intent.expectedScopeKey !== input.scopeKey) return reject('scope-mismatch');
      const conversations = ctx.tx.objectStore('conversations'), requested = await request<StoredConversation | undefined>(conversations.get(intent.targetRecordKey));
      if (!requested || await request(ctx.tx.objectStore('tombstones').get(intent.targetRecordKey))) return reject('target-mismatch');
      const key = resolvedKey ?? intent.targetRecordKey;
      if (await request(ctx.tx.objectStore('tombstones').get(key))) return reject('target-mismatch');
      let record = await request<StoredConversation | undefined>(conversations.get(key));
      if (input.scopeKey) {
        const scope = await request<AccountScope | undefined>(ctx.tx.objectStore('scopes').get(input.scopeKey));
        const witness = input.evidenceId ? await request<EvidenceWitness | undefined>(ctx.tx.objectStore('witnesses').get(input.evidenceId)) : undefined;
        if (!scope || scope.state !== 'ready' || !witness || witness.revoked || witness.scopeKey !== scope.key || witness.documentId !== input.targetDocumentId || witness.routeEpoch !== input.routeEpoch || witness.scopeEpoch !== input.scopeEpoch) return reject('scope-mismatch');
        if (!record) record = decorate({ ...publicRecord(requested), key, owner: { kind: 'scoped', scopeKey: input.scopeKey }, membership: { state: 'UNKNOWN', projectId: null, reason: 'no-membership-source' }, activity: null, nativeTitle: title(input.nativeTitle), titleBasis: input.nativeTitle ? 'native-label' : 'unknown', titleObservedAt: input.nativeTitle ? now : null, browserLastVisitAt: null, firstSeenAt: now, lastSeenAt: now, stableRank: ctx.rank(), revision: ctx.revision.value + 1 });
        delete record.localProjectCandidate; // A local observation never migrates into an account asset.
        if (requested.owner.kind === 'unassigned') await request(ctx.tx.objectStore('candidateLinks').put({ candidateRecordKey: requested.key, scopedRecordKey: key, evidenceId: witness.id, confirmedAt: now } satisfies CandidateResolution));
      }
      if (!record) return reject('target-mismatch');
      const days = ctx.tx.objectStore('openDays'), dayKey = [key, intent.issuedTimeZone, intent.issuedLocalDate];
      const previous = await request<ConfirmedOpenDay | undefined>(days.get(dayKey));
      await request(days.put(upsertOpenDay(previous, intent, key)));
      record.activity = activitySummary(record.activity, intent);
      // HTTP/application-level errors may still complete browser navigation. Do
      // not upgrade account/object availability from this weaker opening fact.
      if (input.confirmationBasis !== 'browser-navigation') record.availability = 'reachable';
      record.lastSeenAt = now; record.revision = ctx.revision.value + 1;
      if (input.nativeTitle) { record.nativeTitle = title(input.nativeTitle); record.titleBasis = 'native-label'; record.titleObservedAt = now; }
      await request(conversations.put(decorate(record, record.browserSource)));
      intent.resolvedRecordKey = key; intent.committedRecordKey = key; intent.confirmationBasis = input.confirmationBasis ?? 'metadata-arrival'; intent.state = 'committed'; await request(store.put(intent)); ctx.changed();
      return { state: intent.state, recordKey: key };
    });
  }
  /** Internal source admission. Raw page messages must never call this method directly. */
  async confirmObservation(input: ObservationInput): Promise<string> {
    exactObject(input, ['scope', 'witness', 'documentId', 'routeEpoch', 'scopeEpoch', 'conversationUrl', 'nativeTitle', 'membership'], ['project']);
    validateMembership(input.membership, input.witness);
    const parsed = parseConversationUrl(input.conversationUrl); if (!parsed) throw Error('invalid-conversation-url');
    validateScope(input.scope); validateWitness(input.witness);
    if (input.scope.state !== 'ready') throw Error('scope-not-ready');
    if (await scopeKey(input.scope.principalKey, input.scope.contextKey) !== input.scope.key || input.scope.contextWitnessId !== input.witness.id && input.witness.kind === 'verified-session-context') throw Error('invalid-scope-key');
    if (input.witness.scopeKey !== input.scope.key || input.witness.documentId !== input.documentId || input.witness.routeEpoch !== input.routeEpoch || input.witness.scopeEpoch !== input.scopeEpoch || input.witness.revoked) throw Error('stale-observation');
    title(input.nativeTitle);
    const key = await conversationKey(input.scope.key, parsed.conversationId);
    if (input.project) {
      exactObject(input.project, ['key', 'scopeKey', 'projectId', 'nativeTitle', 'canonicalUrl', 'evidenceId', 'observedAt', 'membershipCoverage', 'stableRank', 'revision']);
      const p = parseProjectUrl(input.project.canonicalUrl);
      if (!p || p.projectId !== input.project.projectId || input.project.scopeKey !== input.scope.key || input.project.key !== await projectKey(input.scope.key, p.projectId) || input.project.membershipCoverage !== 'observed-only' || input.project.evidenceId !== input.witness.id) throw Error('invalid-project');
      title(input.project.nativeTitle); iso(input.project.observedAt); nonnegative(input.project.stableRank); nonnegative(input.project.revision);
    }
    const now = this.now();
    return this.mutate(async ctx => {
      if (await request(ctx.tx.objectStore('tombstones').get(key))) throw Error('record-removed');
      if (input.witness.kind === 'verified-session-context') {
        if (!input.witness.fields.includes('identity') || input.scope.contextWitnessId !== input.witness.id) throw Error('missing-context-proof');
      } else {
        const identity = await request<EvidenceWitness | undefined>(ctx.tx.objectStore('witnesses').get(input.scope.contextWitnessId));
        if (!identity || identity.kind !== 'verified-session-context' || !identity.fields.includes('identity') || identity.revoked || identity.scopeKey !== input.scope.key || identity.documentId !== input.documentId || identity.routeEpoch !== input.routeEpoch || identity.scopeEpoch !== input.scopeEpoch) throw Error('missing-context-proof');
      }
      const store = ctx.tx.objectStore('conversations'), old = await request<StoredConversation | undefined>(store.get(key));
      const previousMembership: Membership = old?.membership ?? { state: 'UNKNOWN', projectId: null, reason: 'no-membership-source' };
      const oldEvidenceId = previousMembership.state === 'UNKNOWN' ? previousMembership.lastConfirmed?.evidenceId : previousMembership.evidenceId;
      const oldWitness = oldEvidenceId ? await request<EvidenceWitness | undefined>(ctx.tx.objectStore('witnesses').get(oldEvidenceId)) : undefined;
      if (oldWitness && oldWitness.sourceDomain === input.witness.sourceDomain && oldWitness.sourceRevision > input.witness.sourceRevision) return key;
      const membership = reduceMembership(previousMembership, { membership: input.membership, witness: input.witness }, { scopeKey: input.scope.key, documentId: input.documentId, routeEpoch: input.routeEpoch, scopeEpoch: input.scopeEpoch }, oldWitness);
      const record = decorate({ key, provider: 'chatgpt', owner: { kind: 'scoped', scopeKey: input.scope.key }, conversationId: parsed.conversationId, canonicalUrl: parsed.canonicalUrl, nativeTitle: title(input.nativeTitle) ?? old?.nativeTitle ?? null, titleBasis: input.nativeTitle ? 'native-label' : old?.titleBasis ?? 'unknown', titleObservedAt: input.nativeTitle ? now : old?.titleObservedAt ?? null, availability: old?.availability ?? 'unverified', firstSeenAt: old?.firstSeenAt ?? now, lastSeenAt: now, browserLastVisitAt: old?.browserLastVisitAt ?? null, activity: old?.activity ?? null, stableRank: old?.stableRank ?? ctx.rank(), revision: ctx.revision.value + 1, membership });
      await request(ctx.tx.objectStore('scopes').put(input.scope)); await request(ctx.tx.objectStore('witnesses').put(input.witness));
      if (input.project) await request(ctx.tx.objectStore('projects').put({ ...input.project, revision: ctx.revision.value + 1 }));
      await request(store.put(record)); await pruneWitnesses(ctx); ctx.changed(); return key;
    });
  }
}

async function pruneWitnesses(ctx: MutationContext): Promise<void> {
  const refs = new Set<string>();
  for (const scope of await request<AccountScope[]>(ctx.tx.objectStore('scopes').getAll())) refs.add(scope.contextWitnessId);
  for (const record of await request<StoredConversation[]>(ctx.tx.objectStore('conversations').getAll())) { const m = record.membership; if (m.state !== 'UNKNOWN') refs.add(m.evidenceId); else if (m.lastConfirmed) refs.add(m.lastConfirmed.evidenceId); }
  for (const project of await request<ProjectRecord[]>(ctx.tx.objectStore('projects').getAll())) refs.add(project.evidenceId);
  for (const link of await request<CandidateResolution[]>(ctx.tx.objectStore('candidateLinks').getAll())) refs.add(link.evidenceId);
  const store = ctx.tx.objectStore('witnesses');
  for (const witness of await request<EvidenceWitness[]>(store.getAll())) if (!refs.has(witness.id)) await request(store.delete(witness.id));
}

export async function createRepository(options: { indexedDB?: IDBFactory; name?: string; now?: () => string; timeZone?: string } = {}): Promise<Repository> {
  const db = await openDatabase(options.indexedDB, options.name); const tx = db.transaction(['settings', 'revisions'], 'readwrite'); const done = transactionDone(tx);
  try {
    const settings = await request<SettingsRow | undefined>(tx.objectStore('settings').get('main'));
    if (!settings) { await request(tx.objectStore('settings').put(defaults(options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone))); await request(tx.objectStore('revisions').put({ key: 'main', value: 0, nextRank: 0 } satisfies RevisionRow)); }
    await done; return new Repository(db, options.now ?? (() => new Date().toISOString()));
  } catch (error) { try { tx.abort(); } catch {} await done.catch(() => {}); db.close(); throw error; }
}
function validateIntentEvidence(value: OpenIntentEvidence): void {
  if (value.kind === 'start-gesture') { exactObject(value, ['kind', 'sourceDocumentId', 'gesture']); if (!['click', 'keyboard', 'auxclick'].includes(value.gesture)) throw Error('invalid-gesture'); }
  else if (value.kind === 'native-link-gesture') { exactObject(value, ['kind', 'sourceDocumentId', 'routeEpoch', 'adapterVersion', 'targetHref']); nonnegative(value.routeEpoch); boundedString(value.adapterVersion, 100); if (!parseConversationUrl(value.targetHref)) throw Error('invalid-native-target'); }
  else if (value.kind === 'address-bar-commit') { exactObject(value, ['kind', 'targetDocumentId', 'transitionType', 'adapterVersion']); boundedString(value.targetDocumentId, 128); boundedString(value.adapterVersion, 100); if (!['typed', 'generated', 'keyword'].includes(value.transitionType)) throw Error('invalid-navigation-evidence'); return; }
  else throw Error('invalid-intent-evidence');
  boundedString(value.sourceDocumentId, 128);
}
function validateScope(scope: AccountScope): void {
  exactObject(scope, ['key', 'provider', 'principalKey', 'contextKey', 'identity', 'label', 'verifiedAt', 'identityAdapterVersion', 'contextWitnessId', 'state']);
  if (scope.provider !== 'chatgpt' || scope.identity !== 'verified' || !['ready', 'needs-revalidation', 'signed-out', 'conflicted'].includes(scope.state)) throw Error('invalid-scope');
  for (const field of ['key', 'principalKey', 'contextKey', 'label', 'identityAdapterVersion', 'contextWitnessId'] as const) boundedString(scope[field], 256);
  if (scope.principalKey.includes('@')) throw Error('email-not-a-principal-key'); iso(scope.verifiedAt);
}
function validateWitness(w: EvidenceWitness): void {
  exactObject(w, ['id', 'kind', 'adapterId', 'adapterVersion', 'scopeKey', 'documentId', 'routeEpoch', 'scopeEpoch', 'observedAt', 'sourceRevision', 'sourceDomain', 'fields', 'revoked'], ['upstreamRevision']);
  if (!['native-project-member-region', 'native-explicit-none', 'allowlisted-metadata', 'verified-session-context'].includes(w.kind) || typeof w.revoked !== 'boolean') throw Error('invalid-witness');
  for (const k of ['id', 'adapterId', 'adapterVersion', 'scopeKey', 'documentId', 'sourceDomain'] as const) boundedString(w[k], 256);
  nonnegative(w.routeEpoch); nonnegative(w.scopeEpoch); nonnegative(w.sourceRevision); iso(w.observedAt);
  if (!Array.isArray(w.fields) || w.fields.length > 5 || w.fields.some(f => !['identity', 'title', 'project-title', 'membership', 'availability'].includes(f)) || new Set(w.fields).size !== w.fields.length) throw Error('invalid-witness-fields');
}
function validateImportJob(job: RuntimeImportJob): void {
  exactObject(job, ['id', 'provider', 'state', 'startTimeMs', 'endTimeMs', 'pendingIntervals', 'processedUniqueUrls', 'acceptedCandidates', 'rejectedUrls', 'saturatedIntervals', 'sourceCoverage', 'completedAt'], ['includeSynced', 'seenKeys', 'errorCode', 'pendingCandidates', 'failureCode']);
  boundedString(job.id, 128);
  if (job.provider !== 'browser-history' || job.sourceCoverage !== 'browser-available-history' || !['running', 'paused', 'partial', 'complete', 'cancelled', 'permission-revoked'].includes(job.state) || !Number.isFinite(job.startTimeMs) || !Number.isFinite(job.endTimeMs) || job.startTimeMs < 0 || job.endTimeMs < job.startTimeMs || !Array.isArray(job.pendingIntervals) || job.pendingIntervals.length > 256 || !Array.isArray(job.saturatedIntervals)) throw Error('invalid-import-job');
  for (const n of [job.processedUniqueUrls, job.acceptedCandidates, job.rejectedUrls]) nonnegative(n);
  for (const item of job.pendingIntervals) { exactObject(item, ['startMs', 'endMs', 'query']); if (!['chatgpt.com', 'chat.openai.com'].includes(item.query) || !Number.isFinite(item.startMs) || !Number.isFinite(item.endMs) || item.startMs < job.startTimeMs || item.endMs > job.endTimeMs || item.startMs > item.endMs) throw Error('invalid-import-interval'); }
  for (const item of job.saturatedIntervals) { exactObject(item, ['startMs', 'endMs']); if (!Number.isFinite(item.startMs) || !Number.isFinite(item.endMs) || item.startMs < job.startTimeMs || item.endMs > job.endTimeMs || item.startMs > item.endMs) throw Error('invalid-saturated-interval'); }
  if (job.completedAt !== null) iso(job.completedAt);
  if (job.includeSynced !== undefined && typeof job.includeSynced !== 'boolean') throw Error('invalid-import-option');
  if (job.seenKeys && (!Array.isArray(job.seenKeys) || job.seenKeys.some(s => typeof s !== 'string' || s.length > 128))) throw Error('invalid-import-progress');
  if (job.errorCode !== undefined) boundedString(job.errorCode, 128);
  if (job.failureCode !== undefined && job.failureCode !== null && !['history-api-failed', 'saturated-time-slice'].includes(job.failureCode)) throw Error('invalid-import-failure');
  if (job.pendingCandidates !== undefined) {
    if (!Array.isArray(job.pendingCandidates) || job.pendingCandidates.length > 500) throw Error('invalid-pending-candidates');
    for (const candidate of job.pendingCandidates) { exactObject(candidate, ['url'], ['title', 'lastVisitAt', 'source', 'titleBasis']); if (!parseConversationUrl(candidate.url)) throw Error('invalid-pending-url'); title(candidate.title); if (candidate.lastVisitAt) iso(candidate.lastVisitAt); if (candidate.source && !['local', 'synced', 'unknown'].includes(candidate.source)) throw Error('invalid-history-source'); }
  }
}
