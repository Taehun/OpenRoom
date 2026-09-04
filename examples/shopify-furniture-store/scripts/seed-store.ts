/**
 * `pnpm shop:seed [--dry-run]` — puts the OpenRoom catalog into a Shopify
 * development store: one product per catalog entry with a single default
 * variant, the deployed cutout as its image, eight smart collections, and
 * everything published to the Online Store.
 *
 * Re-running is safe: products are matched by handle and updated in place.
 * `--dry-run` prints the plan and sends nothing.
 */
import process from "node:process";

import { DEMO_PRODUCTS } from "../../../src/features/demo/demo-data";
import { PHOTO_ASSETS } from "../../../src/features/photo/photo-assets";
import { DEFAULT_API_VERSION, createAdminClient } from "../src/admin-client";
import { DEFAULT_IMAGE_BASE, buildShopCatalog } from "../src/catalog";
import { loadScriptEnv, requireEnv } from "../src/env";
import { seedStore } from "../src/seed";

const REQUIRED = ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_ADMIN_ACCESS_TOKEN"] as const;

const dryRun = process.argv.slice(2).includes("--dry-run");
const env = loadScriptEnv();
const { missing, values } = requireEnv(env, REQUIRED);

if (missing.length > 0 && !dryRun) {
  console.error(
    `[seed] missing ${missing.join(", ")} — copy examples/shopify-furniture-store/.env.example into .env.local at the repo root and fill it in`,
  );
  process.exit(2);
}
if (missing.length > 0) {
  // A dry run sends nothing, so it needs no credentials: plan against a
  // placeholder store and say so.
  console.log(`[seed] dry run without ${missing.join(", ")} — planning against a placeholder store`);
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
  const result = await seedStore(client, catalog, {
    dryRun,
    log: (message) => console.log(message),
  });
  if (!dryRun) {
    const created = result.products.filter((product) => product.created).length;
    const unmapped = result.products.filter((product) => product.variantId === null).length;
    console.log(
      `[seed] done: ${result.products.length} products (${created} created), ` +
        `${result.collections.length} collections, ${unmapped} without a variant`,
    );
    console.log("[seed] next: pnpm shop:variants --write");
  }
} catch (error) {
  console.error(`[seed] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
