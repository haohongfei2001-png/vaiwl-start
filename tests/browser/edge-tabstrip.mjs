// Dedicated native Edge favicon gate. Requires a logged-in macOS GUI session.
// No existing profile, extension installation or browser cache is read/modified.
import { chromium } from 'playwright';
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir, release } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.cwd(), dist = resolve('dist');
const runId = new Date().toISOString().replaceAll(':', '-');
const out = resolve('artifacts', 'edge-tabstrip', runId);
await mkdir(out, { recursive: true });
const executable = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
const digest = value => createHash('sha256').update(value).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { schema: 'vaiwl-edge-tabstrip/1', startedAt: new Date().toISOString(),
  status: 'RUNNING', environment: { platform: process.platform, arch: process.arch, os: release(), node: process.version, executable },
  source: {}, safety: { freshProfile: true, productionManifestModified: false, wholeDesktopCapture: false }, consentEvents: [], cases: [], errors: [] };
let context, worker, extensionId, profile, helper, manifestHash, baselineLogicalPixels;
const save = () => writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const fail = message => { throw Error(message); };
function command(program, args) {
  return execFileSync(program, args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 });
}
function helperJSON(...args) { return JSON.parse(command(helper, args.map(String))); }
function isolatedPid() {
  const flag = '--user-data-dir=' + profile;
  const matches = command('/bin/ps', ['-axo', 'pid=,command=']).split('\n').filter(line =>
    line.includes(executable) && !line.includes('--type=') &&
    line.trim().split(/\s+/).includes(flag));
  if (matches.length !== 1) fail('ISOLATED_PROCESS_NOT_UNIQUE');
  return Number(matches[0].trim().split(/\s+/)[0]);
}
async function launch() {
  const args = ['--no-first-run', '--no-default-browser-check', '--window-size=1100,760', '--window-position=40,40',
    '--disable-extensions-except=' + dist, '--load-extension=' + dist];
  report.environment.requestedLaunchArguments = args;
  context = await chromium.launchPersistentContext(profile, { executablePath: executable, headless: false, viewport: null, args });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 20_000 });
  extensionId = new URL(worker.url()).host;
  const userAgent = await worker.evaluate(() => navigator.userAgent);
  if (!/Edg\//.test(userAgent)) fail('BROWSER_IS_NOT_MICROSOFT_EDGE');
  report.environment.userAgent = userAgent;
  report.environment.extensionId = extensionId;
}
async function onlyPage(page) { for (const other of context.pages()) if (other !== page) await other.close(); }
async function directPage() {
  const page = await context.newPage();
  await page.goto('chrome-extension://' + extensionId + '/newtab.html');
  await page.waitForSelector('html[data-native-ready="true"]');
  await onlyPage(page); return page;
}
async function nativePage(caseId) {
  // No URL means Edge itself chooses its native new-tab entry. Do not use goto here.
  const pending = context.waitForEvent('page', { timeout: 20_000 });
  await worker.evaluate(() => chrome.tabs.create({ active: true }));
  const page = await pending;
  await page.waitForSelector('html[data-native-ready="true"]');
  await onlyPage(page);
  await delay(400);
  report.consentEvents.push({ caseId, at: new Date().toISOString(), ...helperJSON('keep', isolatedPid()) });
  return page;
}
const colors = { magenta: [237, 0, 227], cyan: [0, 204, 230] };
async function upload(page, marker) {
  await page.locator('#settings-trigger').click();
  const bytes = await page.evaluate(rgb => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const paint = canvas.getContext('2d'); paint.fillStyle = `rgb(${rgb.join(',')})`; paint.fillRect(0, 0, 128, 128);
    return canvas.toDataURL('image/png').split(',')[1];
  }, colors[marker]);
  const buffer = Buffer.from(bytes, 'base64');
  await writeFile(join(out, 'input-' + marker + '.png'), buffer);
  await page.locator('#tab-icon-upload').setInputFiles({ name: marker + '.png', mimeType: 'image/png', buffer });
  await page.waitForFunction(() => document.querySelector('#tab-favicon')?.href.startsWith('data:image/png;base64,'));
  // Explicit asynchronous polling: do not pass an async predicate to waitForFunction.
  const until = Date.now() + 10_000;
  let saved = false;
  while (Date.now() < until) {
    saved = await page.evaluate(async () => {
      const stored = (await chrome.storage.local.get('native.icon'))['native.icon'];
      return stored?.kind === 'upload' && stored.data === document.querySelector('#tab-favicon')?.href
        && document.querySelector('#tab-icon-upload').value === '';
    });
    if (saved) break;
    await delay(50);
  }
  if (!saved) fail('ICON_UI_SAVE_DID_NOT_COMPLETE');
  await page.locator('#settings-dialog [data-close]').first().click();
}
async function domObservation(page, marker) {
  const observed = await page.evaluate(async expected => {
    const link = document.querySelector('#tab-favicon');
    const stored = (await chrome.storage.local.get('native.icon'))['native.icon'];
    const image = new Image(); image.src = link.href; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, 128, 128);
    const pixel = [...ctx.getImageData(64, 64, 1, 1).data];
    return { url: location.href, title: document.title, href: link.href,
      persistedHrefMatches: stored?.kind === 'upload' && stored.data === link.href,
      decodedPixel: pixel, matchesExpectedPixel: expected.every((value, i) => Math.abs(pixel[i] - value) <= 2) && pixel[3] === 255,
      documentReady: document.documentElement.dataset.nativeReady === 'true',
      tab: await chrome.tabs.getCurrent() };
  }, colors[marker]);
  observed.hrefSha256 = digest(observed.href);
  observed.hrefKind = observed.href.startsWith('data:image/png;base64,') ? 'data-png' : 'other';
  delete observed.href;
  if (observed.tab?.favIconUrl) {
    observed.tab.favIconUrlSha256 = digest(observed.tab.favIconUrl);
    delete observed.tab.favIconUrl;
  }
  return observed;
}
async function capture(page, caseId, frame, marker) {
  const pid = isolatedPid(), window = helperJSON('window', pid);
  if (!window.onScreen) fail('OWNED_WINDOW_NOT_ON_SCREEN');
  const file = `${caseId}-${frame}.png`, screenshot = join(out, file);
  command('/usr/sbin/screencapture', ['-x', '-o', '-l', String(window.windowId), screenshot]);
  const pixels = helperJSON('pixels', screenshot, window.bounds.Width, window.bounds.Height, marker);
  return { file, sha256: digest(await readFile(screenshot)), window, pixels };
}
async function observe(caseId, route, page, marker) {
  const record = { id: caseId, route, marker, status: 'RUNNING', frames: [] };
  report.cases.push(record);
  try {
    await page.bringToFront();
    record.dom = await domObservation(page, marker);
    record.domStatus = record.dom.persistedHrefMatches && record.dom.matchesExpectedPixel && record.dom.documentReady ? 'PASS' : 'FAIL';
    const cdp = await context.newCDPSession(page);
    try { record.navigation = await cdp.send('Page.getNavigationHistory'); } finally { await cdp.detach(); }
    // Both captures must show the marker: a fleeting correct icon is insufficient.
    await delay(700); record.frames.push(await capture(page, caseId, 'early', marker));
    await delay(1100); record.frames.push(await capture(page, caseId, 'settled', marker));
    const minimum = route === 'direct' ? 80 : Math.max(80, baselineLogicalPixels * 0.75);
    record.requiredLogicalPixels = minimum;
    record.tabstripStatus = record.frames.every(frame => frame.pixels.markerLogicalPixels >= minimum) ? 'PASS' : 'FAIL';
    record.status = record.domStatus === 'PASS' && record.tabstripStatus === 'PASS' ? 'PASS' : 'FAIL';
  } catch (error) { record.status = 'ERROR'; record.error = String(error); }
  await save();
  console.log(JSON.stringify({ id: record.id, status: record.status, dom: record.domStatus, tabstrip: record.tabstripStatus,
    pixels: record.frames.map(frame => frame.pixels.markerLogicalPixels), error: record.error }));
  return record;
}
async function nativeCase(id, marker, changeIcon = false) {
  try {
    const page = await nativePage(id);
    if (changeIcon) await upload(page, marker);
    return await observe(id, 'native-default-entry', page, marker);
  } catch (error) {
    const record = { id, route: 'native-default-entry', status: 'ERROR', error: String(error) };
    report.cases.push(record); await save(); return record;
  }
}
try {
  if (process.platform !== 'darwin') fail('UNSUPPORTED_PLATFORM: native Mac Edge GUI is required');
  await access(executable);
  const build = JSON.parse(await readFile(join(dist, 'build.json'), 'utf8'));
  const sha = command('git', ['-C', root, 'rev-parse', 'HEAD']).trim();
  manifestHash = digest(await readFile(join(dist, 'manifest.json')));
  report.source = { sha, buildSha: build.sha, dirty: build.dirty, manifestSha256: manifestHash, runtimeHashes: build.files,
    testSha256: digest(await readFile(fileURLToPath(import.meta.url))),
    helperSha256: digest(await readFile(join(dirname(fileURLToPath(import.meta.url)), 'macos-tabstrip.swift'))) };
  if (build.sha !== sha) fail('BUILD_SHA_DOES_NOT_MATCH_HEAD');
  for (const [file, expected] of Object.entries(build.files)) {
    if (digest(await readFile(join(dist, file))) !== expected) fail('BUILD_HASH_MISMATCH: ' + file);
  }
  report.environment.browserVersion = command('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString',
    '/Applications/Microsoft Edge.app/Contents/Info.plist']).trim();
  profile = await mkdtemp(join(tmpdir(), 'vaiwl-edge-tabstrip-profile-'));
  report.environment.isolatedProfile = profile;
  const tooling = await mkdtemp(join(tmpdir(), 'vaiwl-edge-tabstrip-tools-'));
  helper = join(tooling, 'macos-tabstrip');
  command('/usr/bin/swiftc', [join(dirname(fileURLToPath(import.meta.url)), 'macos-tabstrip.swift'), '-o', helper]);
  await launch();
  const direct = await directPage(); await upload(direct, 'magenta');
  const control = await observe('01-direct-control', 'direct', direct, 'magenta');
  if (control.status !== 'PASS') fail('DIRECT_CONTROL_NOT_VALID: native conclusions are unavailable');
  baselineLogicalPixels = Math.min(...control.frames.map(frame => frame.pixels.markerLogicalPixels));
  await nativeCase('02-native-first', 'magenta');
  await nativeCase('03-native-icon-update', 'cyan', true);
  await nativeCase('04-native-reopened', 'cyan');
  await context.close(); context = null;
  await launch();
  await nativeCase('05-native-after-restart', 'cyan');
  const after = await directPage();
  await observe('06-direct-after-restart', 'direct', after, 'cyan');
  report.status = report.cases.some(c => c.status === 'ERROR') ? 'ERROR'
    : report.cases.some(c => c.status === 'FAIL') ? 'FAIL' : build.dirty ? 'BLOCKED_DIRTY_BUILD' : 'PASS';
} catch (error) { report.status = 'ERROR'; report.errors.push(String(error)); }
finally {
  if (context) await context.close().catch(error => { report.status = 'ERROR'; report.errors.push('CLOSE: ' + error); });
  if (manifestHash) {
    try {
      const unchanged = digest(await readFile(join(dist, 'manifest.json'))) === manifestHash;
      report.safety.productionManifestModified = !unchanged;
      if (!unchanged) { report.status = 'ERROR'; report.errors.push('PRODUCTION_MANIFEST_CHANGED'); }
    } catch (error) { report.status = 'ERROR'; report.errors.push('MANIFEST_FINAL_CHECK: ' + error); }
  }
  report.finishedAt = new Date().toISOString(); await save();
  console.log(JSON.stringify({ status: report.status, sha: report.source.sha, report: join(out, 'report.json'),
    errors: report.errors, note: 'DOM success never substitutes for native tab-strip pixels.' }));
  process.exitCode = report.status === 'PASS' ? 0 : report.status === 'FAIL' ? 1 : 2;
}
