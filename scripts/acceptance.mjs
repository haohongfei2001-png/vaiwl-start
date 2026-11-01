import { readFile, writeFile } from 'node:fs/promises';
const build = JSON.parse(await readFile('dist/build.json', 'utf8'));
const specification = await readFile('docs/free-v1/06-ACCEPTANCE.md', 'utf8');
const evidence = {};
for (const name of ['unit-validation', 'privacy-audit', 'browser-validation', 'ui-validation', 'performance-validation']) {
  try {
    const result = JSON.parse(await readFile(`artifacts/${name}.json`, 'utf8'));
    if (result.buildSha === build.sha && result.dirty === build.dirty) evidence[name] = result;
  } catch { /* Missing evidence is never promoted to PASS. */ }
}
// These maps identify full claims covered at the stated test layer. Combined live
// requirements remain BLOCKED even when their unit-only parts already passed.
const automated = new Map([
  ['S10', ['privacy-audit']], ['T01', ['unit-validation']], ['T02', ['unit-validation','ui-validation']], ['T05', ['ui-validation']], ['T06', ['unit-validation']],
  ['D01', ['unit-validation','browser-validation']], ['D03', ['unit-validation']], ['D04', ['unit-validation','browser-validation']], ['D05', ['unit-validation','browser-validation']], ['D06', ['browser-validation']], ['D11', ['ui-validation']], ['D12', ['unit-validation','browser-validation', 'ui-validation']],
  ['O12', ['browser-validation']], ['O16', ['unit-validation']],
  ['U01', ['ui-validation']], ['U02', ['ui-validation']], ['U03', ['ui-validation']], ['U04', ['ui-validation']], ['U05', ['ui-validation']], ['U08', ['ui-validation']], ['U09', ['ui-validation']],
]);
const sourceDependent = new Set(['O02','O06','O07','O11','O13','O14','O15','O17','T03','D07']);
const records = [];
for (const line of specification.split('\n')) {
  const cells = line.split('|').map(s => s.trim());
  if (!/^[SOTDU]\d{2}$/.test(cells[1] || '')) continue;
  const [id, action, requirement, layer] = cells.slice(1, 5);
  const refs = automated.get(id) || [];
  const blocked = layer.includes('L') || sourceDependent.has(id) || id === 'U10';
  const pass = !blocked && refs.length > 0 && refs.every(name => evidence[name]?.status === 'PASS');
  records.push({ id, status: blocked ? 'BLOCKED' : pass ? 'PASS' : 'NOT_RUN', buildSha: build.sha,
    browserVersion: evidence['browser-validation']?.browserVersion || evidence['ui-validation']?.browserVersion || 'unit/source layer',
    environment: 'Isolated Chromium / synthetic catalog. Exact production manifest except the explicitly documented history API harness.',
    steps: action, observed: pass ? 'Covered by the linked same-build automatic evidence at the declared test layer.' : blocked ? 'Requires live source authority or actual Mac Chrome/Edge acceptance; disabled or unavailable in this run.' : 'No complete same-build evidence for every condition in this row; do not infer PASS from related tests.',
    artifactRefs: refs.map(name => `${name}.json`), requirement,
    limitations: ['PASS here applies to this row and test layer only, never overall Free V1 acceptance.', ...(id === 'O09' ? ['Address-bar adapter is disabled; optional gate not activated.'] : [])] });
}
for (let n = 1; n <= 4; n++) records.push({ id: `JOURNEY-${n}`, status: 'BLOCKED', buildSha: build.sha, browserVersion: null, environment: 'Real Mac Chrome and Edge', steps: `Frozen continuous journey ${n}`, observed: 'Live context/PROJECT/NONE/arrival sources not yet proven.', artifactRefs: ['M0_SOURCE_GATE.md'], limitations: ['Not replaced by synthetic browser tests.'] });
const result = { status: 'SOURCE_GATE_BLOCKED', buildSha: build.sha, dirty: build.dirty, records };
await writeFile('artifacts/acceptance-matrix.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify({ buildSha: build.sha, records: records.length, statuses: records.reduce((counts, row) => ({ ...counts, [row.status]: (counts[row.status] || 0) + 1 }), {}) }));
