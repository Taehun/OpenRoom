/**
 * Script-side environment loading: the real environment first, then the
 * repository's git-ignored `.env.local` for anything still missing.
 *
 * Values are never printed. Only key names ever reach a log line, so a token
 * cannot end up in a terminal transcript, a CI log, or this repository.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolved on demand rather than at import time: the pure helpers below are
 * unit-tested through a module runner where `import.meta.url` is not a `file:`
 * URL, and only the scripts — always run by `tsx` — need a real path.
 *
 * `<repo>/examples/shopify-furniture-store/src/env.ts` → `<repo>`.
 */
export function repoRoot(): string {
  return fileURLToPath(new URL("../../../", import.meta.url));
}

export function exampleDir(): string {
  return fileURLToPath(new URL("../", import.meta.url));
}

export function envLocalPath(): string {
  return join(repoRoot(), ".env.local");
}

export type EnvRecord = Readonly<Record<string, string | undefined>>;

/**
 * A deliberately small `.env` parser: `KEY=value` lines, `#` comments, blank
 * lines, optional `export ` prefix, and one layer of matching quotes. No
 * interpolation, no multi-line values — anything fancier belongs in a real
 * dotenv library, which this kit does not need.
 */
export function parseEnvFile(body: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separator = withoutExport.indexOf("=");
    if (separator <= 0) continue;
    const key = withoutExport.slice(0, separator).trim();
    let value = withoutExport.slice(separator + 1).trim();
    if (value.length >= 2 && (value.startsWith('"') || value.startsWith("'"))) {
      const quote = value[0];
      if (value.endsWith(quote)) value = value.slice(1, -1);
    }
    if (key !== "") values[key] = value;
  }
  return values;
}

export function readEnvLocal(path: string = envLocalPath()): Record<string, string> {
  try {
    return parseEnvFile(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

/** The process environment wins; `.env.local` only fills gaps. */
export function loadScriptEnv(
  processEnv: EnvRecord = process.env,
  fileEnv: Record<string, string> = readEnvLocal(),
): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = { ...fileEnv };
  for (const [key, value] of Object.entries(processEnv)) {
    if (value !== undefined && value !== "") merged[key] = value;
  }
  return merged;
}

export interface RequiredEnv {
  missing: string[];
  values: Record<string, string>;
}

/** Reports which of `keys` are absent or empty, without echoing any value. */
export function requireEnv(env: EnvRecord, keys: readonly string[]): RequiredEnv {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value === undefined || value === "") missing.push(key);
    else values[key] = value;
  }
  return { missing, values };
}
