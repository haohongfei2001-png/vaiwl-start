/** Layout and focus checks in a fresh headless extension profile. All records are synthetic. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { classify, createStore, ingest } from '../../research/chatgpt-tasks/result-model.mjs';
import { seedLayoutCatalog } from './layout-fixture.mjs';

const baseline = process.env.VAIWL_GLANCE_BASELINE;
const runtime = resolve(baseline || 'dist');
const build = JSON.parse(await readFile(join(runtime, 'build.json'), 'utf8'));
const family = process.env.VAIWL_TEST_BROWSER_FAMILY || 'chrome';
const output = resolve('artifacts', 'task-glance', (baseline ? 'before-' : '') + family);
const checks = [], measurements = [], errors = [];
const record = (id, passed) => { assert.ok(passed, id); checks.push(id); };
const rect = locator => locator.boundingBox();
const widest = { width: 1470, height: 837 };
const taskNames = ['行业动态简报', '每周论文追踪', '项目进度摘要', '产品反馈观察', '市场晨报', '周会纪要', '研究进展', '招聘动态', '阅读计划', '发布记录'];
const excerpt = '本周有两条值得跟进的进展：研究团队公布了完整对照实验，新的复现数据已随论文发布。';
const moment = '2026-11-05T01:00:00.000Z', later = '2026-11-05T02:00:00.000Z';
function fixture(count, { bodies = true, retained = false, failed = false } = {}) {
  const principal = 'synthetic-glance', keys = [], catalog = {};
  const scope = { provider: 'chatgpt', profileId: 'browser-profile', accountId: principal + ':personal' };
  let model = createStore();
  for (let i = 0; i < count; i++) {
    const id = 'synthetic-glance-' + i, key = JSON.stringify([principal, null, id]);
    const task = { id, title: taskNames[i], is_enabled: true, default_timezone: 'UTC', schedule: null,
      last_run_time: moment, next_run_time: null, team_id: null, conversation_id: '00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0') };
    keys.push(key);
    catalog[key] = { key, scope, task, observedAt: later, resultSyncedAt: bodies ? later : null, readOutcome: bodies ? 'unchanged' : undefined };
    const append = (run, body, at) => {
      model = ingest(model, { scope, observedAt: at, tasks: [{ ...task, run_details: {
        latest_result: { run_id: run, created_at: at, content_text: body, chat_ref: { type: 'chatgpt', id: task.conversation_id } },
      } }] });
    };
    if (!bodies) model = ingest(model, { scope, observedAt: moment, tasks: [task] });
    else {
      append('first', i ? taskNames[i] + '已更新。两项观察有了新的来源依据。' : excerpt, moment);
      if (!i && retained) {
        model = classify(model, { scope, taskId: id, runId: 'first', resultRevision: 1, outcome: 'new_information', classifiedAt: moment, evidence: { kind: 'user', reference: 'fixture-choice' } });
        append('second', '本次复查没有新的内容。', later);
      }
    }
  }
  const filters = Object.fromEntries(['scheduled','finished','paused'].map(k => [k, { cursor: null, firstPage: true, observedAt: later }]));
  return { version: 1, generation: 0, settings: { enabled: true, automatic: false, showWidget: true, preview: true, selections: { [principal]: keys } },
    principal, catalog, model, sourceEvidence: {}, coverage: { [principal]: { filters, at: later } },
    sync: { status: failed ? 'error' : 'ok', code: failed ? 'NETWORK_ERROR' : null, mode: 'visit', succeededAt: later, attemptedAt: later } };
}

const scratch = await mkdtemp(join(tmpdir(), 'vaiwl-layout-only-'));
const harness = join(scratch, 'extension');
let context, page;
async function seedTasks(state) {
  // Only the private disposable test profile created below can receive this fixture.
  await page.evaluate(async state => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('vaiwl-start-chatgpt-tasks', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('state');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const tx = db.transaction('state', 'readwrite');
    tx.objectStore('state').put(state, 'current');
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onabort = () => rej(tx.error); });
    db.close();
  }, state);
  await page.reload();
  await page.locator('.spatial-project-grid .project').first().waitFor();
}
async function stable() {
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
}
const shot = name => page.screenshot({ path: join(output, name + '.png'), animations: 'disabled' });
async function theme(value) {
  await page.evaluate(v => chrome.storage.local.set({ 'native.homeTheme': v }), value);
  await page.waitForFunction(v => document.documentElement.dataset.homeTheme === v, value);
  await stable();
}
async function geometry() {
  return page.evaluate(() => {
    const selectors = ['#tasks-home', '#search-trigger', '#mode-toggle', '#settings-trigger', '#theme-controls', '#theme-new-chat', '#bookmarks-home', '.spatial-project-grid', '.recent-section'];
    return Object.fromEntries(selectors.map(s => {
      const r = document.querySelector(s)?.getBoundingClientRect();
      return [s, r && r.width ? { x:r.x,y:r.y,w:r.width,h:r.height } : null];
    }));
  });
}

try {
  await mkdir(output, { recursive: true }); await mkdir(harness);
  for (const [file, digest] of Object.entries(build.files)) {
    const contents = await readFile(join(runtime, file));
    assert.equal(createHash('sha256').update(contents).digest('hex'), digest);
    await cp(join(runtime, file), join(harness, file));
  }
  await cp(join(runtime, 'build.json'), join(harness, 'build.json'));
  const manifest = JSON.parse(await readFile(join(harness, 'manifest.json'), 'utf8'));
  // Test grants allow populating a real bookmark bar in this isolated profile.
  const grants = ['bookmarks','scripting','alarms'];
  manifest.permissions.push(...grants); manifest.optional_permissions = manifest.optional_permissions.filter(p => !grants.includes(p));
  manifest.host_permissions = manifest.optional_host_permissions; delete manifest.optional_host_permissions;
  await writeFile(join(harness, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(join(scratch, 'profile'), {
    ...(process.env.VAIWL_CHROMIUM_EXECUTABLE ? { executablePath: process.env.VAIWL_CHROMIUM_EXECUTABLE } : { channel: process.env.VAIWL_BROWSER_CHANNEL || 'chromium' }),
    headless: true, timezoneId: 'UTC', locale: 'zh-CN', viewport: widest,
    args: ['--no-sandbox','--host-resolver-rules=MAP * ~NOTFOUND', '--disable-extensions-except=' + harness, '--load-extension=' + harness],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {
    const roots = (await chrome.bookmarks.getTree())[0].children;
    const bar = roots.find(n => n.folderType === 'bookmarks-bar') || roots.find(n => n.id === '1');
    for (const title of ['文献资料','设计参考','开发文档','工作手册']) await chrome.bookmarks.create({ parentId: bar.id, title });
    await chrome.storage.local.set({ 'native.bookmarks':'newtab' });
  });
  page = await context.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('chrome://newtab/');
  await page.waitForSelector('html[data-start-ready="true"]');
  await seedLayoutCatalog(page, 'typical', new Date().toISOString());
  await seedTasks(fixture(10, { retained: true }));
  const toggle = page.locator('.task-toggle'), panel = page.locator('#task-panel');
  for (const variant of ['classic','spatial','workbench','folio']) {
    await theme(variant);
    for (const width of baseline ? [1470,1280,390] : [1920,1470,1280,1024,760,640,390,320]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 837 }); await stable();
      await page.locator('#tasks-home:not([hidden])').waitFor();
      const before = await geometry();
      const common = [ '#bookmarks-home','.spatial-project-grid','.recent-section','#search-trigger','#settings-trigger','#mode-toggle' ];
      record(variant+'-'+width+'-home', common.every(s=>before[s]?.w>0));
      if (width === 1470 || (variant==='spatial' && [1280,390].includes(width))) {
        await page.evaluate(()=>document.activeElement?.blur());
        await shot(variant+'-'+width+'-home');
      }
      const measurement = { variant, width, before }; measurements.push(measurement);
      if (baseline) continue;
      const g = before['#tasks-home'];
      record(variant+'-'+width+'-entry-bounds', g.x >= 0 && g.x+g.w <= width && g.y < before['#bookmarks-home'].y && g.h <= 48);
      if (width>=1280) record(variant+'-'+width+'-wide-summary', g.w>=320 && g.w<=400 && await page.locator('.task-featured').isVisible());
      if (width<=640) record(variant+'-'+width+'-compact', g.w<=40 && !(await page.locator('.task-featured').isVisible()));
      for (const s of ['#search-trigger','#settings-trigger','#mode-toggle','#theme-controls','#theme-new-chat']) {
        const other=before[s];
        if(other) record(variant+'-'+width+'-avoids-'+s, Math.min(other.x+other.w,g.x+g.w)-Math.max(other.x,g.x)<1 || Math.min(other.y+other.h,g.y+g.h)-Math.max(other.y,g.y)<1);
      }
      await toggle.click(); await panel.waitFor(); const box=await rect(panel);
      record(variant+'-'+width+'-panel-bounds', box.x>=0 && box.x+box.width<=width && box.y>=g.y+g.h && box.width===Math.min(424,width-24));
      const after=await geometry();
      record(variant+'-'+width+'-zero-grid-shift', common.every(s=>Math.abs(before[s].y-after[s].y)<0.5) && before['.spatial-project-grid'].x===after['.spatial-project-grid'].x);
      measurement.openPanel=box;
      if (width===1470 || (variant==='spatial' && width===390)) await shot(variant+'-'+width+'-panel');
      await page.keyboard.press('Escape'); await panel.waitFor({state:'hidden'});
      record(variant+'-'+width+'-escape-focus', await toggle.evaluate(e=>e===document.activeElement));
    }
  }
  if (!baseline) {
    await page.setViewportSize(widest); await theme('spatial');
    await toggle.focus(); await page.keyboard.press('ArrowDown'); await panel.waitFor();
    const rows=panel.locator('.task-row');
    await page.waitForFunction(()=>document.activeElement?.matches('.task-row'));
    record('list-all-selected-and-retained-record', await panel.locator('.task-item').count()===10 && await rows.count()===11);
    record('panel-no-invented-next-time', !(await panel.innerText()).includes('下次 '));
    const source=panel.locator('.task-source').first();
    record('original-source-in-list', (await source.getAttribute('href')).includes('automationId=synthetic-glance-0'));
    const last=rows.last();
    await last.focus(); await last.scrollIntoViewIfNeeded();
    const offset=await panel.locator('.tasks-list').evaluate(e=>e.scrollTop);
    record('list-independently-scrollable', offset>0 && await page.evaluate(()=>scrollY===0));
    const previous=await last.elementHandle();
    await page.evaluate(()=>{ window.nextTaskRender = new Promise(resolve => {
      const observer = new MutationObserver(()=>{observer.disconnect();resolve();});
      observer.observe(document.querySelector('.tasks-sync'),{childList:true});
    }); });
    await page.evaluate(()=>chrome.runtime.sendMessage({protocol:'vaiwl-tasks/1',command:'CONFIGURE',patch:{preview:true}}));
    await page.evaluate(()=>window.nextTaskRender);
    record('background-update-preserves-focused-record-and-scroll', await previous.evaluate(e=>e===document.activeElement) &&
      Math.abs(await panel.locator('.tasks-list').evaluate(e=>e.scrollTop)-offset)<2);
    await previous.dispose();
    await page.keyboard.press('Enter'); await page.locator('#task-result-dialog[open]').waitFor();
    record('row-opens-full-record', (await page.locator('#task-result-body').innerText()).includes(taskNames.at(-1)));
    await page.keyboard.press('Escape'); await panel.waitFor();
    await page.waitForFunction(()=>document.activeElement===document.querySelectorAll('.task-row')[document.querySelectorAll('.task-row').length-1]);
    record('detail-returns-to-origin-in-scrolled-list', Math.abs(await panel.locator('.tasks-list').evaluate(e=>e.scrollTop)-offset)<2);
    await panel.locator('.task-actions button').first().focus(); await page.keyboard.press('Tab');
    await panel.waitFor({state:'hidden'});
    record('tab-leaves-nonmodal-panel', !await panel.isVisible());
    await toggle.click(); await panel.waitFor();
    await page.locator('#search-trigger').click(); await page.locator('#search-dialog[open]').waitFor();
    record('outside-search-dismisses-panel', !await panel.isVisible()); await page.keyboard.press('Escape');
    await page.locator('.task-featured').click(); await page.locator('#task-result-dialog[open]').waitFor();
    record('one-click-literal-retained-body', await page.locator('#task-result-body').innerText()===excerpt);
    await page.locator('#task-result-close').click();
    record('direct-read-returns-to-summary', await page.locator('.task-featured').evaluate(e=>e===document.activeElement));
    await toggle.click(); await panel.waitFor(); await page.locator('#mode-toggle').click();
    await page.waitForFunction(()=>document.documentElement.dataset.homeMode==='life');
    record('life-clears-open-panel-and-private-dom', await page.evaluate(()=>!document.querySelector('#task-panel')&&!document.body.textContent.includes('行业动态简报')&&!document.querySelector('#tasks-home').childNodes.length));
    await page.locator('#mode-toggle').click(); await toggle.waitFor();
    await seedTasks(fixture(1)); await page.locator('.task-featured').waitFor();
    record('single-result-preview', await page.locator('.task-featured').innerText()===excerpt);
    await seedTasks(fixture(1,{failed:true})); await toggle.click();
    record('error-keeps-actual-summary-and-last-read', (await page.locator('.task-featured').innerText())===excerpt && (await panel.locator('.tasks-sync').innerText()).includes('上次正文读取') && (await panel.locator('.task-problem').innerText()).includes('网络'));
    await seedTasks(fixture(1,{bodies:false})); await toggle.click();
    record('one-task-no-output', await panel.locator('.task-item').count()===1 && !(await panel.locator('.task-row').count()) && (await panel.innerText()).includes('尚未收录结果'));
    await seedTasks(fixture(0)); await toggle.click();
    record('authorized-empty-account', await panel.locator('.task-item').count()===0 && (await panel.innerText()).includes('没有已收录'));
    const noPreview=fixture(1);noPreview.settings.preview=false;await seedTasks(noPreview);await toggle.click();
    record('preview-preference-hides-excerpts', !(await panel.innerText()).includes(excerpt) && !(await page.locator('.task-featured').textContent()));
    await page.locator('[aria-label="关闭任务面板"]').click();await panel.waitFor({state:'hidden'});
    record('close-button-restores-focus', await toggle.evaluate(e=>e===document.activeElement));
    await page.evaluate(async () => {
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('vaiwl-start');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      const tx=db.transaction('scopes','readwrite');
      tx.objectStore('scopes').put({ key:'synthetic-layout-library',provider:'chatgpt',principalKey:'fixture',contextKey:'fixture',identity:'verified',
        label:'合成测试资料库',verifiedAt:new Date().toISOString(),identityAdapterVersion:'test',contextWitnessId:'layout-fixture',state:'ready' });
      await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
    });
    await seedTasks(fixture(1));await page.setViewportSize({width:1024,height:837});await page.locator('#scope-selector').waitFor();await stable();
    const scoped=await geometry();
    record('1024-library-selector-keeps-two-row-navigation',scoped['#theme-controls'].y>=scoped['#tasks-home'].y+scoped['#tasks-home'].h &&
      scoped['#tasks-home'].x+scoped['#tasks-home'].w<=scoped['#search-trigger'].x);
    // Chromium reserves zoom on the chrome://newtab alias. Use the same installed
    // document's own URL for browser zoom, as in the cross-theme guardrail suite.
    await page.goto(new URL('newtab.html', worker.url()).href); await toggle.waitFor();
    await page.setViewportSize({width:1280,height:840});
    await page.evaluate(async()=>chrome.tabs.setZoom((await chrome.tabs.getCurrent()).id,2));
    await page.waitForFunction(()=>innerWidth===640);await toggle.click();await panel.waitFor();
    record('200-percent-zoom-entry-and-panel-fit', (await rect(toggle)).width<=40 && (await rect(panel)).width<=640 &&
      await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.keyboard.press('Escape');
    await page.evaluate(async()=>chrome.tabs.setZoom((await chrome.tabs.getCurrent()).id,1));
  }
  record('no-browser-errors',errors.length===0);
  console.log(checks.length+' layout checks passed ('+family+')');
} finally {
  await writeFile(join(output,'receipt.json'), JSON.stringify({ buildSha: build.sha, dirty: build.dirty, family, fixture:'synthetic disposable profile', baseline:!!baseline, checks, measurements, errors },null,2));
  if(context) await context.close();
  await rm(scratch,{recursive:true,force:true});
}
