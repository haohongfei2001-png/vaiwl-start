import { readdir } from 'node:fs/promises';
// Same process is intentional: all browser/IDB ports are injected per test.
// This also runs in restricted environments which prohibit test-runner forks.
const files = (await readdir(new URL('../tests/unit/', import.meta.url))).filter(name => name.endsWith('.test.ts')).sort();
if (!files.length) throw new Error('No test files found');
for (const name of files) await import(new URL('../tests/unit/' + name, import.meta.url).href);
