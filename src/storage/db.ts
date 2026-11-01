export const STORE_NAMES = ['scopes', 'conversations', 'projects', 'witnesses', 'candidateLinks', 'openDays', 'openIntents', 'shortcuts', 'tombstones', 'importJobs', 'settings', 'revisions'] as const;
export type StoreName = typeof STORE_NAMES[number];
export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error ?? Error('database-request-failed')); });
}
export function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? Error('database-transaction-aborted')); tx.onerror = () => {}; });
}
export function openDatabase(factory: IDBFactory = indexedDB, name = 'vaiwl-start'): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      const scope = db.createObjectStore('scopes', { keyPath: 'key' }); scope.createIndex('state', 'state');
      const conversations = db.createObjectStore('conversations', { keyPath: 'key' });
      conversations.createIndex('ownerConversation', ['ownerKey', 'conversationId'], { unique: true });
      conversations.createIndex('ownerActivity', ['ownerKey', 'lastActiveAt']);
      conversations.createIndex('ownerMembership', ['ownerKey', 'membershipState']);
      conversations.createIndex('ownerProject', ['ownerKey', 'projectId']);
      conversations.createIndex('ownerRank', ['ownerKey', 'stableRank']);
      const projects = db.createObjectStore('projects', { keyPath: 'key' }); projects.createIndex('scopeProject', ['scopeKey', 'projectId'], { unique: true });
      const witnesses = db.createObjectStore('witnesses', { keyPath: 'id' }); witnesses.createIndex('scopeSource', ['scopeKey', 'sourceDomain']);
      const links = db.createObjectStore('candidateLinks', { keyPath: ['candidateRecordKey', 'scopedRecordKey'] }); links.createIndex('candidate', 'candidateRecordKey');
      const days = db.createObjectStore('openDays', { keyPath: ['recordKey', 'timeZone', 'localDate'] }); days.createIndex('recordLast', ['recordKey', 'lastOpenedAt']);
      const intents = db.createObjectStore('openIntents', { keyPath: 'id' }); intents.createIndex('state', 'state'); intents.createIndex('expiresAt', 'expiresAt');
      const shortcuts = db.createObjectStore('shortcuts', { keyPath: 'id' }); shortcuts.createIndex('order', ['order', 'id']);
      const tombstones = db.createObjectStore('tombstones', { keyPath: 'key' }); tombstones.createIndex('removedAt', 'removedAt');
      const imports = db.createObjectStore('importJobs', { keyPath: 'id' }); imports.createIndex('state', 'state');
      db.createObjectStore('settings', { keyPath: 'key' }); db.createObjectStore('revisions', { keyPath: 'key' });
    };
    req.onerror = () => reject(req.error ?? Error('database-open-failed'));
    req.onblocked = () => reject(Error('database-upgrade-blocked'));
    req.onsuccess = () => { const db = req.result; db.onversionchange = () => db.close(); resolve(db); };
  });
}
