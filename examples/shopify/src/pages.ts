/**
 * The storefront's own pages — About, Shipping, Returns, Privacy.
 *
 * The copy lives in `examples/shopify/content/pages/*.md`: one file per page,
 * a leading `# Title` heading, then the body as HTML. Keeping it in files
 * rather than in this module means the text can be edited without touching
 * code, and pasted by hand into the admin if the app is never granted
 * `write_online_store_pages`.
 *
 * Only `syncPages` talks to the Admin API, through the client it is handed.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AdminClient } from "./admin-client";
import type { UserError } from "./seed";

export const PAGES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "content", "pages");

export interface PagePlan {
  handle: string;
  title: string;
  bodyHtml: string;
}

export interface PageInput {
  handle: string;
  title: string;
  body: string;
  isPublished: true;
}

export const PAGE_BY_HANDLE_QUERY = `query PageByHandle($handle: String!) {
  pages(first: 1, query: $handle) { nodes { id handle } }
}`;

export const PAGE_CREATE_MUTATION = `mutation PageCreate($page: PageCreateInput!) {
  pageCreate(page: $page) { page { id } userErrors { field message } }
}`;

export const PAGE_UPDATE_MUTATION = `mutation PageUpdate($id: ID!, $page: PageUpdateInput!) {
  pageUpdate(id: $id, page: $page) { page { id } userErrors { field message } }
}`;

/** `# Shipping` becomes the title; everything after it is the body. */
export function parsePageSource(source: string, handle: string): PagePlan {
  const match = /^#\s+(.+?)\s*$/m.exec(source);
  if (match === null) {
    throw new Error(`${handle}.md has no "# Title" heading`);
  }
  const bodyHtml = source.slice(match.index + match[0].length).trim();
  if (bodyHtml === "") {
    throw new Error(`${handle}.md has a heading but no body`);
  }
  return { handle, title: match[1], bodyHtml };
}

/** Every page file in `content/pages`, alphabetically. `README.md` is not one. */
export function loadPagePlans(dir: string = PAGES_DIR): PagePlan[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .sort()
    .map((name) => parsePageSource(readFileSync(join(dir, name), "utf8"), name.replace(/\.md$/, "")));
}

export function buildPageInput(plan: PagePlan): PageInput {
  return { handle: plan.handle, title: plan.title, body: plan.bodyHtml, isPublished: true };
}

export interface SyncOptions {
  dryRun?: boolean;
  log?: (message: string) => void;
}

export interface SyncedPage {
  handle: string;
  pageId: string | null;
  created: boolean;
}

export interface SyncPagesResult {
  pages: SyncedPage[];
}

function failOnUserErrors(label: string, errors: readonly UserError[] | undefined): void {
  const messages = (errors ?? []).map((error) => error.message);
  if (messages.length > 0) {
    throw new Error(`${label}: ${messages.join("; ")}`);
  }
}

/**
 * Upserts every page by handle. Re-running is safe: an existing page is
 * updated in place, so its URL — which the footer menu links to — survives.
 */
export async function syncPages(
  client: AdminClient,
  plans: readonly PagePlan[],
  options: SyncOptions = {},
): Promise<SyncPagesResult> {
  const log = options.log ?? (() => {});

  if (options.dryRun === true) {
    log(`[pages] dry run — no request is sent to ${client.endpoint}`);
    for (const plan of plans) {
      log(`[pages] ${plan.handle} would be created or updated: "${plan.title}", ${plan.bodyHtml.length} chars`);
    }
    log(`[pages] dry run complete: ${plans.length} pages, 0 requests`);
    return { pages: plans.map((plan) => ({ handle: plan.handle, pageId: null, created: false })) };
  }

  const pages: SyncedPage[] = [];
  for (const plan of plans) {
    const found = await client.query<{ pages: { nodes: { id: string }[] } }>(PAGE_BY_HANDLE_QUERY, {
      handle: `handle:${plan.handle}`,
    });
    const existingId = found.pages.nodes[0]?.id ?? null;
    const input = buildPageInput(plan);

    if (existingId === null) {
      const result = await client.query<{
        pageCreate: { page: { id: string } | null; userErrors: UserError[] };
      }>(PAGE_CREATE_MUTATION, { page: input });
      failOnUserErrors(`pageCreate ${plan.handle}`, result.pageCreate.userErrors);
      const pageId = result.pageCreate.page?.id ?? null;
      pages.push({ handle: plan.handle, pageId, created: true });
      log(`[pages] ${plan.handle} created → /pages/${plan.handle}`);
      continue;
    }

    const result = await client.query<{
      pageUpdate: { page: { id: string } | null; userErrors: UserError[] };
    }>(PAGE_UPDATE_MUTATION, { id: existingId, page: input });
    failOnUserErrors(`pageUpdate ${plan.handle}`, result.pageUpdate.userErrors);
    pages.push({ handle: plan.handle, pageId: existingId, created: false });
    log(`[pages] ${plan.handle} updated → /pages/${plan.handle}`);
  }

  return { pages };
}
