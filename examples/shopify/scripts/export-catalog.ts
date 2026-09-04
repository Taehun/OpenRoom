/**
 * `pnpm shop:export` — writes `products.json` and `products.csv` next to the
 * README from the live OpenRoom catalog. Both files are checked in; regenerate
 * them whenever `DEMO_PRODUCTS` or a cutout changes.
 *
 * No network, no credentials, no environment required: `OPENROOM_IMAGE_BASE`
 * only moves the image host off the deployed Pages build.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

import { DEMO_PRODUCTS } from "../../../src/features/demo/demo-data";
import { PHOTO_ASSETS } from "../../../src/features/photo/photo-assets";
import { DEFAULT_IMAGE_BASE, buildShopCatalog, toShopifyCsv } from "../src/catalog";
import { exampleDir, loadScriptEnv } from "../src/env";

const env = loadScriptEnv();
const imageBase = env.OPENROOM_IMAGE_BASE?.trim() || DEFAULT_IMAGE_BASE;

const catalog = buildShopCatalog(DEMO_PRODUCTS, PHOTO_ASSETS, imageBase);
const outDir = exampleDir();
const jsonPath = join(outDir, "products.json");
const csvPath = join(outDir, "products.csv");

writeFileSync(
  jsonPath,
  `${JSON.stringify({ imageBase, count: catalog.length, products: catalog }, null, 2)}\n`,
  "utf8",
);
writeFileSync(csvPath, `${toShopifyCsv(catalog)}\n`, "utf8");

console.log(`[export] ${catalog.length} products from ${imageBase}`);
console.log(`[export] wrote ${jsonPath}`);
console.log(`[export] wrote ${csvPath}`);
process.exitCode = 0;
