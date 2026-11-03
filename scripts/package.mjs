import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const build = JSON.parse(await readFile('dist/build.json', 'utf8'));
const currentSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const currentDirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { encoding: 'utf8' }).trim().length > 0;
if (build.sha !== currentSha || build.dirty !== currentDirty) throw new Error('Stale build fingerprint; rebuild the current worktree before packaging.');
if (build.dirty && !process.argv.includes('--allow-dirty')) throw new Error('Refusing a delivery package from a dirty worktree; commit and rebuild first.');
for (const name of ['settings-consumer-validation', 'edge-settings-consumer-validation', 'unit-validation', 'privacy-audit', 'browser-validation', 'import-recovery-validation', 'privacy-boundaries-validation', 'source-recovery-validation', 'project-observation-validation', 'native-project-grouping-validation', 'home-workspace-validation', 'edge-home-workspace-validation', 'project-startup-validation', 'automatic-history-validation', 'automatic-history-baseline-validation', 'storage-faults-validation', 'ui-validation', 'native-experience-validation', 'native-upgrade-validation', 'edge-native-validation', 'life-bookmarks-validation', 'edge-life-bookmarks-validation', 'review-validation', 'performance-validation', 'acceptance-matrix']) {
  let report; try { report = JSON.parse(await readFile('artifacts/' + name + '.json', 'utf8')); } catch { continue; }
  if (report.buildSha !== build.sha || report.dirty !== build.dirty) continue;
  if (report.status === 'FAIL' || [...(report.checks || []), ...(report.records || [])].some(check => check?.status === 'FAIL')) throw new Error('Refusing a package with failed same-build evidence: ' + name);
}
await mkdir('artifacts', { recursive: true });
const name = `vaiwl-start-free-v1-${build.sha.slice(0, 12)}.zip`;
const script = `import pathlib,zipfile,sys\nroot=pathlib.Path('.')\nwith zipfile.ZipFile(root/'artifacts'/sys.argv[1],'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:\n for p in sorted((root/'dist').rglob('*')):\n  if p.is_file(): z.write(p,'vaiwl-start/'+str(p.relative_to(root/'dist')))\n for name in ['INSTALL.zh-CN.md','CHROME_LOCAL_RC.zh-CN.md','P1_AUTOMATIC_HISTORY.md','TEST_RECORDS.md','M0_SOURCE_GATE.md','free-v1/10-LOCAL-FIRST-AMENDMENT.md','free-v1/11-NATIVE-EXPERIENCE-AMENDMENT.md','free-v1/12-LIFE-BOOKMARKS-AMENDMENT.md','free-v1/13-NATIVE-PROJECT-LOCAL-AMENDMENT.md','free-v1/14-HOME-TIME-PROJECTION-AMENDMENT.md','evidence/home-workspace-20261103/PLATFORM.md']:\n  z.write(root/'docs'/name,name)\n for name in ['unit-validation.json','privacy-audit.json','browser-validation.json','import-recovery-validation.json','privacy-boundaries-validation.json','source-recovery-validation.json','project-observation-validation.json','native-project-grouping-validation.json','home-workspace-validation.json','edge-home-workspace-validation.json','project-startup-validation.json','automatic-history-validation.json','automatic-history-baseline-validation.json','storage-faults-validation.json','ui-validation.json','native-experience-validation.json','native-upgrade-validation.json','edge-native-validation.json','life-bookmarks-validation.json','edge-life-bookmarks-validation.json','review-validation.json','performance-validation.json','acceptance-matrix.json']:\n  p=root/'artifacts'/name\n  if p.exists():\n   import json\n   r=json.loads(p.read_text())\n   if r.get('buildSha')==sys.argv[2] and not r.get('dirty',False): z.write(p,'verification/'+name)\n`;
execFileSync(process.env.CODEX_PRIMARY_RUNTIME_PYTHON || 'python3', ['-c', script, name, build.sha]);
const bytes = await readFile('artifacts/' + name);
const receipt = { name, buildSha: build.sha, dirty: build.dirty, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), sourceGate: build.sourceGate };
await writeFile('artifacts/package.json', JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt));
