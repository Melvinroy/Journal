import { spawnSync, spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getPreviewIdentity, PREVIEW_IDENTITY_MANIFEST } from './preview-identity.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const service = path.join(root, 'services', 'eod');
const executable = process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python';
const python = [path.join(service, '.venv', executable), path.join(root, '.venv', executable)].find(existsSync);
if (!python) {
  console.error('Set up services/eod/.venv first; see services/eod/README.md.');
  process.exit(1);
}
const build = spawnSync(process.execPath, [path.join(root, 'scripts/build.mjs')], {
  cwd: root, stdio: 'inherit', env: { ...process.env, BRONTIDE_LOCAL_BUILD: '1' },
});
if (build.status !== 0) process.exit(build.status ?? 1);
writeFileSync(path.join(root, 'out/brontide-local.json'), JSON.stringify({ mode: 'local' }));
const identity = getPreviewIdentity(root);
writeFileSync(path.join(root, 'out', PREVIEW_IDENTITY_MANIFEST), JSON.stringify({ identifier: identity.identifier }));
console.log(`[preview] checkout ${identity.checkout}`);
console.log(`[preview] branch ${identity.branch} · revision ${identity.identifier}`);
console.log('Open Brontide at http://127.0.0.1:8765/?demo=1; standalone chart: /charts/ (or your configured API port).');
const child = spawn(python, ['-m', 'brontide_eod.cli', 'serve'], { cwd: service, stdio: 'inherit' });
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
