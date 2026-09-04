/**
 * `pnpm shop:variants [--write]` — reads the default variant of every catalog
 * handle out of the store and prints the one line OpenRoom needs:
 *
 *   NEXT_PUBLIC_SHOPIFY_VARIANTS=ash-lounge-chair=gid://…,…
 *
 * `--write` puts that line into `.env.local` at the repository root, replacing
 * only that key and leaving every other line untouched.
 */
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

import { DEMO_PRODUCTS } from "../../../src/features/demo/demo-data";
import { DEFAULT_API_VERSION, createAdminClient } from "../src/admin-client";
import { envLocalPath, loadScriptEnv, requireEnv } from "../src/env";
import { buildVariantsEnvLine, fetchStoreVariants, upsertEnvLine } from "../src/variants";

const REQUIRED = ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_ADMIN_ACCESS_TOKEN"] as const;

const write = process.argv.slice(2).includes("--write");
const env = loadScriptEnv();
const { missing, values } = requireEnv(env, REQUIRED);

if (missing.length > 0) {
  console.error(
    `[variants] missing ${missing.join(", ")} — copy examples/shopify/.env.example into .env.local at the repo root and fill it in`,
  );
  process.exit(2);
}

const client = createAdminClient({
  storeDomain: values.SHOPIFY_STORE_DOMAIN!,
  accessToken: values.SHOPIFY_ADMIN_ACCESS_TOKEN!,
  apiVersion: env.SHOPIFY_API_VERSION?.trim() || DEFAULT_API_VERSION,
});

try {
  const entries = await fetchStoreVariants(
    client,
    DEMO_PRODUCTS.map((product) => product.id),
  );
  const unmapped = entries.filter((entry) => entry.variantId === null);
  for (const entry of unmapped) {
    console.error(`[variants] ${entry.handle} is not in the store — run pnpm shop:seed`);
  }

  const line = buildVariantsEnvLine(entries);
  if (write) {
    const target = envLocalPath();
    let body = "";
    try {
      body = readFileSync(target, "utf8");
    } catch {
      body = "";
    }
    writeFileSync(target, upsertEnvLine(body, line), "utf8");
    console.error(
      `[variants] wrote NEXT_PUBLIC_SHOPIFY_VARIANTS for ${entries.length - unmapped.length} products to ${target}`,
    );
  } else {
    console.log(line);
  }
} catch (error) {
  console.error(`[variants] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
