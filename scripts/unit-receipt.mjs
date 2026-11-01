import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const run = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/test.mjs'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const output = (run.stdout || '') + (run.stderr || '');
process.stdout.write(output);
const match = output.match(/(?:ℹ |# )tests (\d+)/);
const tests = match ? Number(match[1]) : 0;
const checks = [...output.matchAll(/^[✔✓] (.+) \([\d.]+ms\)$/gm)].map(match => ({ id: match[1], status: 'PASS' }));
const status = run.status === 0 && tests > 0 && checks.length === tests && !run.error ? 'PASS' : 'FAIL';
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/unit-tests.txt', output);
await writeFile('artifacts/unit-validation.json', JSON.stringify({ status, tests, checks, buildSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirty: execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { encoding: 'utf8' }).trim().length > 0,
  environment: `Node ${process.version}; injected browser ports, fake-indexeddb, controlled jsdom geometry`, steps: 'All tests/unit/*.test.ts through scripts/test.mjs', limitations: ['No live ChatGPT source or real Mac/Edge assertion.'] }, null, 2));
if (status !== 'PASS') process.exitCode = run.status || 1;
