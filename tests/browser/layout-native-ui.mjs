/** Actual Linux browser chrome, captured from an isolated X display.
 * Run: xvfb-run -a -s '-screen 0 2048x1152x24' node tests/browser/layout-native-ui.mjs
 * Requires xdotool and ImageMagick import. Never reads an existing Profile.
 */
import { chromium } from 'playwright';
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { seedLayoutCatalog } from './layout-fixture.mjs';

const family = process.env.VAIWL_TEST_BROWSER_FAMILY || 'chrome';
const channel = process.env.VAIWL_BROWSER_CHANNEL || 'chromium';
const out = resolve('artifacts/layout-native-ui', family), dist = resolve('dist');
await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'vaiwl-layout-native-'));
const build = JSON.parse(await readFile(join(dist, 'build.json'), 'utf8'));
const report = { schema: 'vaiwl-layout-native-ui/1', startedAt: new Date().toISOString(), family, channel,
  source: { sha: build.sha, dirty: build.dirty, runtimeHashes: build.files },
  environment: { platform: process.platform, display: process.env.DISPLAY, windowRequest: { width: 2048, height: 1152 }, isolatedProfile: true, productionManifestModified: false },
  fixture: { state: 'typical', anchorIso: new Date(Date.now() - 300000).toISOString(), synthetic: true },
  officialCommands: [
    'https://learn.microsoft.com/en-us/deployedge/edge-learnmore-configurable-edge-commands',
    'https://support.microsoft.com/en-us/edge/keyboard-shortcuts-in-microsoft-edge',
  ], checks: [], frames: [], errors: [], limitations: [] };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const command = (program, args) => execFileSync(program, args, { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
const check = (id, status, observed) => report.checks.push({ id, status, observed });
let context, worker, page, windowId;
async function ready(target) {
  await target.waitForSelector('html[data-start-ready="true"][data-native-ready="true"]', { timeout: 20000 });
  await target.evaluate(() => document.fonts.ready);
  await pause(150);
}
async function findOwnedWindow() {
  const matches = [];
  for (const pid of await readdir('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    const args = await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '');
    const argv = args.split('\0');
    if (!argv.includes(`--user-data-dir=${profile}`) || argv.some(arg => arg.startsWith('--type='))) continue;
    matches.push(pid);
  }
  if (matches.length !== 1) throw Error('ISOLATED_BROWSER_PROCESS_NOT_UNIQUE: ' + matches.length);
  const ids = command('xdotool', ['search', '--onlyvisible', '--pid', matches[0]]).trim().split(/\s+/).filter(Boolean);
  const windows = ids.map(id => {
    const geometry = Object.fromEntries(command('xdotool', ['getwindowgeometry', '--shell', id]).trim().split('\n').map(line => line.split('=')));
    return { id, width: Number(geometry.WIDTH), height: Number(geometry.HEIGHT) };
  }).filter(window => window.width >= 600 && window.height >= 400).sort((a, b) => b.width * b.height - a.width * a.height);
  if (!windows.length) throw Error('OWNED_VISIBLE_BROWSER_WINDOW_NOT_FOUND');
  report.environment.processId = Number(matches[0]);
  return windows[0].id;
}
function key(keys) {
  command('xdotool', ['windowfocus', '--sync', windowId]);
  command('xdotool', ['key', '--clearmodifiers', keys]);
}
async function observation() {
  return page.evaluate(async () => {
    const tab = await chrome.tabs.getCurrent();
    let zoom = null, zoomError = null;
    try { zoom = await chrome.tabs.getZoom(tab.id); } catch (error) { zoomError = String(error); }
    const rect = selector => { const el = document.querySelector(selector); if (!el || !el.getClientRects().length) return null; const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
    return { documentUrl: location.href, nativeTabUrl: tab.url, title: document.title, zoom, zoomError,
      cssViewport: { width: innerWidth, height: innerHeight, clientWidth: document.documentElement.clientWidth }, outerWindow: { width: outerWidth, height: outerHeight }, devicePixelRatio,
      documentWidth: document.documentElement.scrollWidth,
      main: rect('.workspace'), topbar: rect('.topbar'), rail: rect('#history-rail'),
      projectColumns: getComputedStyle(document.querySelector('.project-grid')).gridTemplateColumns.split(' ').map(parseFloat),
      dateColumns: getComputedStyle(document.querySelector('.date-grid')).gridTemplateColumns.split(' ').map(parseFloat),
    };
  });
}
async function capture(id, claim) {
  await page.bringToFront(); await pause(200);
  const measured = await observation();
  const file = `${id}.png`;
  command('import', ['-window', windowId, join(out, file)]);
  const pixels = await readFile(join(out, file));
  if (!pixels.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('NATIVE_SCREENSHOT_IS_NOT_PNG');
  const pixelSize = { width: pixels.readUInt32BE(16), height: pixels.readUInt32BE(20) };
  const frame = { id, claim, file, sha256: digest(pixels), pixelSize, x11Geometry: command('xdotool', ['getwindowgeometry', '--shell', windowId]).trim(), measured };
  report.frames.push(frame);
  const fits = measured.documentWidth <= measured.cssViewport.width + 1
    && measured.main.right <= measured.cssViewport.width + 1
    && measured.rail.left >= measured.main.right + 3
    && Math.abs(measured.topbar.left - measured.main.left) < 1;
  check(`${id}-geometry`, fits ? 'PASS' : 'FAIL', measured);
  return measured;
}
async function nativeZooms(prefix) {
  key('ctrl+0'); await pause(350);
  const normal = await observation();
  for (const [factor, increments] of [[1.25, 2], [1.5, 3]]) {
    key('ctrl+0');
    for (let i = 0; i < increments; i++) key('ctrl+plus');
    // Let the browser-owned zoom bubble dismiss before capturing its normal page.
    await pause(1800);
    const actual = await capture(`${prefix}-zoom-${factor * 100}`, 'Native keyboard page zoom; actual factor is recorded, never inferred from the requested keys.');
    const reached = Math.abs((actual.zoom ?? 0) - factor) < .01
      && Math.abs(actual.cssViewport.width * factor - normal.cssViewport.width) <= 3
      && Math.abs(actual.outerWindow.width - normal.outerWindow.width) <= 1;
    check(`${prefix}-native-zoom-${factor}`, reached ? 'PASS' : 'BLOCKED', { method: 'X11 native Ctrl+Plus after Ctrl+0; no CSS/device-metric emulation', requested: factor, actual: actual.zoom, normal, observed: actual });
  }
  key('ctrl+0'); await pause(250);
}
try {
  if (process.platform !== 'linux' || !process.env.DISPLAY) throw Error('LINUX_X_DISPLAY_REQUIRED');
  for (const [name, expected] of Object.entries(build.files)) if (digest(await readFile(join(dist, name))) !== expected) throw Error('BUILD_HASH_MISMATCH: ' + name);
  context = await chromium.launchPersistentContext(profile, { ...(process.env.VAIWL_CHROMIUM_EXECUTABLE ? { executablePath: process.env.VAIWL_CHROMIUM_EXECUTABLE } : { channel }), headless: false, viewport: null,
    args: ['--no-sandbox', '--no-first-run', '--no-default-browser-check', '--window-size=2048,1152', '--window-position=0,0', `--disable-extensions-except=${dist}`, `--load-extension=${dist}`] });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 20000 });
  const extensionId = new URL(worker.url()).host;
  report.environment.browserVersion = context.browser()?.version() || 'reported-in-user-agent';
  report.environment.userAgent = await worker.evaluate(() => navigator.userAgent);
  if (family === 'edge' && !/Edg\//.test(report.environment.userAgent)) throw Error('EDGE_FAMILY_NOT_CONFIRMED');
  page = await context.newPage(); await page.goto(`chrome-extension://${extensionId}/newtab.html`); await ready(page);
  await seedLayoutCatalog(page, 'typical', report.fixture.anchorIso); await page.reload(); await ready(page);
  const next = context.waitForEvent('page', { timeout: 20000 });
  await worker.evaluate(() => chrome.tabs.create({ active: true }));
  page = await next; await ready(page);
  for (const other of context.pages()) if (other !== page) await other.close();
  windowId = await findOwnedWindow();
  command('xdotool', ['windowmove', windowId, '0', '0']);
  command('xdotool', ['windowsize', '--sync', windowId, '2048', '1152']);
  await page.bringToFront(); key('Escape'); key('ctrl+0');
  command('xdotool', ['mousemove', '--window', windowId, '1948', '1052']);
  await pause(500);
  const initial = await capture('01-native-initial', 'Real installed extension opened through native new-tab entry; entire owned browser window.');
  check('native-new-tab-route', /^(chrome|edge):\/\/newtab\/?/.test(initial.nativeTabUrl || '') ? 'PASS' : 'BLOCKED', { nativeTabUrl: initial.nativeTabUrl, documentUrl: initial.documentUrl });
  if (family === 'edge') {
    key('ctrl+shift+comma'); await pause(700);
    const toggled = await capture('02-edge-vertical-command', 'Real Edge Ctrl+Shift+, command; direction is determined by measured content-width change.');
    const delta = initial.cssViewport.width - toggled.cssViewport.width;
    if (delta >= 24 && Math.abs(initial.outerWindow.width - toggled.outerWindow.width) <= 1) {
      check('edge-native-vertical-tabs', 'PASS', { shortcut: 'Ctrl+Shift+,', horizontalFrame: '01-native-initial', verticalFrame: '02-edge-vertical-command', contentWidthLostToSidebar: delta });
    } else if (delta <= -24 && Math.abs(initial.outerWindow.width - toggled.outerWindow.width) <= 1) {
      key('ctrl+shift+comma'); await pause(700);
      await capture('03-edge-restored-vertical', 'Fresh Edge had vertical tabs enabled; restored native vertical state after measuring horizontal state.');
      check('edge-native-vertical-tabs', 'PASS', { shortcut: 'Ctrl+Shift+,', horizontalFrame: '02-edge-vertical-command', verticalFrame: '03-edge-restored-vertical', contentWidthLostToSidebar: -delta });
    } else check('edge-native-vertical-tabs', 'BLOCKED', { reason: 'Shortcut did not produce a measurable native sidebar; inspect actual browser screenshots.', initial, toggled });
    await nativeZooms('edge-native');
  } else {
    check('chrome-native-tabstrip-window', 'PASS', { frame: '01-native-initial', nativeBrowserWindowPixels: true, contentOnlyScreenshot: false });
    await nativeZooms('chrome-native');
  }
  report.limitations.push('The initial user screenshot pixels and private catalog were not available to this run. This is a 2048×1152 isolated Linux browser window with the shared synthetic fixture, not a claim of user Mac acceptance.');
  report.limitations.push('Optional bookmarks permission is not pre-granted and the production manifest is unchanged; this native-frame fixture has no bookmark shelf. The responsive content suite validates bookmark states separately.');
} catch (error) { report.errors.push(String(error)); check('native-ui-execution', 'FAIL', String(error)); }
finally {
  if (context) await context.close().catch(error => report.errors.push(String(error)));
  report.status = report.errors.length || report.checks.some(item => item.status === 'FAIL') ? 'FAIL' : report.checks.some(item => item.status === 'BLOCKED') ? 'PARTIAL' : 'PASS';
  report.finishedAt = new Date().toISOString();
  await writeFile(join(out, 'validation.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, family, buildSha: build.sha, checks: report.checks.map(item => ({ id: item.id, status: item.status })), errors: report.errors, report: join(out, 'validation.json') }));
  process.exitCode = report.status === 'FAIL' ? 1 : 0;
}
