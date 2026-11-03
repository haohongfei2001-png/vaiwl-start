/** Real settings in an owned Linux browser window; no simulated browser frame.
 * Run: xvfb-run -a -s '-screen 0 2048x1152x24' node tests/browser/settings-native-window.mjs
 * Requires xdotool and ImageMagick. All data belongs to a disposable Profile.
 */
import { chromium } from 'playwright';
import { mkdtemp, mkdir, readdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { seedLayoutCatalog } from './layout-fixture.mjs';

const family = process.env.VAIWL_TEST_BROWSER_FAMILY || 'chrome';
const channel = process.env.VAIWL_BROWSER_CHANNEL || 'chromium';
const dist = resolve('dist'), out = resolve('artifacts/settings-native-window', family);
await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'vaiwl-settings-native-'));
const build = JSON.parse(await readFile(join(dist, 'build.json'), 'utf8'));
const deadline = Date.now() + 110000;
const report = {
  schema: 'vaiwl-settings-native-window/1', startedAt: new Date().toISOString(), family,
  source: { sha: build.sha, dirty: build.dirty, runtimeHashes: build.files },
  environment: { platform: process.platform, display: process.env.DISPLAY, executable: process.env.VAIWL_CHROMIUM_EXECUTABLE || `playwright:${channel}`, isolatedProfile: true, productionManifestModified: false, windowRequest: { width: 2048, height: 1152 }, compositor: 'software (--disable-gpu)', displaySizedWindow: true, f11Fullscreen: false },
  fixture: { state: 'typical', anchorIso: new Date(Date.now() - 300000).toISOString(), synthetic: true },
  officialCommands: ['https://learn.microsoft.com/en-us/deployedge/edge-learnmore-configurable-edge-commands', 'https://developer.chrome.com/docs/extensions/reference/api/tabs#method-create'],
  checks: [], frames: [], errors: [], limitations: [],
};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (id, status, observed) => report.checks.push({ id, status, observed });
const budget = () => { if (Date.now() >= deadline) throw Error('NATIVE_SETTINGS_BUDGET_110_SECONDS'); };
const command = (program, args) => { budget(); return execFileSync(program, args, { encoding: 'utf8', timeout: Math.max(250, Math.min(5000, deadline - Date.now())), maxBuffer: 1024 * 1024 }); };
let context, worker, page, windowId, timer;

