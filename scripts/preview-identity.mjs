import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";

export const PREVIEW_IDENTITY_MANIFEST = "brontide-preview-identity.json";

const excludedSegments = new Set([
  "node_modules", ".next", "out", "output", "coverage", "test-results",
  "playwright-report", "artifacts", ".cache", "__pycache__", ".pytest_cache", "tmp", "temp",
]);

export function isPreviewIdentitySource(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (segments.some(segment => excludedSegments.has(segment.toLowerCase()))) return false;
  if (normalized.toLowerCase() === "next-env.d.ts") return false;
  if (segments.at(-1)?.toLowerCase() === PREVIEW_IDENTITY_MANIFEST) return false;
  return !/\.(?:log|tmp|temp|pyc|pyo|tsbuildinfo)$/i.test(normalized);
}

function gitBuffer(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "buffer", windowsHide: true });
}

function gitText(root, args) {
  return gitBuffer(root, args).toString("utf8").trim();
}

function nulPaths(root, args) {
  return gitBuffer(root, args).toString("utf8").split("\0").filter(Boolean).map(value => value.replaceAll("\\", "/"));
}

function canonicalSourceBytes(value) {
  if (value.includes(0)) return value;
  return Buffer.from(value.toString("utf8").replaceAll("\r\n", "\n"));
}

export function getPreviewIdentity(root = process.cwd()) {
  const checkout = gitText(root, ["rev-parse", "--show-toplevel"]);
  const head = gitText(checkout, ["rev-parse", "--short=8", "HEAD"]);
  const branch = gitText(checkout, ["branch", "--show-current"]) || "detached";
  const changed = nulPaths(checkout, ["diff", "--name-only", "-z", "HEAD", "--"]);
  const untracked = nulPaths(checkout, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const files = [...new Set([...changed, ...untracked])].filter(isPreviewIdentitySource).sort();
  const hash = createHash("sha256");

  for (const relativePath of files) {
    const absolutePath = path.join(checkout, relativePath);
    hash.update(relativePath);
    hash.update("\0");
    if (!existsSync(absolutePath)) hash.update("<deleted>");
    else {
      const stat = lstatSync(absolutePath);
      const value = stat.isSymbolicLink() ? Buffer.from(readlinkSync(absolutePath)) : readFileSync(absolutePath);
      hash.update(canonicalSourceBytes(value));
    }
    hash.update("\0");
  }

  const fullDigest = hash.digest("hex");
  const digest = fullDigest.slice(0, 8);
  return {
    branch,
    checkout,
    digest,
    fullDigest,
    head,
    identifier: files.length ? `${head}+d.${digest}` : head,
    sourceFileCount: files.length,
  };
}
