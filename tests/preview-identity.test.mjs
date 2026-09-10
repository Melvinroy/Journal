import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { getPreviewIdentity, PREVIEW_IDENTITY_MANIFEST } from "../scripts/preview-identity.mjs";

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
}

test("preview identity ignores generated evidence but changes for source edits", () => {
  const root = mkdtempSync(path.join(tmpdir(), "brontide-preview-id-"));
  try {
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "preview-test@example.invalid"]);
    git(root, ["config", "user.name", "Preview Test"]);
    writeFileSync(path.join(root, ".gitignore"), "node_modules/\n.next/\nout/\noutput/\ntest-results/\n*.log\n");
    writeFileSync(path.join(root, "source.ts"), "export const value = 1;\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "fixture"]);
    const clean = getPreviewIdentity(root);

    for (const directory of [".next", "out", "output", "test-results"]) {
      mkdirSync(path.join(root, directory), { recursive: true });
      writeFileSync(path.join(root, directory, directory === "out" ? PREVIEW_IDENTITY_MANIFEST : "generated.txt"), "private generated value\n");
    }
    writeFileSync(path.join(root, "verification.log"), "private log value\n");
    assert.equal(getPreviewIdentity(root).identifier, clean.identifier);

    writeFileSync(path.join(root, "source.ts"), "export const value = 2;\r\n");
    const tracked = getPreviewIdentity(root);
    assert.notEqual(tracked.identifier, clean.identifier);
    assert.match(tracked.identifier, /^[0-9a-f]{8}\+d\.[0-9a-f]{8}$/);

    writeFileSync(path.join(root, "new-source.ts"), "export const added = true;\n");
    assert.notEqual(getPreviewIdentity(root).identifier, tracked.identifier);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
