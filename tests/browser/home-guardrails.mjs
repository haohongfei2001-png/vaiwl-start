/**
 * Installed production extension acceptance for all four homepage guardrails.
 * All catalog records and browser profiles are synthetic and disposable.
 * Runtime bundles are copied byte-for-byte from the hashed production build.
 */
import { chromium } from 'playwright';
import { mkdtemp, mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { layoutFixtures, seedLayoutCatalog } from './layout-fixture.mjs';

const family = process.env.VAIWL_TEST_BROWSER_FAMILY || 'chrome';
const output = resolve('artifacts', 'home-guardrails', family);
const reportPath = resolve('artifacts', `${family === 'edge' ? 'edge-' : ''}home-guardrails-validation.json`);
const build = JSON.parse(await readFile('dist/build.json', 'utf8'));
const checks = [], screenshots = [], measurements = [], errors = [];
let context, page, worker, browserVersion = '', failure;
await mkdir(output, { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (id, pass, observed) => {
  checks.push({ id, status: pass ? 'PASS' : 'FAIL', observed });
  assert.ok(pass, `${id}: ${JSON.stringify(observed)}`);
};
async function until(probe, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await probe(); if (value) return value; await pause(40); }
  throw new Error(`Timed out: ${label}`);
}
async function ready(target) {
  await target.waitForSelector('html[data-start-ready="true"][data-native-ready="true"]', { timeout: 15000 });
  await target.evaluate(() => document.fonts.ready);
  await target.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function theme(target, value) {
  await until(() => target.evaluate(v => document.documentElement.dataset.homeTheme === v, value), `theme ${value}`);
}
async function settings(target) {
  if (!(await target.locator('#settings-dialog').evaluate(el => el.open))) await target.locator('#settings-trigger').click();
  await target.locator('#settings-nav-newtab').click();
}
async function choose(target, value) {
  await settings(target);
  await target.locator(`[data-home-theme-choice="${value}"]`).click();
  await theme(target, value);
  await until(() => target.evaluate(async v => ((await chrome.storage.local.get('native.homeTheme'))['native.homeTheme'] ?? 'classic') === v, value), `stored theme ${value}`);
}
async function closeSettings(target) {
  if (await target.locator('#settings-dialog').evaluate(el => el.open)) await target.keyboard.press('Escape');
}
async function raw(target) {
  return target.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('vaiwl-start'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const values = {};
    for (const name of [...db.objectStoreNames].sort()) values[name] = await new Promise((resolve, reject) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    db.close(); return values;
  });
}
async function capture(label, target = page) {
  const name = `${label}.png`;
  await target.screenshot({ path: join(output, name), fullPage: true, animations: 'disabled' });
  screenshots.push({ file: join('home-guardrails', family, name), label, source: 'installed extension; synthetic catalog' });
}

async function stored(key, expected) {
  await until(() => page.evaluate(async ({key,expected}) => JSON.stringify((await chrome.storage.local.get(key))[key]) === JSON.stringify(expected), {key,expected}), key);
}
async function geometry(target) {
  return target.evaluate(() => {
    const grid = document.querySelector('.spatial-project-grid');
    const cards = grid ? [...grid.children].filter(el => el.matches('.project')) : [];
    const r = el => { const x = el.getBoundingClientRect(); return {key:el.dataset.project,x:x.x,y:x.y,w:x.width,h:x.height,bottom:x.bottom}; };
    return { viewport:innerWidth, width:document.documentElement.scrollWidth, layout:document.documentElement.dataset.projectLayout,
      columns:grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length : 0, gridWidth:grid?.getBoundingClientRect().width, gap:grid ? parseFloat(getComputedStyle(grid).columnGap)||0 : 0, gridMode:grid?.dataset.projectLayout, cards:cards.map(r) };
  });
}
async function settledAdaptive(target, label) {
  return until(async () => {
    const g = await geometry(target);
    const width = (g.gridWidth - g.gap * (g.columns - 1)) / g.columns;
    return g.gridMode === 'adaptive' && g.cards.length > 0 && g.width <= g.viewport + 1
      && g.cards.every(card => Math.abs(card.w - width) < 1 && card.x >= -1 && card.x + card.w <= g.viewport + 1)
      ? g : false;
  }, label);
}
try {
  const harness = await mkdtemp(join(tmpdir(), 'vaiwl-home-guardrails-extension-'));
  await cp(resolve('dist'), harness, { recursive:true });
  for (const [name,digest] of Object.entries(build.files)) assert.equal(createHash('sha256').update(await readFile(join(harness,name))).digest('hex'),digest);
  const profile = await mkdtemp(join(tmpdir(),'vaiwl-home-guardrails-profile-'));
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.VAIWL_CHROMIUM_EXECUTABLE ? {executablePath:process.env.VAIWL_CHROMIUM_EXECUTABLE} : {channel:process.env.VAIWL_BROWSER_CHANNEL || 'chromium'}),
    headless:process.env.VAIWL_HEADLESS !== 'false', timezoneId:'UTC', viewport:{width:1440,height:1000},
    args:['--no-sandbox',`--disable-extensions-except=${harness}`,`--load-extension=${harness}`],
  });
  context.on('page',target=>target.on('pageerror',error=>errors.push(String(error))));
  await context.route(/^https?:\/\//,route=>route.abort());
  worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  browserVersion=context.browser()?.version() || await worker.evaluate(()=>navigator.userAgent);
  const extensionUrl=`chrome-extension://${new URL(worker.url()).host}/newtab.html`;
  page=await context.newPage(); await page.goto(extensionUrl); await ready(page);
  await seedLayoutCatalog(page,'dense',new Date().toISOString());
  await page.reload(); await ready(page);
  const before=await raw(page);
  check('R6-default-adaptive',await page.evaluate(()=>document.documentElement.dataset.projectLayout==='adaptive'),'Missing preference defaults to adaptive.');
  for(const selectedTheme of ['classic','spatial','workbench','folio']) {
    await choose(page,selectedTheme); await closeSettings(page);
    const chrome=await page.evaluate(()=>{
      const text=[...document.querySelectorAll('.topbar,.board-heading,.spatial-section-heading')].flatMap(el=>[el.textContent,...[el,...el.querySelectorAll('*')].flatMap(n=>[n.getAttribute('title')||'',n.getAttribute('aria-label')||''])]).join(' ');
      return {modeButtons:document.querySelectorAll('#mode-toggle').length,oldModeButtons:document.querySelectorAll('#theme-mode-work,#theme-mode-life').length,
        modeLabel:document.querySelector('#mode-toggle')?.getAttribute('aria-label'),text,
        badges:document.querySelectorAll('.spatial-project-count,.spatial-date-count,.spatial-filter-count,.project-count').length,
        heads:[...document.querySelectorAll('.project-head')].map(h=>({buttons:[...h.querySelectorAll('button')].map(b=>({label:b.getAttribute('aria-label'),disabled:b.disabled||b.getAttribute('aria-disabled')==='true',title:b.title})),menus:h.querySelectorAll('[data-project-menu]').length})),
        period:[...document.querySelectorAll('#period-newer,#period-older')].map(n=>n.getAttribute('aria-label'))};
    });
    check(`R1-${selectedTheme}-no-count-chrome`,chrome.badges===0&&!/\d+\s*(?:个项目|条会话|个会话|个窗口)/.test(chrome.text),chrome);
    check(`R2-${selectedTheme}-arrows-without-range-label`,!/(?:近|更早|最近)\s*(?:7|30|90)\s*天|\d{4}-\d{2}-\d{2}\s*[—–]/.test(chrome.text)&&chrome.period.join('|')==='更新时段|更早时段',chrome.period);
    check(`R3-${selectedTheme}-one-reversible-control`,chrome.modeButtons===1&&chrome.oldModeButtons===0&&/当前为工作模式.*切换到生活/.test(chrome.modeLabel),chrome.modeLabel);
    check(`R4-${selectedTheme}-plus-only-with-honest-capability`,chrome.heads.length>0&&chrome.heads.every(h=>h.menus===0&&h.buttons.length===1&&/新建/.test(h.buttons[0].label)&&(!h.buttons[0].disabled||!!h.buttons[0].title)),chrome.heads);
    const initialDates=await page.locator('.spatial-date-band').allTextContents();
    check(`R5-${selectedTheme}-focus-groups`,initialDates.some(t=>t.includes('今天'))&&initialDates.some(t=>t.includes('昨天'))&&await page.locator('[data-recent-kind="pinned"]').count()===0,initialDates.map(t=>t.slice(0,45)));
    await page.locator('#recent-toggle-more').click();
    check(`R5-${selectedTheme}-more-real-groups`,await page.locator('.spatial-date-band').count()>initialDates.length,'Disclosure expands remaining groups in this period.');
    await page.locator('#recent-toggle-more').click();
    await settings(page); await page.locator('[data-project-layout-choice="equal"]').click(); await stored('native.projectLayout','equal'); await closeSettings(page);
    await until(async()=>{const g=await geometry(page);return g.cards.length>0&&g.cards.every(c=>Math.abs(c.h-g.cards[0].h)<1)},'equal card geometry');
    const equal=await geometry(page); measurements.push({theme:selectedTheme,mode:'equal',...equal});
    check(`R6-${selectedTheme}-equal-exterior`,equal.cards.every(c=>Math.abs(c.h-equal.cards[0].h)<1&&Math.abs(c.w-equal.cards[0].w)<1),equal);
    await settings(page);await page.locator('[data-project-layout-choice="adaptive"]').click();await stored('native.projectLayout','adaptive');await closeSettings(page);
    for(const width of [1720,1440,1280,960,768,390]) {
      await page.setViewportSize({width,height:1000});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await until(async()=>{const g=await geometry(page);const w=(g.gridWidth-g.gap*(g.columns-1))/g.columns;return g.gridMode==='adaptive'&&g.cards.length>0&&g.cards.every(c=>Math.abs(c.w-w)<1)},'layout after viewport change');
      const g=await geometry(page);measurements.push({theme:selectedTheme,mode:'adaptive',...g});
      check(`R6-${selectedTheme}-adaptive-bounds-${width}`,g.width<=g.viewport+1&&g.cards.every(c=>c.w>0&&c.x>=-1&&c.x+c.w<=g.viewport+1),g);
      const reading=g.cards.slice().sort((a,b)=>Math.abs(a.y-b.y)<1?a.x-b.x:a.y-b.y).map(c=>c.key);
      check(`R6-${selectedTheme}-stable-visual-keyboard-order-${width}`,JSON.stringify(reading)===JSON.stringify(g.cards.map(c=>c.key)),reading);
      if(g.columns>1) check(`R6-${selectedTheme}-fills-short-column-${width}`,g.cards.some((card,i)=>i>=g.columns&&card.y<Math.max(...g.cards.slice(0,g.columns).map(c=>c.bottom))-1),g);
    }
    await page.setViewportSize({width:1440,height:1000});
    const zoom=await page.evaluate(async()=>{const t=await chrome.tabs.getCurrent();await chrome.tabs.setZoom(t.id,2);return chrome.tabs.getZoom(t.id)});
    const zg=await settledAdaptive(page,'adaptive layout after real browser zoom');check(`R6-${selectedTheme}-real-browser-zoom-200`,zoom===2&&zg.width<=zg.viewport+1,{zoom,...zg});
    await page.evaluate(async()=>{const t=await chrome.tabs.getCurrent();await chrome.tabs.setZoom(t.id,1)});
    await settledAdaptive(page,'adaptive layout after restoring browser zoom');
  }
  await page.locator('#recent-manage-pins').click();
  const pin=page.locator('#pins-list input[data-recent-pin]').first(); const pinnedKey=await pin.getAttribute('data-recent-pin');
  await pin.check(); await stored('native.recentPinnedKeys',[pinnedKey]); await page.keyboard.press('Escape');
  await until(()=>page.locator('[data-recent-kind="pinned"] a[data-record-key]').count(),'pinned group');
  check('R5-explicit-pin-single-instance',await page.locator('.recent-section a[data-record-key]').evaluateAll((nodes,key)=>nodes.filter(n=>n.dataset.recordKey===key).length,pinnedKey)===1,'Pinned record is omitted from its date group.');
  await page.reload(); await ready(page);
  check('R5-pin-survives-reload',await page.locator('[data-recent-kind="pinned"] a[data-record-key]').count()===1,'Explicit local preference restored.');
  await page.locator('#recent-manage-pins').click(); await page.locator('#pins-list input[data-recent-pin]:checked').uncheck(); await stored('native.recentPinnedKeys',[]); await page.keyboard.press('Escape');
  check('R5-no-empty-pin-frame',await page.locator('[data-recent-kind="pinned"]').count()===0,'Unpin removes the empty section.');
  for(const days of [7,90,30]) {
    await settings(page); await page.locator('#home-period-days').selectOption(String(days)); await stored('native.homePeriodDays',days);await closeSettings(page);
    if(await page.locator('#recent-toggle-more').count()) await page.locator('#recent-toggle-more').click();
    const todayNumber=Math.floor(Date.now()/86400000);
    const expectedDates=[...new Set(Object.values(before).flat().filter(row=>row?.conversationId&&!row.localProject&&row.browserLastVisitAt).map(row=>row.browserLastVisitAt.slice(0,10)).filter(date=>{const day=Math.floor(Date.parse(date+'T00:00:00Z')/86400000);return day<=todayNumber&&day>=todayNumber-days+1}))].sort();
    const shownDates=await page.locator('.recent-section [data-date]').evaluateAll(nodes=>[...new Set(nodes.map(n=>n.dataset.date))].sort());
    check(`R2-setting-${days}-takes-effect`,await page.locator('#home-period-days').inputValue()===String(days)&&await page.locator('#period-newer').isDisabled()&&JSON.stringify(shownDates)===JSON.stringify(expectedDates),{days,expectedDates,shownDates});
    if(await page.locator('#recent-toggle-more').count())await page.locator('#recent-toggle-more').click();
  }
  await page.locator('#period-older').click();
  check('R2-historical-date-fallback',await page.locator('.spatial-date-band').count()===1&&!/今天|昨天/.test(await page.locator('.spatial-date-band').textContent()),'Historical period shows its newest real date.');
  await settings(page);await page.locator('#home-period-days').selectOption('7');await stored('native.homePeriodDays',7);await closeSettings(page);
  check('R2-historical-reanchor-by-end-day',await page.evaluate(()=>JSON.parse(sessionStorage.getItem('vaiwl-start-view/1')).k)===4,'Old current-minus-30 end-day is relocated into the appropriate weekly period.');
  check('R2-weekly-empty-reanchor',await page.locator('.period-empty').count()===1,'The relocated weekly period is empty without borrowing records.');
  await page.locator('#period-older').click();
  check('R2-weekly-adjacent-reveals-history',await page.getByRole('link',{name:'在 ChatGPT 中打开：上一个 30 天区间中的讨论',exact:true}).isVisible(),'One adjacent weekly step reveals the real record aged forty days.');
  await settings(page);await page.locator('#home-period-days').selectOption('30');await stored('native.homePeriodDays',30);await closeSettings(page);
  check('R2-historical-reanchor-return',await page.getByRole('link',{name:'在 ChatGPT 中打开：上一个 30 天区间中的讨论',exact:true}).isVisible(),'The chosen historical end-day remains within the new thirty-day period.');
  await page.locator('#period-older').click();
  check('R2-empty-period-navigation',await page.locator('.period-empty').count()===1&&await page.locator('#period-newer').isEnabled()&&await page.locator('#period-older').isEnabled(),'Empty period remains navigable.');
  await page.locator('#period-newer').click();await page.locator('#period-newer').click();
  check('R2-latest-boundary',await page.locator('#period-newer').isDisabled(),'No future period is offered.');
  check('R1-R6-catalog-facts-untouched',JSON.stringify(await raw(page))===JSON.stringify(before),'Only local presentation preferences changed; catalog, memberships and source timestamps are byte-equivalent.');
  await capture('guardrails-complete');
  await page.locator('#mode-toggle').click();
  check('R3-life-clears-private-dom',await page.evaluate(()=>document.documentElement.dataset.homeMode==='life'&&document.querySelector('#workspace-content').children.length===0&&document.querySelector('#pins-list').children.length===0&&document.querySelector('#mode-toggle').getAttribute('aria-label').includes('切换到工作')),'Same button reverses direction; private pin titles are cleared.');
  check('GUARDRAILS-no-runtime-errors',errors.length===0,errors);
} catch(error) {
  failure=String(error?.stack||error);checks.push({id:'GUARDRAILS-harness-completion',status:'FAIL',observed:failure});
  if(page)try{await capture('failure')}catch{}
} finally {
  if(context)await context.close();
  const report={status:failure||checks.some(c=>c.status==='FAIL')?'FAIL':'PASS',browser:family,browserVersion,build,checks,screenshots,measurements,errors,
    limitations:['Synthetic catalog in installed extension; no live ChatGPT new-project-chat entry is certified.','All viewport widths refer to page content, excluding native browser chrome.']};
  await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.log(`${report.status}: ${checks.filter(c=>c.status==='PASS').length}/${checks.length} home guardrail checks; ${reportPath}`);
}
if(failure){console.error(failure);process.exitCode=1}
