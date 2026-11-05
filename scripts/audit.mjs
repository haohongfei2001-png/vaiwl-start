import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ['storage', 'favicon', 'search']);
assert.deepEqual(manifest.optional_permissions.sort(), ['alarms', 'bookmarks', 'history', 'scripting', 'webNavigation'].sort());
assert.deepEqual(manifest.optional_host_permissions, ['https://chatgpt.com/*']);
assert.equal(manifest.incognito, 'not_allowed');
assert.equal(manifest.externally_connectable, undefined);
assert.equal(manifest.content_scripts, undefined);
assert.equal(manifest.chrome_url_overrides.newtab, 'newtab.html');
const html = await readFile('dist/newtab.html', 'utf8');
assert.ok(!/<iframe|\son\w+\s*=|javascript:/i.test(html));
assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html));
const probeHtml = await readFile('dist/source-check.html', 'utf8');
assert.ok(!/<iframe|\son\w+\s*=|javascript:/i.test(probeHtml));
assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(probeHtml));
const bundles = ['content.js', 'newtab.js', 'service-worker.js', 'source-check.js'];
const sources = JSON.parse(await readFile('artifacts/build-meta.json', 'utf8'));
for (const name of bundles) {
  const code = await readFile('dist/' + name, 'utf8');
  assert.ok(!/readCurrentConversation|\/backend-api\/conversations?\/|document\.body\.(?:innerText|textContent)|\.outerHTML|window\.postMessage|storage\.sync|externally_connectable|eval\s*\(|new Function\s*\(/.test(code), 'forbidden behavior in ' + name);
  const inputs = Object.keys(sources[name].inputs);
  assert.ok(inputs.every(path => !/(?:node_modules|tests|fixtures|design\/|src\/pro)/.test(path)), 'production dependency graph includes unexpected source');
}
for (const name of ['tasks-main.js', 'tasks-content.js']) {
  const code = await readFile('dist/' + name, 'utf8');
  assert.ok(!/accessToken|Authorization|document\.cookie|chrome\.cookies|storage\.sync|new Function|eval\s*\(/.test(code), 'task adapter must not extract credentials: ' + name);
}
const taskMain = await readFile('dist/tasks-main.js', 'utf8');
assert.ok(taskMain.includes('automation_id') && taskMain.includes('is_complete') && taskMain.includes('final'));
assert.ok(!/fetch\s*\(/.test(taskMain), 'task main bridge only observes native requests');
const content = await readFile('dist/content.js', 'utf8');
assert.ok(content.includes('/api/auth/session') && content.includes('/backend-api/accounts/check/v4-2023-04-27'));
assert.ok(!content.includes('indexedDB') && !content.includes('chrome.history'));
const fingerprint = JSON.parse(await readFile('dist/build.json', 'utf8'));
for (const [path, hash] of Object.entries(fingerprint.files)) assert.equal(createHash('sha256').update(await readFile('dist/' + path)).digest('hex'), hash);
assert.equal(fingerprint.sourceGate, 'LOCAL_WORKSPACE_READY');
assert.equal(fingerprint.nativeAttribution, 'UNVERIFIED');
assert.ok((await readdir('dist')).every(name => !/fixture|demo|\.map$/.test(name)));
const result = { status: 'PASS', buildSha: fingerprint.sha, dirty: fingerprint.dirty, checks: ['minimal-permissions', 'strict-CSP-no-inline-script', 'legacy-metadata-remains-body-free', 'task-only-final-output-adapter-no-credential-extraction', 'no-runtime-dependencies', 'content-no-db-or-history', 'no-production-fixtures', 'package-hashes', 'local-capability-and-unverified-native-attribution-separated'] };
await writeFile('artifacts/privacy-audit.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