async function ready(target) {
  await target.waitForSelector('html[data-start-ready="true"][data-native-ready="true"]', { timeout: 15000 });
  await target.evaluate(() => document.fonts.ready);
}
async function findOwnedWindow() {
  const pids = [];
  for (const pid of await readdir('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    const argv = (await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '')).split('\0');
    if (argv.includes(`--user-data-dir=${profile}`) && !argv.some(arg => arg.startsWith('--type='))) pids.push(pid);
  }
  if (pids.length !== 1) throw Error(`ISOLATED_BROWSER_PROCESS_NOT_UNIQUE:${pids.length}`);
  const ids = command('xdotool', ['search', '--onlyvisible', '--pid', pids[0]]).trim().split(/\s+/).filter(Boolean);
  const windows = ids.map(id => ({ id, ...geometry(id) })).filter(item => item.width >= 600 && item.height >= 400).sort((a, b) => b.width * b.height - a.width * a.height);
  if (!windows.length) throw Error('OWNED_BROWSER_WINDOW_NOT_FOUND');
  report.environment.processId = Number(pids[0]); return windows[0].id;
}
function geometry(id = windowId) {
  const value = Object.fromEntries(command('xdotool', ['getwindowgeometry', '--shell', id]).trim().split('\n').map(line => line.split('=')));
  return { x: Number(value.X), y: Number(value.Y), width: Number(value.WIDTH), height: Number(value.HEIGHT) };
}
function key(keys) { command('xdotool', ['windowfocus', '--sync', windowId]); command('xdotool', ['key', '--clearmodifiers', keys]); }
function away() { const size = geometry(); command('xdotool', ['mousemove', '--window', windowId, String(size.width - 70), String(size.height - 70)]); }
async function observe() {
  return page.evaluate(async () => {
    const tab = await chrome.tabs.getCurrent(); let zoom = null, zoomError = null;
    try { zoom = await chrome.tabs.getZoom(tab.id); } catch (error) { zoomError = String(error); }
    const box = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
    const dialog = document.querySelector('#settings-dialog'), scroll = document.querySelector('#settings-scroll');
    const close = dialog.querySelector('[data-close="settings-dialog"]'), bounds = box(dialog), scrollBounds = box(scroll);
    const visible = [...dialog.querySelectorAll('button,input:not([type="file"]),select,a[href]')].filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    const controls = visible.map(el => {
      const rect = box(el), scrolled = scroll.contains(el), top = Math.max(rect.top, 0, scrolled ? scrollBounds.top : bounds.top), bottom = Math.min(rect.bottom, innerHeight, scrolled ? scrollBounds.bottom : bounds.bottom);
      const inView = bottom > top + 2;
      const hit = inView ? document.elementFromPoint((rect.left + rect.right) / 2, (top + bottom) / 2) : null;
      return { id: el.id || el.getAttribute('aria-label') || el.textContent.trim(), rect, disabled: !!el.disabled, inView, hit: !inView || hit === el || el.contains(hit), withinHorizontalBounds: rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 };
    });
    const closeBox = box(close), hit = document.elementFromPoint((closeBox.left + closeBox.right) / 2, (closeBox.top + closeBox.bottom) / 2);
    return { tabId: tab.id, nativeTabUrl: tab.url ?? null, documentUrl: location.href, zoom, zoomError, devicePixelRatio,
      outerWindow: { width: outerWidth, height: outerHeight }, cssViewport: { width: innerWidth, height: innerHeight, clientWidth: document.documentElement.clientWidth }, documentWidth: document.documentElement.scrollWidth,
      open: dialog.open, settingsPage: dialog.dataset.settingsPage, dialog: bounds, scroll: { ...scrollBounds, clientWidth: scroll.clientWidth, scrollWidth: scroll.scrollWidth, scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight },
      close: { ...closeBox, hit: hit === close || close.contains(hit) }, controls,
    };
  });
}
function pixelProof(file, size) {
  const stats = crop => {
    const fields = command('convert', [file, '-crop', crop, '+repage', '-format', '%k %[fx:standard_deviation]', 'info:']).trim().split(/\s+/);
    return { colors: Number(fields[0]), deviation: Number(fields[1]) };
  };
  const header = stats(`${size.width}x${Math.min(120, size.height)}+0+0`);
  const body = stats(`${size.width}x${size.height - 150}+0+150`);
  return { header, body, rendered: header.colors > 24 && body.colors > 100 && header.deviation > .005 && body.deviation > .005 };
}
async function capture(id, claim) {
  budget(); await page.bringToFront(); await pause(160);
  const attempts = []; let pixels, measured, size, source;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) {
      const dimensions = geometry();
      command('xdotool', ['windowsize', '--sync', windowId, String(dimensions.width - 1), String(dimensions.height)]);
      command('xdotool', ['windowsize', '--sync', windowId, String(dimensions.width), String(dimensions.height)]);
      await pause(350);
    }
    measured = await observe(); const file = `${id}-attempt-${attempt}.png`, path = join(out, file);
    command('import', ['-window', windowId, path]); pixels = await readFile(path);
    if (!pixels.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('NATIVE_SCREENSHOT_IS_NOT_PNG');
    size = { width: pixels.readUInt32BE(16), height: pixels.readUInt32BE(20) };
    const proof = pixelProof(path, size); attempts.push({ file, sha256: digest(pixels), pixelSize: size, proof });
    if (proof.rendered) { source = path; break; }
  }
  if (!source) { check(`${id}-pixels`, 'FAIL', attempts); throw Error(`NATIVE_SETTINGS_WINDOW_NOT_PAINTED:${id}`); }
  const file = `${id}.png`; await copyFile(source, join(out, file));
  report.frames.push({ id, claim, file, sha256: digest(pixels), pixelSize: size, x11Geometry: geometry(), measured, attempts });
  check(`${id}-pixels`, 'PASS', { file, proof: attempts.at(-1).proof });
  const fits = measured.open && measured.dialog.left >= -1 && measured.dialog.top >= -1 && measured.dialog.right <= measured.cssViewport.width + 1 && measured.dialog.bottom <= measured.cssViewport.height + 1
    && measured.documentWidth <= measured.cssViewport.width + 1 && measured.scroll.scrollWidth <= measured.scroll.clientWidth + 1
    && measured.close.hit && measured.close.top >= 0 && measured.close.bottom <= measured.cssViewport.height && measured.close.right <= measured.cssViewport.width
    && measured.controls.every(control => control.withinHorizontalBounds && (control.disabled || control.hit));
  check(`${id}-settings-bounds`, fits ? 'PASS' : 'FAIL', { dialog: measured.dialog, close: measured.close, viewport: measured.cssViewport, scroll: measured.scroll, failures: measured.controls.filter(control => !control.withinHorizontalBounds || !control.disabled && !control.hit) });
  return measured;
}
async function section(name) {
  await page.locator(`#settings-nav-${name}`).click();
  await page.locator(`#settings-panel-${name}`).waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#settings-scroll').getAttribute('aria-busy') !== 'true');
}
async function nativeZooms() {
  key('ctrl+0'); await pause(200); await section('newtab'); const normal = await observe();
  for (const [factor, presses] of [[1.25, 2], [1.5, 3]]) {
    key('ctrl+0'); for (let n = 0; n < presses; n++) key('ctrl+plus'); await pause(1800);
    const actual = await capture(`settings-zoom-${factor * 100}`, 'Actual native keyboard zoom; requested and measured factor are recorded separately.');
    const reached = Math.abs((actual.zoom ?? 0) - factor) < .01 && Math.abs(actual.cssViewport.width * factor - normal.cssViewport.width) <= 3 && Math.abs(actual.outerWindow.width - normal.outerWindow.width) <= 1;
    check(`native-zoom-${factor}`, reached ? 'PASS' : 'BLOCKED', { requested: factor, actual: actual.zoom, normalViewport: normal.cssViewport, actualViewport: actual.cssViewport, method: 'X11 Ctrl+Plus after Ctrl+0; no CSS or device-metric emulation' });
    await section('workspace'); await capture(`workspace-zoom-${factor * 100}`, 'Workspace controls inside the same native-zoomed settings window.'); await section('newtab');
  }
  key('ctrl+0'); await pause(200);
}
async function edgeVertical(initial) {
  key('ctrl+shift+comma'); await pause(600);
  const toggled = await capture('edge-vertical-command', 'Official native Edge Ctrl+Shift+, command; resulting state determined from actual viewport change.');
  let horizontal, vertical;
  const delta = initial.cssViewport.width - toggled.cssViewport.width;
  if (delta >= 24 && Math.abs(initial.outerWindow.width - toggled.outerWindow.width) <= 1) { horizontal = initial; vertical = toggled; }
  else if (delta <= -24 && Math.abs(initial.outerWindow.width - toggled.outerWindow.width) <= 1) {
    horizontal = toggled; key('ctrl+shift+comma'); await pause(600); vertical = await capture('edge-vertical-restored', 'Restored native vertical tabs after a fresh Profile initially opened with them.');
  } else { check('edge-native-vertical-tabs', 'BLOCKED', { reason: 'Official command produced no measurable native sidebar.', initial, toggled }); check('edge-native-sidebar-collapse-expand', 'BLOCKED', 'No verified vertical state from which to operate the native pane.'); return; }
  const occupied = horizontal.cssViewport.width - vertical.cssViewport.width;
  check('edge-native-vertical-tabs', 'PASS', { shortcut: 'Ctrl+Shift+,', occupiedCssPixels: occupied, horizontalViewport: horizontal.cssViewport, verticalViewport: vertical.cssViewport });
  // The inherited Edge 156 real-window evidence shows the native pin at the
  // right end of the pane's header. Its location is derived from the observed
  // sidebar width and browser-chrome height, only within that verified geometry.
  // There is no documented collapse shortcut; Ctrl+Shift+. opens Copilot.
  const top = vertical.outerWindow.height - vertical.cssViewport.height * vertical.devicePixelRatio;
  const border = (horizontal.outerWindow.width - horizontal.cssViewport.width) / 2;
  if (Math.abs(vertical.devicePixelRatio - 1) > .01 || occupied < 160 || occupied > 360 || top < 40 || top > 180) {
    check('edge-native-sidebar-collapse-expand', 'BLOCKED', { reason: 'Native pin placement is outside the inherited screenshot geometry; no guessed click was issued.', occupied, top, border }); return;
  }
  const pin = { x: Math.round(border + occupied - 21), y: Math.round(top - 18) };
  command('xdotool', ['mousemove', '--window', windowId, String(pin.x), String(pin.y)]); command('xdotool', ['click', '1']); away(); await pause(750);
  const collapsed = await capture('edge-sidebar-collapse-attempt', 'Actual native pin action and resulting window; collapse is claimed only after the measured sidebar checks pass.');
  const remaining = horizontal.cssViewport.width - collapsed.cssViewport.width;
  const isCollapsed = collapsed.cssViewport.width - vertical.cssViewport.width >= 80 && remaining >= 24 && remaining <= 110 && Math.abs(collapsed.cssViewport.height - vertical.cssViewport.height) <= 1 && Math.abs(collapsed.outerWindow.width - vertical.outerWindow.width) <= 1;
  check('edge-native-sidebar-collapse', isCollapsed ? 'PASS' : 'BLOCKED', { nativePin: pin, expandedViewport: vertical.cssViewport, observedViewport: collapsed.cssViewport, remainingSidebarPixels: remaining });
  if (!isCollapsed) { check('edge-native-sidebar-expand', 'BLOCKED', 'Collapse was not verified; no follow-up pin click was attempted.'); return; }
  command('xdotool', ['mousemove', '--window', windowId, String(Math.round(border + 20)), String(Math.round(top + 55))]); await pause(650);
  await capture('edge-sidebar-hover', 'Real pointer hover on the collapsed native rail; this frame alone does not establish a pinned expanded state.');
  command('xdotool', ['mousemove', '--window', windowId, String(pin.x), String(pin.y)]); command('xdotool', ['click', '1']); away(); await pause(650);
  const expanded = await capture('edge-sidebar-expand-attempt', 'Actual native pane pin action after hover; expansion is claimed only after viewport-width restoration.');
  check('edge-native-sidebar-expand', Math.abs(expanded.cssViewport.width - vertical.cssViewport.width) <= 3 && Math.abs(expanded.cssViewport.height - vertical.cssViewport.height) <= 1 && Math.abs(expanded.outerWindow.width - vertical.outerWindow.width) <= 1 ? 'PASS' : 'BLOCKED', { nativePin: pin, originalExpandedViewport: vertical.cssViewport, observedViewport: expanded.cssViewport });
}

