/**
 * Import-boundary contract test (Stage: networking consolidation).
 *
 * The web client has been consolidated to exactly ONE canonical networking
 * path: `apps/web/src/game/network/`.
 *
 * The following legacy/competing networking directories and files have been
 * retired and must never appear on the "imported-from" side of any production
 * source file:
 *
 *   - `apps/web/src/net/`            (legacy ConnectionManager stack)
 *   - `apps/web/src/network/twoPlayer/` (legacy TwoPlayerClient stack)
 *   - `apps/web/src/game/remote/`    (legacy RemotePlayerManager)
 *
 * Additionally, the duplicate `apps/web/src/game/HealthHud.ts` (a re-export
 * shim) must not be imported directly — all HealthHud imports must resolve
 * through the canonical `apps/web/src/game/network/HealthHud` path.
 *
 * This test scans every `.ts` / `.tsx` file under the package `src/` trees
 * and the app `src/` trees, extracts every static / side-effect / dynamic
 * `import` and `require` specifier, resolves relative specifiers against the
 * importing file, and asserts that none of them resolve into any of the
 * forbidden paths above.
 *
 * It is intentionally robust to the directories' eventual physical deletion:
 * once they are removed there are simply no files for an import to point at,
 * so the guard keeps passing. While the (empty) stub files still exist, the
 * guard proves nothing in the production import graph depends on them.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Absolute path of this test file's directory (`packages/protocol/src`). */
const here = dirname(fileURLToPath(import.meta.url));

/**
 * Directories that must never appear on the "imported-from" side.
 * Each entry is a path relative to the monorepo root.
 */
const FORBIDDEN_DIRS = [
  join("apps", "web", "src", "net"),
  join("apps", "web", "src", "network", "twoPlayer"),
  join("apps", "web", "src", "game", "remote"),
] as const;

/**
 * Specific files that must not be imported directly (must go through the
 * canonical re-export path). Each entry is a path relative to the monorepo root.
 */
const FORBIDDEN_FILES = [
  join("apps", "web", "src", "game", "HealthHud"),
] as const;

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
 * Return true when `targetPath` matches `filePath` (with or without `.ts`
 * / `.tsx` extension).
 */
function matchesFile(targetPath: string, filePath: string): boolean {
  const normalized = targetPath.replace(/[\\/]+$/, "");
  return (
    normalized === filePath ||
    normalized === `${filePath}.ts` ||
    normalized === `${filePath}.tsx`
  );
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

/**
 * Check a single resolved import path against all forbidden dirs and files.
 * Returns the violation description or null if the path is allowed.
 */
function checkPath(
  resolvedPath: string,
  spec: string,
  root: string,
): string | null {
  // Check forbidden directories.
  for (const forbiddenRel of FORBIDDEN_DIRS) {
    const forbiddenAbs = join(root, forbiddenRel);
    if (isUnder(resolvedPath, forbiddenAbs)) {
      return (
        `import "${spec}" resolves into forbidden directory ` +
        `"${forbiddenRel}"`
      );
    }
  }

  // Check forbidden specific files (e.g. the duplicate HealthHud shim).
  for (const forbiddenFileRel of FORBIDDEN_FILES) {
    const forbiddenFileAbs = join(root, forbiddenFileRel);
    if (matchesFile(resolvedPath, forbiddenFileAbs)) {
      return (
        `import "${spec}" resolves to forbidden file ` +
        `"${forbiddenFileRel}" (use the canonical path instead)`
      );
    }
  }

  return null;
}

describe("import boundary: consolidated networking path", () => {
  it(
    "no production source imports from any retired networking directory",
    () => {
      const root = findMonorepoRoot(here);
      const violations: {
        file: string;
        specifier: string;
        reason: string;
      }[] = [];

      for (const relDir of SCAN_DIRS) {
        const absDir = join(root, relDir);
        if (!existsSync(absDir)) {
          continue;
        }
        for (const file of collectSourceFiles(absDir)) {
          // Skip files that live inside any of the forbidden directories —
          // they are the retired code itself, not cross-boundary importers.
          let skip = false;
          for (const forbiddenRel of FORBIDDEN_DIRS) {
            const forbiddenAbs = join(root, forbiddenRel);
            if (isUnder(file, forbiddenAbs)) {
              skip = true;
              break;
            }
          }
          if (skip) {
            continue;
          }

          const source = readFileSync(file, "utf8");
          for (const spec of extractSpecifiers(source)) {
            const resolvedPath = resolveSpecifier(spec, file);
            const violation = checkPath(resolvedPath, spec, root);
            if (violation) {
              violations.push({
                file: relative(root, file).split(sep).join("/"),
                specifier: spec,
                reason: violation,
              });
            }
          }
        }
      }

      if (violations.length > 0) {
        const detail = violations
          .map(
            (v) =>
              `  ${v.file}\n    import "${v.specifier}" → ${v.reason}`,
          )
          .join("\n");
        expect.soft(
          violations,
          `Found ${violations.length} import(s) from retired networking paths:\n${detail}`,
        ).toEqual([]);
      }
      expect(violations).toEqual([]);
    },
  );

  it(
    "no production source imports the duplicate HealthHud shim directly",
    () => {
      const root = findMonorepoRoot(here);
      const forbiddenFileAbs = join(
        root,
        ...FORBIDDEN_FILES[0].split(sep),
      );
      const violations: { file: string; specifier: string }[] = [];

      for (const relDir of SCAN_DIRS) {
        const absDir = join(root, relDir);
        if (!existsSync(absDir)) {
          continue;
        }
        for (const file of collectSourceFiles(absDir)) {
          // Skip the shim file itself (it re-exports from the canonical path).
          if (file === forbiddenFileAbs || file === `${forbiddenFileAbs}.ts`) {
            continue;
          }

          const source = readFileSync(file, "utf8");
          for (const spec of extractSpecifiers(source)) {
            const resolvedPath = resolveSpecifier(spec, file);
            if (matchesFile(resolvedPath, forbiddenFileAbs)) {
              violations.push({
                file: relative(root, file).split(sep).join("/"),
                specifier: spec,
              });
            }
          }
        }
      }

      if (violations.length > 0) {
        const detail = violations
          .map(
            (v) =>
              `  ${v.file}\n    import "${v.specifier}" → use "./network/HealthHud" instead`,
          )
          .join("\n");
        expect.soft(
          violations,
          `Found ${violations.length} direct import(s) of the duplicate HealthHud shim:\n${detail}`,
        ).toEqual([]);
      }
      expect(violations).toEqual([]);
    },
  );
});
