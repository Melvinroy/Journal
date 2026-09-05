import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
// Next export can retain unrecognized files. Never carry a local marker into Pages.
rmSync(path.join(root, 'out'), { recursive: true, force: true });
const result = spawnSync(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'build'], {
  cwd: root, stdio: 'inherit', env: process.env,
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
