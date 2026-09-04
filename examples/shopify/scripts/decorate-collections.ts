/**
 * `pnpm shop:collections [--dry-run]` — gives the eight category collections
 * the copy, cover image, and sort order the storefront needs.
 *
 * `pnpm shop:seed` creates the collections but leaves them bare, and the
 * homepage's category grid renders each collection's own image. Run this after
 * the seeder. Re-running is safe: collections are matched by handle and
 * updated in place, and one that does not exist is reported, not created.
 */
import process from "node:process";

import { DEMO_PRODUCTS } from "../../../src/features/demo/demo-data";
import { PHOTO_ASSETS } from "../../../src/features/photo/photo-assets";
import { DEFAULT_API_VERSION, createAdminClient } from "../src/admin-client";
import { DEFAULT_IMAGE_BASE, buildShopCatalog } from "../src/catalog";
import { decorateCollections } from "../src/collections";
import { loadScriptEnv, requireEnv } from "../src/env";

const REQUIRED = ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_ADMIN_ACCESS_TOKEN"] as const;

const dryRun = process.argv.slice(2).includes("--dry-run");
const env = loadScriptEnv();
const { missing, values } = requireEnv(env, REQUIRED);

if (missing.length > 0 && !dryRun) {
  console.error(
    `[collections] missing ${missing.join(", ")} — copy examples/shopify/.env.example into .env.local at the repo root and fill it in`,
  );
  process.exit(2);
}
if (missing.length > 0) {
  console.log(
    `[collections] dry run without ${missing.join(", ")} — planning against a placeholder store`,
  );
}

const imageBase = env.OPENROOM_IMAGE_BASE?.trim() || DEFAULT_IMAGE_BASE;
const apiVersion = env.SHOPIFY_API_VERSION?.trim() || DEFAULT_API_VERSION;
const catalog = buildShopCatalog(DEMO_PRODUCTS, PHOTO_ASSETS, imageBase);

const client = createAdminClient({
  storeDomain: values.SHOPIFY_STORE_DOMAIN ?? "your-store.myshopify.com",
  accessToken: values.SHOPIFY_ADMIN_ACCESS_TOKEN ?? "dry-run",
  apiVersion,
});

try {
  const result = await decorateCollections(client, catalog, {
    dryRun,
    log: (message) => console.log(message),
  });
  if (!dryRun) {
    const updated = result.collections.filter((entry) => entry.updated).length;
    const skipped = result.collections.length - updated;
    console.log(
      `[collections] done: ${updated} updated` +
        (skipped > 0 ? `, ${skipped} missing — run pnpm shop:seed first` : ""),
    );
  }
} catch (error) {
  console.error(`[collections] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
