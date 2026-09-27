import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "app", "standalone", "page.tsx");
const cloudOnly = new Set([
  path.join(root, "app", "CloudAccess.tsx"),
  path.join(root, "app", "CloudHome.tsx"),
  path.join(root, "app", "CatalystDashboard.tsx"),
  path.join(root, "app", "ScannerDashboard.tsx"),
  path.join(root, "app", "ResearchWorkspace.tsx"),
  path.join(root, "app", "ChartDashboard.tsx"),
  path.join(root, "lib", "cloud-trade-gateway.ts"),
  path.join(root, "lib", "supabase.ts"),
]);

function resolveSource(importer, specifier) {
  const base = path.resolve(path.dirname(importer), specifier);
  return [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]
    .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

function runtimeSpecifier(statement) {
  if (ts.isImportDeclaration(statement)) {
    const clause = statement.importClause;
    if (clause?.isTypeOnly) return null;
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
      && !clause.name && clause.namedBindings.elements.every(element => element.isTypeOnly)) return null;
  } else if (ts.isExportDeclaration(statement)) {
    if (statement.isTypeOnly) return null;
  } else return null;
  return statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
    ? statement.moduleSpecifier.text : null;
}

function dynamicSpecifiers(source) {
  const specifiers = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      assert.equal(node.arguments.length, 1, "Standalone dynamic import must have one literal argument");
      assert.ok(ts.isStringLiteral(node.arguments[0]), "Standalone dynamic import must be literal");
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return specifiers;
}

function assertStandaloneBoundary(entryFile, {
  readSource = file => fs.readFileSync(file, "utf8"),
  resolve = resolveSource,
} = {}) {
  const seen = new Set();
  const queue = [{ file: entryFile, chain: [path.relative(root, entryFile)] }];
  while (queue.length) {
    const { file, chain } = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    assert.ok(!cloudOnly.has(file), `Cloud-only module reached: ${chain.join(" -> ")}`);
    const source = ts.createSourceFile(file, readSource(file), ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      const specifier = runtimeSpecifier(statement);
      if (!specifier) continue;
      assert.notEqual(specifier, "@supabase/supabase-js", `Runtime SDK import: ${chain.join(" -> ")}`);
      if (!specifier.startsWith(".")) continue;
      const next = resolve(file, specifier);
      if (next) queue.push({ file: next, chain: [...chain, path.relative(root, next)] });
    }
    for (const specifier of dynamicSpecifiers(source)) {
      assert.notEqual(specifier, "@supabase/supabase-js", `Dynamic cloud SDK import: ${chain.join(" -> ")}`);
      if (!specifier.startsWith(".")) continue;
      const next = resolve(file, specifier);
      assert.ok(!next || !cloudOnly.has(next), `Dynamic cloud-only module reached: ${[...chain, path.relative(root, next)].join(" -> ")}`);
      if (next) queue.push({ file: next, chain: [...chain, path.relative(root, next)] });
    }
  }
  return seen;
}

test("standalone entry has no runtime import path to cloud auth or trade modules", () => {
  assert.ok(assertStandaloneBoundary(entry).size > 5, "Standalone dependency walk did not reach the shared workspace");
});

// Virtual modules exercise the traversal without adding runtime app imports.
function dynamicFixture(bridgeSource) {
  const fixtureEntry = path.join(root, "app", "__boundary_fixture_entry.ts");
  const fixtureBridge = path.join(root, "app", "__boundary_fixture_bridge.ts");
  const sources = new Map([
    [fixtureEntry, 'export const load = () => import("./__boundary_fixture_bridge");'],
    [fixtureBridge, bridgeSource],
  ]);
  return [fixtureEntry, {
    readSource: file => {
      assert.ok(sources.has(file), `Unexpected fixture read: ${file}`);
      return sources.get(file);
    },
    resolve: (file, specifier) => {
      const candidate = path.resolve(path.dirname(file), `${specifier}.ts`);
      return sources.has(candidate) || cloudOnly.has(candidate) ? candidate : undefined;
    },
  }];
}

test("dynamic imports cannot hide an indirect cloud-only module", () => {
  const fixture = dynamicFixture('export { client } from "../lib/supabase";');
  assert.throws(() => assertStandaloneBoundary(...fixture), error => {
    assert.match(error.message, /Cloud-only module reached:/);
    assert.ok(error.message.includes("__boundary_fixture_bridge.ts"));
    assert.ok(error.message.includes("supabase.ts"));
    return true;
  });
});

test("permitted dynamic-import cycles are visited only once", () => {
  const fixture = dynamicFixture('export const reload = () => import("./__boundary_fixture_entry");');
  assert.equal(assertStandaloneBoundary(...fixture).size, 2);
});
