import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { encoding: 'utf8' }).trim().length > 0;
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
const manifest = JSON.parse(await readFile('contracts/manifest.example.json', 'utf8'));
manifest.version_name = `0.1.0-dev.${sha.slice(0, 12)}${dirty ? '.dirty' : ''}`;
await writeFile('dist/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
await cp('public', 'dist', { recursive: true });
const entries = [ ['src/background/service-worker.ts', 'service-worker.js', 'esm'], ['src/collectors/chatgpt/content-entry.ts', 'content.js', 'iife'], ['src/ui/newtab.ts', 'newtab.js', 'esm'], ['src/ui/source-check.ts', 'source-check.js', 'esm'] ];
const metadata = {};
for (const [entry, output, format] of entries) {
  const result = await build({ entryPoints: [entry], outfile: `dist/${output}`, bundle: true, format, target: 'chrome120', platform: 'browser', metafile: true, sourcemap: false, minify: false, legalComments: 'none' });
  metadata[output] = result.metafile;
}
const record = { contract: 'VAIWL-START-FREE/1.0', amendment: '2026-11-03-native-project-local', sha, dirty, version: manifest.version, sourceGate: 'LOCAL_WORKSPACE_READY', nativeAttribution: 'UNVERIFIED', nativeProjectLocalGrouping: 'IMPLEMENTED', accountWorkspaceCertification: 'UNVERIFIED', fullProjectSync: 'NOT_IMPLEMENTED', adapterVersion: 'chatgpt-native-project-local/4', files: {} };
for (const name of ['manifest.json', 'service-worker.js', 'content.js', 'newtab.js', 'newtab.html', 'newtab.css', 'bookmarks.css', 'life.css', 'source-check.js', 'source-check.html', 'source-check.css', 'tab-chrome.svg', 'tab-edge.svg', 'tab-product.svg']) record.files[name] = createHash('sha256').update(await readFile('dist/' + name)).digest('hex');
await writeFile('dist/build.json', JSON.stringify(record, null, 2) + '\n');
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/build-meta.json', JSON.stringify(metadata, null, 2));
console.log(JSON.stringify({ build: sha, dirty, sourceGate: record.sourceGate, entrypoints: entries.length }));
