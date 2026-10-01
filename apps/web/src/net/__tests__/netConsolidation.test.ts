/**
 * Consolidation audit test for `apps/web/src/net/`.
 *
 * Verifies that every file under `net/` is either absent or a pure re-export
 * stub pointing into `network/twoPlayer/`. No implementation logic may remain.
 *
 * This test enforces the consolidation contract so that a future refactor
 * cannot silently reintroduce dead code into the legacy `net/` namespace.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve project-relative paths from this test file.
// This file lives at: apps/web/src/net/__tests__/netConsolidation.test.ts
// So __dirname = apps/web/src/net/__tests__
// netDir = apps/web/src/net
// twoPlayerDir = apps/web/src/network/twoPlayer
const netDir = resolve(__dirname, "..");
const twoPlayerDir = resolve(__dirname, "../../network/twoPlayer");

/**
 * Strip comments (block and line) from source code,
 * leaving only executable statements.
 */
function stripComments(source: string): string {
  // Remove block comments
  const noBlock = source.replace(/\/\*[\s\S]*?\*\//g, "");
  // Remove line comments
  const noLine = noBlock.replace(/\/\/.*$/gm, "");
  return noLine;
}

/**
 * Extract the relative import/export target from a re-export statement.
 * Returns the target path string, or null if not a valid re-export.
 */
function extractReExportTarget(source: string): string | null {
  const cleaned = stripComments(source).trim();

  // Match: export { ... } from "..."
  const match = cleaned.match(/export\s*(type\s*)?{[^}]*}\s*from\s*["']([^"']+)["']/);
  if (match) {
    return match[2];
  }

  // Match: export * from "..."
  const starMatch = cleaned.match(/export\s*\*\s*(?:as\s+\w+\s*)?from\s*["']([^"']+)["']/);
  if (starMatch) {
    return starMatch[1];
  }

  return null;
}

/**
 * Check that a source string consists solely of re-export statements
 * (after stripping comments and blank lines).
 */
function isPureReExportStub(source: string): boolean {
  const cleaned = stripComments(source).trim();

  // If the file is empty after stripping comments, it's not a valid stub
  if (cleaned.length === 0) {
    return false;
  }

  // Must start with `export`
  if (!cleaned.startsWith("export")) {
    return false;
  }

  // Verify there are no `import` statements (a re-export stub should not import)
  if (/\bimport\s/.test(cleaned)) {
    return false;
  }

  // Verify there are no const/let/var/function/class declarations
  if (/\b(const|let|var|function|class)\b/.test(cleaned)) {
    return false;
  }

  // Verify the target points to the canonical location
  const target = extractReExportTarget(source);
  if (target === null) {
    return false;
  }

  const canonicalPrefixes = [
    "../network/twoPlayer/",
    "../../network/twoPlayer/",
    "@buildshift/protocol",
  ];

  return canonicalPrefixes.some((prefix) => target.startsWith(prefix));
}

function listFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }
  // readdirSync with recursive may return string | NonSharedBuffer in newer
  // Node type definitions. We only care about string entries ending in .ts
  const entries = readdirSync(directory, { recursive: true, withFileTypes: false });
  return (entries as string[])
    .filter((f) => f.endsWith(".ts"))
    .filter((f) => !f.includes("__tests__"))
    .filter((f) => !f.endsWith(".test.ts"));
}

describe("apps/web/src/net/ consolidation audit", () => {
  it("canonical network/twoPlayer/ directory exists with core modules", () => {
    expect(existsSync(twoPlayerDir)).toBe(true);

    const expectedCoreFiles = [
      "TwoPlayerClient.ts",
      "InputSender.ts",
      "LocalPlayerPrediction.ts",
      "RemotePlayerInterpolation.ts",
      "index.ts",
    ];

    for (const file of expectedCoreFiles) {
      const fullPath = join(twoPlayerDir, file);
      expect(existsSync(fullPath), `expected ${file} to exist in network/twoPlayer/`).toBe(true);
    }
  });

  it("every file under net/ is a pure re-export stub (or directory is empty/absent)", () => {
    const files = listFiles(netDir);

    for (const file of files) {
      const fullPath = join(netDir, file);
      const source = readFileSync(fullPath, "utf-8");
      const isStub = isPureReExportStub(source);

      expect(
        isStub,
        `File "net/${file}" is NOT a pure re-export stub.\n` +
          `Contents after comment stripping:\n${stripComments(source).trim()}\n` +
          `Expected only: export { ... } from "../network/twoPlayer/..." or "@buildshift/protocol"`,
      ).toBe(true);
    }
  });

  it("net/ contains no implementation logic (no classes, functions, or state)", () => {
    const files = listFiles(netDir);

    for (const file of files) {
      const fullPath = join(netDir, file);
      const source = readFileSync(fullPath, "utf-8");
      const cleaned = stripComments(source);

      // No import statements (only export-from re-exports allowed)
      expect(
        /\bimport\s+[{*/]/.test(cleaned),
        `File "net/${file}" contains import statements - not a pure re-export.`,
      ).toBe(false);

      // No executable logic
      expect(
        /\b(const|let|var|function|class)\b/.test(cleaned),
        `File "net/${file}" contains declarations - not a pure re-export.`,
      ).toBe(false);
    }
  });

  it("re-export targets in net/ resolve to existing canonical modules", () => {
    const files = listFiles(netDir);

    for (const file of files) {
      const fullPath = join(netDir, file);
      const source = readFileSync(fullPath, "utf-8");
      const target = extractReExportTarget(source);

      if (target === null) continue;

      // Resolve the target relative to the net/ directory
      let resolvedPath: string;
      if (target.startsWith(".")) {
        resolvedPath = resolve(netDir, target);
        // Append .ts if not present
        if (!resolvedPath.endsWith(".ts")) {
          resolvedPath += ".ts";
        }
      } else {
        // Package imports (e.g., @buildshift/protocol) - we just verify the
        // canonical directory exists for relative paths.
        continue;
      }

      expect(
        existsSync(resolvedPath),
        `Re-export target "${target}" in net/${file} does not resolve to an existing file.`,
      ).toBe(true);
    }
  });
});
