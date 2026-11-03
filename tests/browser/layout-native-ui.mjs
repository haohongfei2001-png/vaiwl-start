/** Actual Linux browser chrome, captured from an isolated X display.
 * Run: xvfb-run -a -s '-screen 0 2048x1152x24' node tests/browser/layout-native-ui.mjs
 * Requires xdotool and ImageMagick import. Never reads an existing Profile.
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
    'https://developer.chrome.com/docs/extensions/reference/api/tabs#method-create',
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
    return { documentUrl: location.href, tabId: tab.id, nativeTabUrl: tab.url ?? null, nativeTabUrlReadable: typeof tab.url === 'string', title: document.title, zoom, zoomError,
      cssViewport: { width: innerWidth, height: innerHeight, clientWidth: document.documentElement.clientWidth }, outerWindow: { width: outerWidth, height: outerHeight }, devicePixelRatio,
      documentWidth: document.documentElement.scrollWidth,
      main: rect('.workspace'), topbar: rect('.topbar'), rail: rect('#history-rail'),
      projectColumns: getComputedStyle(document.querySelector('.project-grid')).gridTemplateColumns.split(' ').map(parseFloat),
      dateColumns: getComputedStyle(document.querySelector('.date-grid')).gridTemplateColumns.split(' ').map(parseFloat),
    };
  });
}
function pixelProof(file, pixelSize) {
  const stats = crop => {
    const output = command('convert', [file, ...(crop ? ['-crop', crop, '+repage'] : []), '-format', '%k %[fx:standard_deviation]', 'info:']).trim().split(/\s+/);
    const deviation = Number(output[1]);
    return { colors: Number(output[0]), standardDeviation: Number.isFinite(deviation) ? deviation : null };
  };
  const whole = stats(), header = stats(`${pixelSize.width}x${Math.min(140, pixelSize.height)}+0+0`);
  const bodyTop = Math.min(180, Math.floor(pixelSize.height / 3));
  const body = stats(`${pixelSize.width}x${pixelSize.height - bodyTop}+0+${bodyTop}`);
  // A mapped window can report correct DOM geometry before X11 has painted it.
  // Require visible variation in both the browser frame and page content.
  return { whole, header, body, rendered: whole.colors > 100 && header.colors > 24 && body.colors > 100
    && (header.standardDeviation ?? 0) > .005 && (body.standardDeviation ?? 0) > .005 };
}
async function capture(id, claim) {
  await page.bringToFront(); await pause(200);
  const attempts = [];
  let measured, pixels, pixelSize, renderedFile;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) {
      // Request a genuine native repaint at the same final window dimensions.
      // No DOM/CSS change and no compositing of browser decorations.
      const geometry = Object.fromEntries(command('xdotool', ['getwindowgeometry', '--shell', windowId]).trim().split('\n').map(line => line.split('=')));
      const width = Number(geometry.WIDTH), height = Number(geometry.HEIGHT);
      command('xdotool', ['windowsize', '--sync', windowId, String(width - 1), String(height)]);
      command('xdotool', ['windowsize', '--sync', windowId, String(width), String(height)]);
      await ready(page); await pause(500);
    }
    measured = await observation();
    const file = `${id}-attempt-${attempt}.png`, path = join(out, file);
    command('import', ['-window', windowId, path]);
    pixels = await readFile(path);
    if (!pixels.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('NATIVE_SCREENSHOT_IS_NOT_PNG');
    pixelSize = { width: pixels.readUInt32BE(16), height: pixels.readUInt32BE(20) };
    const proof = pixelProof(path, pixelSize);
    attempts.push({ attempt, file, sha256: digest(pixels), pixelSize, proof });
    if (proof.rendered) { renderedFile = path; break; }
  }
  if (!renderedFile) {
    check(`${id}-pixels`, 'FAIL', { reason: 'Owned browser window stayed blank/incompletely painted after three bounded captures.', attempts });
    throw Error('NATIVE_WINDOW_NOT_PAINTED: ' + id);
  }
  const file = `${id}.png`;
  await copyFile(renderedFile, join(out, file));
  const frame = { id, claim, file, sha256: digest(pixels), pixelSize, x11Geometry: command('xdotool', ['getwindowgeometry', '--shell', windowId]).trim(), attempts, measured };
  report.frames.push(frame);
  check(`${id}-pixels`, 'PASS', { attempts: attempts.length, proof: attempts.at(-1).proof, file });
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
  report.nativeEntry = await worker.evaluate(async () => {
    // The public tabs.create contract defaults an omitted URL to the New Tab Page.
    // Record the actual creation and match its identity without requesting tabs.
    const properties = { active: true };
    const created = await chrome.tabs.create(properties);
    return { method: 'chrome.tabs.create', properties, urlOmitted: !Object.hasOwn(properties, 'url'), createdTabId: created.id, createdWindowId: created.windowId, returnedUrl: created.url ?? null };
  });
  page = await next; await ready(page);
  for (const other of context.pages()) if (other !== page) await other.close();
  windowId = await findOwnedWindow();
  command('xdotool', ['windowmove', windowId, '0', '0']);
  command('xdotool', ['windowsize', '--sync', windowId, '2048', '1152']);
  await page.bringToFront(); key('Escape'); key('ctrl+0');
  command('xdotool', ['mousemove', '--window', windowId, '1948', '1052']);
  await pause(500);
  const initial = await capture('01-native-initial', 'Real installed extension opened through native new-tab entry; entire owned browser window.');
  const nativeEntryMatches = report.nativeEntry.urlOmitted && Number.isInteger(report.nativeEntry.createdTabId)
    && initial.tabId === report.nativeEntry.createdTabId
    && initial.documentUrl === `chrome-extension://${extensionId}/newtab.html`;
  check('native-new-tab-entry', nativeEntryMatches ? 'PASS' : 'FAIL', {
    ...report.nativeEntry, observedTabId: initial.tabId, documentUrl: initial.documentUrl,
    nativeTabUrl: initial.nativeTabUrl, nativeTabUrlReadable: initial.nativeTabUrlReadable,
    evidence: 'Browser default new-tab creation without URL; the resulting tab identity matches the installed override document. No page.goto after default creation.',
    source: 'https://developer.chrome.com/docs/extensions/reference/api/tabs#method-create',
  });
  if (!initial.nativeTabUrlReadable) report.limitations.push('tabs.Tab.url is not exposed by the production permission set. The native entry is verified through URL-omitted tabs.create plus exact returned/current tab-ID equality, not by inventing an internal URL.');
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
  // One real narrow-window case. Edge remains in its verified native vertical mode.
  key('ctrl+0');
  command('xdotool', ['windowsize', '--sync', windowId, '1024', '768']);
  await ready(page); await pause(500);
  await capture('native-narrow-1024', 'Actual 1024×768 owned browser window at 100% zoom; Edge retains its native vertical tab strip.');
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