async function run() {
  if (process.platform !== 'linux' || !process.env.DISPLAY) throw Error('LINUX_X_DISPLAY_REQUIRED');
  for (const [name, expected] of Object.entries(build.files)) if (digest(await readFile(join(dist, name))) !== expected) throw Error(`BUILD_HASH_MISMATCH:${name}`);
  context = await chromium.launchPersistentContext(profile, { ...(process.env.VAIWL_CHROMIUM_EXECUTABLE ? { executablePath: process.env.VAIWL_CHROMIUM_EXECUTABLE } : { channel }), headless: false, viewport: null,
    args: ['--no-sandbox', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=2048,1152', '--window-position=0,0', `--disable-extensions-except=${dist}`, `--load-extension=${dist}`] });
  context.setDefaultTimeout(12000);
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;
  report.environment.userAgent = await worker.evaluate(() => navigator.userAgent);
  report.environment.browserVersion = context.browser()?.version();
  if (/Edg\//.test(report.environment.userAgent) !== (family === 'edge')) throw Error('REQUESTED_BROWSER_FAMILY_MISMATCH');
  page = await context.newPage(); await page.goto(`chrome-extension://${extensionId}/newtab.html`); await ready(page);
  await seedLayoutCatalog(page, 'typical', report.fixture.anchorIso);
  const pending = context.waitForEvent('page', { timeout: 15000 });
  report.nativeEntry = await worker.evaluate(async () => { const properties = { active: true }, tab = await chrome.tabs.create(properties); return { method: 'chrome.tabs.create', properties, urlOmitted: !Object.hasOwn(properties, 'url'), tabId: tab.id, windowId: tab.windowId, returnedUrl: tab.url ?? null }; });
  page = await pending; page.on('pageerror', error => report.errors.push(error.message)); await ready(page);
  for (const other of context.pages()) if (other !== page) await other.close();
  windowId = await findOwnedWindow(); command('xdotool', ['windowmove', windowId, '0', '0']); command('xdotool', ['windowsize', '--sync', windowId, '2048', '1152']);
  await page.bringToFront(); key('Escape'); key('ctrl+0'); away(); await pause(300);
  await page.locator('#settings-trigger').click(); await page.locator('#settings-panel-newtab').waitFor();
  const initial = await capture('settings-fullscreen-window', 'Settings opened from the real browser new-tab entry; complete 2048×1152 owned browser window including native decorations.');
  check('native-new-tab-entry', report.nativeEntry.urlOmitted && initial.tabId === report.nativeEntry.tabId && initial.documentUrl === `chrome-extension://${extensionId}/newtab.html` ? 'PASS' : 'FAIL', { ...report.nativeEntry, observedTabId: initial.tabId, documentUrl: initial.documentUrl, nativeTabUrl: initial.nativeTabUrl, noNavigationAfterCreation: true });
  await section('workspace'); await capture('workspace-fullscreen-window', 'AI workspace settings in the same real native browser window.'); await section('newtab');
  if (family === 'edge') await edgeVertical(initial);
  await nativeZooms();
  key('Escape'); await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
  check('native-Escape-and-return-focus', await page.evaluate(() => document.activeElement?.id === 'settings-trigger') ? 'PASS' : 'FAIL', 'X11 Escape closes the settings dialog and returns focus to its actual trigger.');
  await page.locator('#settings-trigger').click(); command('xdotool', ['windowsize', '--sync', windowId, '1024', '768']); away(); await pause(450);
  await capture('settings-narrow-native-window', 'Actual 1024×768 browser window, native zoom reset to 100%; no emulated viewport.');
  await section('workspace'); await capture('workspace-narrow-native-window', 'Workspace controls within the same narrower native browser window.');
  for (const [name, expected] of Object.entries(build.files)) if (digest(await readFile(join(dist, name))) !== expected) throw Error(`RUNTIME_MODIFIED_DURING_TEST:${name}`);
  check('production-runtime-unchanged', 'PASS', 'All build-declared runtime hashes, including the unmodified production manifest, match before and after the test.');
}
try {
  await Promise.race([run(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('NATIVE_SETTINGS_BUDGET_110_SECONDS')), 110000); })]);
} catch (error) { report.errors.push(String(error)); check('native-settings-execution', 'FAIL', String(error)); }
finally {
  clearTimeout(timer);
  if (context) await context.close().catch(error => report.errors.push(String(error)));
  report.limitations.push('All screenshots are captured from the actual owned X11 window, not Playwright content screenshots or composited browser frames. Linux Xvfb software rendering and synthetic data are not user Mac acceptance.');
  report.limitations.push('No optional permissions are granted by this suite; no native consent acceptance or denial is claimed. Native zoom/sidebar commands that do not produce the measured state are reported BLOCKED.');
  report.limitations.push('Production permissions may omit tabs.Tab.url. Native entry proof uses URL-omitted tabs.create and exact created/current tab identity; no internal browser URL is invented.');
  report.status = report.errors.length || report.checks.some(item => item.status === 'FAIL') ? 'FAIL' : report.checks.some(item => item.status === 'BLOCKED') ? 'PARTIAL' : 'PASS';
  report.finishedAt = new Date().toISOString();
  await writeFile(join(out, 'validation.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, family, buildSha: build.sha, checks: report.checks.map(item => ({ id: item.id, status: item.status })), errors: report.errors, report: join(out, 'validation.json') }));
  process.exitCode = report.status === 'FAIL' ? 1 : 0;
}
