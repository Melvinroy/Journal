import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getPreviewIdentity } from './preview-identity.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
// Next export can retain unrecognized files. Never carry a local marker into Pages.
rmSync(path.join(root, 'out'), { recursive: true, force: true });
const previewIdentity = process.env.BRONTIDE_LOCAL_BUILD === '1' ? getPreviewIdentity(root).identifier : '';
const result = spawnSync(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'build'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, NEXT_PUBLIC_BRONTIDE_PREVIEW_ID: previewIdentity },
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
