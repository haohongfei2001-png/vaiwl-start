import test from 'node:test';
import assert from 'node:assert/strict';
import { browserFamily, defaultTabTitle, validTitle, normalizeTitle, normalizeIcon, bookmarkPreference, safeBookmarkUrl, bookmarkBars, imageDimensions } from '../../src/domain/native-experience.js';
import { lastDisplayAt, projectCatalog } from '../../src/domain/projection.js';
import { createFreeViewSession } from '../../src/domain/time.js';
import type { ConversationRecord, ProjectRecord } from '../../contracts/free-v1.js';
import type { CatalogSnapshot } from '../../src/storage/repository.js';
const now = '2026-11-02T12:00:00.000Z';
const view = { ...createFreeViewSession({ now, timeZone: 'UTC' }), now, k: 0, selectedScope: 'a' };
const row = (key: string, visit: string | null, active: string | null = null): ConversationRecord => ({ key, conversationId: key, provider: 'chatgpt', canonicalUrl: `https://chatgpt.com/c/${key}`, nativeTitle: key, titleBasis: 'browser-history', titleObservedAt: now, availability: 'unverified', firstSeenAt: now, lastSeenAt: now, browserLastVisitAt: visit, activity: active ? { firstConfirmedOpenAt: active, lastConfirmedOpenAt: active, lastActiveDate: active.slice(0,10), timeZone: 'UTC' } : null, owner: { kind: 'scoped', scopeKey: 'a' }, membership: { state: 'UNKNOWN', projectId: null, reason: 'no-membership-source' }, stableRank: 0, revision: 1 });
const catalog = (rows: ConversationRecord[], projects: ProjectRecord[] = []) => ({ conversations: rows, projects, tombstones: [], localProfileKey: 'profile' }) as unknown as CatalogSnapshot;
test('native title: browser and UI locale, not platform brand', () => {
  assert.equal(browserFamily('Chrome/144.0 Edg/144.0'), 'edge'); assert.equal(browserFamily('Chrome/144.0'), 'chrome');
  assert.equal(defaultTabTitle('zh-CN','chrome'), '新标签页'); assert.equal(defaultTabTitle('zh-CN','edge'), '新建标签页');
  assert.equal(defaultTabTitle('en-US','chrome'), 'New Tab'); assert.equal(defaultTabTitle('en-US','edge'), 'New tab');
  assert.equal(defaultTabTitle('zh-TW','chrome'), '新分頁'); assert.equal(defaultTabTitle('ja','chrome'), '新しいタブ');
});
test('independent title/icon validation and safe fallback', () => {
  assert.equal(validTitle(' Home '), 'Home'); assert.equal(normalizeTitle({}), '');
  for (const value of ['a'.repeat(81), 'bad\u202Eexe', 'bad\nname']) assert.throws(() => validTitle(value));
  assert.deepEqual(normalizeIcon({ kind: 'product' }), { kind: 'product' });
  for (const data of ['data:image/svg+xml,<svg onload=alert(1)>', 'https://example.com/a.png', 'data:text/html,x']) assert.deepEqual(normalizeIcon({ kind:'upload', data }), { kind:'browser' });
});
test('three bookmark preferences persist explicitly; unknown never guessed', () => {
  for (const pref of ['always','newtab','hidden'] as const) assert.equal(bookmarkPreference(pref), pref);
  assert.equal(bookmarkPreference(undefined),'ask'); assert.equal(bookmarkPreference('auto'),'ask');
});
test('bookmark roots preserve multiple bars, order, folders and legacy fallback without title guessing', () => {
  const tree = [{id:'0',title:'',children:[{id:'2',title:'Bookmarks Bar'}, {id:'7',title:'A',folderType:'bookmarks-bar'}, {id:'8',title:'B',folderType:'bookmarks-bar'}]}];
  assert.deepEqual(bookmarkBars(tree).map(n=>n.id), ['7','8']);
  assert.deepEqual(bookmarkBars([{id:'0',title:'',children:[{id:'1',title:'收藏夹栏'}]}]).map(n=>n.id), ['1']);
  assert.equal(bookmarkBars([{id:'0',title:'',children:[{id:'9',title:'书签栏'}]}]).length,0);
});
test('bookmark and migration URLs reject scripts, credentials and malformed inputs', () => {
  for (const value of ['javascript:alert(1)','data:text/html,a','file:///tmp/a','https://user:pass@example.com','chrome://settings','broken']) assert.equal(safeBookmarkUrl(value),null);
  assert.equal(safeBookmarkUrl('https://EXAMPLE.com:443'), 'https://example.com/');
  assert.notEqual(safeBookmarkUrl('https://example.com/#one'),safeBookmarkUrl('https://example.com/#two'));
});
test('icon header validation rejects SVG, spoofed MIME, oversized and decompression dimensions', () => {
  const header = new Uint8Array(33); header.set([137,80,78,71,13,10,26,10]);const d=new DataView(header.buffer);d.setUint32(8,13);d.setUint32(12,0x49484452);d.setUint32(16,128);d.setUint32(20,64);
  assert.deepEqual(imageDimensions(header,'image/png'),{width:128,height:64});
  assert.throws(()=>imageDimensions(header,'image/jpeg'));d.setUint32(16,100000);assert.throws(()=>imageDimensions(header,'image/png'));
  assert.throws(()=>imageDimensions(new TextEncoder().encode('<svg onload="alert(1)"/>'),'image/png'));
  assert.throws(()=>imageDimensions(new Uint8Array(1048577),'image/png'));
});
test('latest valid display time replaces source precedence without changing active history', () => {
  const r=row('r','2026-11-02T11:00:00Z','2026-08-01T00:00:00Z'), before=JSON.stringify(r);
  assert.equal(lastDisplayAt(r,now),'2026-11-02T11:00:00.000Z');
  assert.equal(projectCatalog(catalog([r]),view).pendingDates[0]!.records[0]!.key,'r');assert.equal(JSON.stringify(r),before);
  r.activity!.lastConfirmedOpenAt='2026-11-02T11:30:00Z';assert.equal(lastDisplayAt(r,now),'2026-11-02T11:30:00.000Z');
});
test('invalid and same-day future timestamps fall back independently, without fabricated today', () => {
  assert.equal(lastDisplayAt(row('r','2026-11-02T12:00:00.001Z','2026-11-01T09:00:00Z'),now),'2026-11-01T09:00:00.000Z');
  assert.equal(lastDisplayAt(row('r','2026-02-30T00:00:00Z','invalid'),now),null);
  assert.equal(lastDisplayAt(row('r',null,null),now),null);
});
test('history and active-only records share one dated pending window; same record appears once', () => {
  const rows=[row('history',now),row('active',null,now),row('both',now,now)]; const result=projectCatalog(catalog(rows),view);
  assert.equal(result.pendingDates.length,1);assert.deepEqual(result.pendingDates[0]!.records.map(r=>r.key),['active','both','history']);
  assert.ok(!('basis' in result.pendingDates[0]!));assert.equal(result.dates.length,0);
});
test('project follows newest member display time, keeps old/undated children and isolates accounts', () => {
  const recent=row('recent','2026-11-02T11:00:00Z','2026-08-01T00:00:00Z'),old=row('old','2026-07-01T00:00:00Z'),undated=row('undated',null),foreign=row('foreign',now);
  for(const r of [recent,old,undated,foreign]) r.membership={state:'PROJECT',projectId:'p',evidenceId:'e',confirmedAt:now};
  foreign.owner={kind:'scoped',scopeKey:'b'};
  const project={key:'pa',scopeKey:'a',projectId:'p',nativeTitle:'P',canonicalUrl:'https://chatgpt.com/g/p/project',evidenceId:'e',observedAt:now,membershipCoverage:'observed-only',stableRank:0,revision:1} as ProjectRecord;
  const snapshot=catalog([old,foreign,undated,recent],[project]),result=projectCatalog(snapshot,view),card=result.projects[0]!;
  assert.deepEqual(card.recent.map(r=>r.key),['recent']);assert.deepEqual(card.older.map(r=>r.key),['old','undated']);assert.deepEqual(card.undated,[]);
  assert.equal(card.latestDisplayAt,'2026-11-02T11:00:00.000Z');assert.equal(card.latestActiveAt,'2026-08-01T00:00:00Z');
  assert.equal(projectCatalog(snapshot,{...view,k:3}).projects.length,0);
});
test('proven NONE accepts history-only display but unknown is never assigned NONE', () => {
  const none=row('none',now);none.membership={state:'NONE',projectId:null,evidenceId:'e',confirmedAt:now};
  const unknown=row('unknown',now), p=projectCatalog(catalog([none,unknown]),view);
  assert.deepEqual(p.dates[0]!.records.map(r=>r.key),['none']);assert.deepEqual(p.pendingDates[0]!.records.map(r=>r.key),['unknown']);assert.equal(none.activity,null);
});
