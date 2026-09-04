/**
 * `pnpm shop:content [--dry-run]` — writes the storefront's pages and menus.
 *
 * Pages come first: the menus link to them by resource id, so they have to
 * exist before `main-menu` and `footer` can be rewritten. Collection ids come
 * from the collections `pnpm shop:seed` created.
 *
 * Needs two scopes beyond the seeder's — `write_online_store_pages` and
 * `write_online_store_navigation`. Without them the Admin API answers 403 and
 * the content has to be entered by hand from `examples/shopify/content/`.
 */
import process from "node:process";

import { DEFAULT_API_VERSION, createAdminClient } from "../src/admin-client";
import { COLLECTION_BY_HANDLE_QUERY } from "../src/seed";
import { loadScriptEnv, requireEnv } from "../src/env";
import { MENU_PLANS, collectMenuTargets, syncMenus } from "../src/navigation";
import { loadPagePlans, syncPages } from "../src/pages";

const REQUIRED = ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_ADMIN_ACCESS_TOKEN"] as const;

const dryRun = process.argv.slice(2).includes("--dry-run");
const env = loadScriptEnv();
const { missing, values } = requireEnv(env, REQUIRED);

if (missing.length > 0 && !dryRun) {
  console.error(
    `[content] missing ${missing.join(", ")} — copy examples/shopify/.env.example into .env.local at the repo root and fill it in`,
  );
  process.exit(2);
}
if (missing.length > 0) {
  console.log(`[content] dry run without ${missing.join(", ")} — planning against a placeholder store`);
}

const client = createAdminClient({
  storeDomain: values.SHOPIFY_STORE_DOMAIN ?? "your-store.myshopify.com",
  accessToken: values.SHOPIFY_ADMIN_ACCESS_TOKEN ?? "dry-run",
  apiVersion: env.SHOPIFY_API_VERSION?.trim() || DEFAULT_API_VERSION,
});

const log = (message: string): void => console.log(message);
const pagePlans = loadPagePlans();

try {
  const pageResult = await syncPages(client, pagePlans, { dryRun, log });

  const targets = collectMenuTargets(MENU_PLANS);
  const pages: Record<string, string> = {};
  const collections: Record<string, string> = {};

  if (dryRun) {
    // Nothing was created, so stand in placeholder ids: the point of the run
    // is to show the menu shape, not to prove the ids resolve.
    for (const handle of targets.pages) pages[handle] = `gid://shopify/Page/dry-run-${handle}`;
    for (const handle of targets.collections) {
      collections[handle] = `gid://shopify/Collection/dry-run-${handle}`;
    }
  } else {
    for (const page of pageResult.pages) {
      if (page.pageId !== null) pages[page.handle] = page.pageId;
    }
    // `contact` is Shopify's built-in page: it is linked but never written here.
    for (const handle of targets.pages) {
      if (pages[handle] !== undefined) continue;
      const found = await client.query<{ pages: { nodes: { id: string }[] } }>(
        `query PageByHandle($handle: String!) { pages(first: 1, query: $handle) { nodes { id handle } } }`,
        { handle: `handle:${handle}` },
      );
      const id = found.pages.nodes[0]?.id;
      if (id === undefined) {
        throw new Error(`page ${handle} is not in the store — create it, or drop it from the menus`);
      }
      pages[handle] = id;
    }
    for (const handle of targets.collections) {
      const found = await client.query<{ collectionByHandle: { id: string } | null }>(
        COLLECTION_BY_HANDLE_QUERY,
        { handle },
      );
      const id = found.collectionByHandle?.id;
      if (id === undefined) {
        throw new Error(`collection ${handle} is not in the store — run pnpm shop:seed first`);
      }
      collections[handle] = id;
    }
  }

  const menuResult = await syncMenus(client, MENU_PLANS, { collections, pages }, { dryRun, log });

  if (!dryRun) {
    const created = pageResult.pages.filter((page) => page.created).length;
    console.log(
      `[content] done: ${pageResult.pages.length} pages (${created} created), ` +
        `${menuResult.menus.length} menus rewritten`,
    );
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[content] ${message}`);
  if (/403|access denied|scope/i.test(message)) {
    console.error(
      "[content] the app needs write_online_store_pages and write_online_store_navigation — " +
        "add them in the Dev Dashboard, release the version, reinstall, and mint a fresh token",
    );
  }
  process.exit(1);
}
