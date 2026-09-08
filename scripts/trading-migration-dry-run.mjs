import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv.includes('--apply')) throw new Error('Gate 1 supports dry-run only; no user or production records are mutated.');
const inputPath = argument('--input');
const reportPath = argument('--report');
const backupPath = argument('--backup');
if (!inputPath || !reportPath || !backupPath) {
  throw new Error('Usage: node scripts/trading-migration-dry-run.mjs --input fixture.json --report report.json --backup backup.json');
}

const domainPath = resolve('lib/trading-domain.ts');
const migrationPath = resolve('lib/trading-migrations.ts');
const domainSource = await readFile(domainPath, 'utf8');
const domainJs = ts.transpileModule(domainSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const domainUrl = `data:text/javascript;base64,${Buffer.from(domainJs).toString('base64')}`;
const migrationSource = (await readFile(migrationPath, 'utf8')).replace('./trading-domain', domainUrl);
const migrationJs = ts.transpileModule(migrationSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { dryRunTradingMigration } = await import(`data:text/javascript;base64,${Buffer.from(migrationJs).toString('base64')}`);

const input = JSON.parse(await readFile(resolve(inputPath), 'utf8'));
const result = dryRunTradingMigration(input);
await mkdir(dirname(resolve(backupPath)), { recursive: true });
await mkdir(dirname(resolve(reportPath)), { recursive: true });
await writeFile(resolve(backupPath), JSON.stringify(result.backup, null, 2));
await writeFile(resolve(reportPath), JSON.stringify({ dryRun: true, counts: result.counts, migratedPlans: result.migratedPlans, issues: result.issues }, null, 2));
console.log(JSON.stringify(result.counts));
