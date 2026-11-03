/** Explicitly synthetic metadata-only catalog for disposable installed-extension Profiles. */
import assert from 'node:assert/strict';

export const layoutFixtures = {
  typical: { projectRows: [9, 5, 4, 6], dayRows: [9, 5, 4, 6, 3, 2, 5, 3] },
  sparse: { projectRows: [2, 1, 3], dayRows: [2, 1, 2, 1] },
  dense: { projectRows: [22, 6, 9, 3, 5, 8, 2, 12, 5, 6, 3, 7], dayRows: [22, 7, 6, 5, 8, 3, 9, 5, 7, 4, 3, 8, 5, 6] },
  'recent-only': { projectRows: [], dayRows: [9, 5, 4, 6, 3, 2, 5, 3] },
};

export async function seedLayoutCatalog(target, state, anchorIso) {
  const config = layoutFixtures[state];
  assert.ok(config, state);
  const receipt = await target.evaluate(async ({ config, anchorIso }) => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('vaiwl-start'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const settings = await new Promise(resolve => { const r = db.transaction('settings').objectStore('settings').get('main'); r.onsuccess = () => resolve(r.result); });
    const oldSettings = await new Promise(resolve => { const r = db.transaction('settings').objectStore('settings').getAll(); r.onsuccess = () => resolve(r.result); });
    const profile = settings.localProfileKey, anchor = Date.parse(anchorIso);
    const at = days => new Date(anchor - days * 86400000).toISOString();
    const tx = db.transaction([...db.objectStoreNames], 'readwrite');
    const complete = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
    for (const name of [...db.objectStoreNames]) if (name !== 'settings') tx.objectStore(name).clear();
    for (const row of oldSettings) if (row.key.startsWith('localProject:')) tx.objectStore('settings').delete(row.key);
    const projectNames = ['研究笔记', 'VAIWL · 产品与设计', 'Riftlet 截图工作流', '写作与阅读', '科研数值计算', '阅读与写作', '设计系统与界面实验', '日常灵感', '英语学习与论文精读', '个人知识档案', '产品用户研究', '下一步计划'];
    const topics = [
      '计算方法与对照实验',
      '项目首页的比例、留白和阅读节奏',
      '长标题可访问性：保留原始完整会话名称，不因为布局调整丢失内容',
      '继续整理上一次讨论',
      'Review layout and interaction details',
      '下一轮实现与验证计划',
      '对照实验与误差来源',
      '待完成问题与新的思路',
      '软件产品设计的长期目标',
      '计算结果记录与交叉核对',
    ];
    let rank = 0; const keys = [], projects = [];
    const add = (nativeTitle, days, project = null) => {
      const index = ++rank, id = `95000000-0000-4000-8000-${String(index).padStart(12, '0')}`, key = `staging:layout-${index}`;
      const membership = { state: 'UNKNOWN', projectId: null, reason: 'scope-unverified' };
      const row = { key, provider: 'chatgpt', conversationId: id, canonicalUrl: `https://chatgpt.com/c/${id}`, nativeTitle, titleBasis: 'native-label', titleObservedAt: anchorIso, availability: 'reachable', firstSeenAt: anchorIso, lastSeenAt: anchorIso, browserLastVisitAt: days === null ? null : at(days), activity: null, stableRank: index, revision: 50,
        owner: { kind: 'unassigned', localProfileKey: profile, accountKey: null }, ownerKey: project ? 'local:layout-fixture-principal' : `unassigned:${profile}`, membership, membershipState: 'UNKNOWN',
        ...(project ? { localProject: { projectKey: project.key, boundaryKey: project.boundaryKey, identityBasis: 'principal', relationBasis: 'linked-native-panel', observedAt: anchorIso, state: 'observed' } } : {}) };
      tx.objectStore('conversations').put(row); keys.push(key); return row;
    };
    for (const [index, count] of config.projectRows.entries()) {
      const id = `g-p-${String(500 + index).padStart(32, '0')}`, url = `https://chatgpt.com/g/${id}/project`;
      const project = { key: `local-project:layout-${index}`, localProfileKey: profile, boundaryKey: 'layout-fixture-principal', identityBasis: 'principal', projectId: id,
        nativeTitle: projectNames[index] || `项目 ${index + 1}`, canonicalUrl: url, firstObservedAt: anchorIso, observedAt: anchorIso, relationBasis: 'linked-native-panel', source: { href: url, documentKey: 'synthetic-layout', routeEpoch: 1 }, trust: 'native-relation-observed', membershipCoverage: 'observed-only', stableRank: index, revision: 50 };
      tx.objectStore('settings').put({ key: `localProject:${project.key}`, value: project }); projects.push(project.key);
      for (let n = 0; n < count; n++) add(topics[(n + index) % topics.length] + (n >= 10 ? ` · ${n + 1}` : ''), index % 3, project);
      if (index === 0) { add('更早的计算记录', 65, project); add('暂未访问的项目成员', null, project); }
    }
    for (const [day, count] of config.dayRows.entries()) for (let n = 0; n < count; n++) add(topics[(day + n + 2) % topics.length] + (n >= 10 ? ` · ${n + 1}` : ''), day);
    const historical = add('上一个 30 天区间中的讨论', 40);
    tx.objectStore('settings').put({ ...settings, selectedScope: 'unassigned', libraryTimeZone: 'UTC', captureEnabled: false });
    tx.objectStore('revisions').put({ key: 'main', value: 50, nextRank: rank + 1 });
    tx.objectStore('openDays').put({ recordKey: historical.key, timeZone: 'UTC', localDate: at(40).slice(0, 10), firstOpenedAt: at(40), lastOpenedAt: at(40), activityUnit: 1, firstIntentId: 'synthetic-layout', lastIntentId: 'synthetic-layout' });
    tx.objectStore('tombstones').put({ key: 'staging:layout-removed', removedAt: anchorIso, reason: 'user-removed', record: { ...historical, key: 'staging:layout-removed', nativeTitle: '已移除的合成夹具' } });
    await complete; db.close(); sessionStorage.clear(); return { keys, projects, records: rank };
  }, { config, anchorIso });
  return receipt;
}
