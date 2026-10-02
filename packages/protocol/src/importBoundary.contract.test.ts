/**
 * Import-boundary contract test (Stage: net/ consolidation).
 *
 * The legacy, competing client networking stack lived under
 * `apps/web/src/net/`. It has been consolidated into the canonical
 * `apps/web/src/network/twoPlayer/` layer. Per the architecture
 * (dependency flows `apps` -> `packages`, never the reverse), and per the
 * net-removal mission, **no production source file** in the monorepo may
 * import from `apps/web/src/net/`.
 *
 * This test is a durable, automated guard for that boundary. It scans every
 * `.ts` / `.tsx` file under the package `src/` trees and the app `src/` trees,
 * extracts every static / side-effect / dynamic `import` and `require`
 * specifier, resolves relative specifiers against the importing file, and
 * asserts that none of them resolve into `apps/web/src/net/`.
 *
 * It is intentionally robust to the directory's eventual deletion: once
 * `apps/web/src/net/` is removed there are simply no files for an import to
 * point at, so the guard keeps passing. While the (empty) stub files still
 * exist, the guard proves nothing in the production import graph depends on
 * them.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Absolute path of this test file's directory (`packages/protocol/src`). */
const here = dirname(fileURLToPath(import.meta.url));

/** The directory that must never appear on the "imported-from" side. */
const FORBIDDEN_DIR = join("apps", "web", "src", "net");

/**
 * Source roots to audit. This is the full production import graph:
 * every shared package plus both applications.
 */
const SCAN_DIRS = [
  join("packages", "protocol", "src"),
  join("packages", "simulation", "src"),
  join("packages", "game-config", "src"),
  join("apps", "web", "src"),
  join("apps", "game-server", "src"),
] as const;

/**
 * Walk up from `start` until a directory that contains both `packages/` and
 * `apps/` (the monorepo root) is found.
 */
function findMonorepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(dir, "packages")) && existsSync(join(dir, "apps"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new Error(`monorepo root not found while walking up from ${start}`);
}

/**
 * Recursively collect every `.ts` / `.tsx` file under `absDir`.
 */
function collectSourceFiles(absDir: string): string[] {
  const out: string[] = [];
  const stack: string[] = [absDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      break;
    }
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry);
      let stats;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        stack.push(full);
      } else if (
        stats.isFile() &&
        (entry.endsWith(".ts") || entry.endsWith(".tsx"))
      ) {
        out.push(full);
      }
    }
  }
  return out;
}

/**
 * Return true when `targetPath` is `dirPath` itself or nested inside it.
 */
function isUnder(targetPath: string, dirPath: string): boolean {
  const rel = relative(dirPath, targetPath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Extract every module specifier referenced by an `import` / `require` in
 * `source`. Covers:
 *  - `import ... from "spec"` / `import type ... from "spec"`
 *  - `import "spec"` (side-effect) and `import("spec")` (dynamic)
 *  - `require("spec")`
 */
function extractSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const m of source.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
    specifiers.push(m[1]);
  }
  for (const m of source.matchAll(/\bimport\s*(?:\(\s*)?["']([^"']+)["']/g)) {
    specifiers.push(m[1]);
  }
  for (const m of source.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    specifiers.push(m[1]);
  }
  return specifiers;
}

/**
 * Resolve a specifier to a filesystem path. Relative / absolute specifiers
 * are resolved against the importing file; bare specifiers (e.g. `vitest`,
 * `@buildshift/protocol`) are returned unchanged (they cannot name a
 * filesystem directory).
 */
function resolveSpecifier(spec: string, importerFile: string): string {
  if (spec.startsWith("./") || spec.startsWith("../")) {
    return resolve(dirname(importerFile), spec);
  }
  if (isAbsolute(spec)) {
    return resolve(spec);
  }
  return spec;
}

describe("import boundary: no production source imports from apps/web/src/net/", () => {
  it("has no static / side-effect / dynamic / require import resolving into apps/web/src/net", () => {
    const root = findMonorepoRoot(here);
    const forbidden = join(root, FORBIDDEN_DIR);
    const violations: { file: string; specifier: string; resolved: string }[] = [];

    for (const relDir of SCAN_DIRS) {
      const absDir = join(root, relDir);
      if (!existsSync(absDir)) {
        continue;
      }
      for (const file of collectSourceFiles(absDir)) {
        // A file that lives inside the forbidden directory cannot "pull from"
        // it in the cross-boundary sense; only the rest of the codebase matters.
        if (isUnder(file, forbidden)) {
          continue;
        }
        const source = readFileSync(file, "utf8");
        for (const spec of extractSpecifiers(source)) {
          const resolvedPath = resolveSpecifier(spec, file);
          const pullsFromNet =
            isUnder(resolvedPath, forbidden) ||
            spec.includes("apps/web/src/net");
          if (pullsFromNet) {
            violations.push({
              file: relative(root, file).split(sep).join("/"),
              specifier: spec,
              resolved: relative(root, resolvedPath).split(sep).join("/"),
            });
          }
        }
      }
    }

    // If anything still imports from the legacy net/ directory, fail loudly
    // with the exact offending import so the stray reference is trivial to fix.
    expect(violations).toEqual([]);
  });
});
