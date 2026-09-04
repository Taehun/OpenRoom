/**
 * The header and footer menus.
 *
 * Shopify ships a new store with `main-menu` (Home / Catalog / Contact) and
 * `footer` (Search). Neither says anything about furniture, and the theme's
 * header renders whatever `main-menu` holds — so until these are rewritten the
 * storefront reads as an unfinished template.
 *
 * Items are typed rather than hand-written URLs: a `COLLECTION` item carries
 * the collection's resource id, so a renamed collection keeps working and a
 * link to something the store does not carry fails here instead of 404ing for
 * a shopper. The ids come from the seeder and from `syncPages`.
 *
 * The planning half is pure; only `syncMenus` talks to the Admin API.
 */
import type { AdminClient } from "./admin-client";
import type { UserError } from "./seed";

export type MenuTarget =
  | { kind: "collection"; handle: string }
  | { kind: "page"; handle: string }
  | { kind: "catalog" }
  | { kind: "frontpage" }
  | { kind: "search" };

export interface MenuItemPlan {
  title: string;
  target: MenuTarget;
  items?: MenuItemPlan[];
}

export interface MenuPlan {
  handle: string;
  title: string;
  items: MenuItemPlan[];
}

const collection = (handle: string): MenuTarget => ({ kind: "collection", handle });
const page = (handle: string): MenuTarget => ({ kind: "page", handle });

/**
 * Grouped the way a furniture shop groups things, not the way the catalog
 * stores `productType`. Every parent carries its own destination, so a
 * top-level item is never a dead end on a device with no hover.
 */
export const MAIN_MENU: MenuPlan = {
  handle: "main-menu",
  title: "Main menu",
  items: [
    { title: "Shop all", target: { kind: "catalog" } },
    {
      title: "Seating",
      target: collection("sofa"),
      items: [
        { title: "Sofas", target: collection("sofa") },
        { title: "Chairs", target: collection("chair") },
      ],
    },
    {
      title: "Tables",
      target: collection("coffee-table"),
      items: [
        { title: "Coffee tables", target: collection("coffee-table") },
        { title: "Side tables", target: collection("side-table") },
      ],
    },
    { title: "Storage", target: collection("bookshelf") },
    { title: "Lighting", target: collection("floor-lamp") },
    {
      title: "Decor",
      target: collection("rug"),
      items: [
        { title: "Rugs", target: collection("rug") },
        { title: "Plants", target: collection("plant") },
      ],
    },
    { title: "About", target: page("about") },
  ],
};

export const FOOTER_MENU: MenuPlan = {
  handle: "footer",
  title: "Footer menu",
  items: [
    { title: "About", target: page("about") },
    { title: "Shipping", target: page("shipping") },
    { title: "Returns", target: page("returns") },
    { title: "Privacy", target: page("privacy") },
    { title: "Contact", target: page("contact") },
    { title: "Search", target: { kind: "search" } },
  ],
};

export const MENU_PLANS: readonly MenuPlan[] = [MAIN_MENU, FOOTER_MENU];

export interface ResourceIds {
  collections: Readonly<Record<string, string>>;
  pages: Readonly<Record<string, string>>;
}

export interface MenuItemInput {
  title: string;
  type: "COLLECTION" | "PAGE" | "CATALOG" | "FRONTPAGE" | "SEARCH";
  resourceId?: string;
  items?: MenuItemInput[];
}

export interface MenuInput {
  handle: string;
  title: string;
  items: MenuItemInput[];
}

export const MENU_BY_HANDLE_QUERY = `query MenuByHandle($handle: String!) {
  menus(first: 1, query: $handle) { nodes { id handle } }
}`;

export const MENU_CREATE_MUTATION = `mutation MenuCreate($title: String!, $handle: String!, $items: [MenuItemCreateInput!]!) {
  menuCreate(title: $title, handle: $handle, items: $items) {
    menu { id }
    userErrors { field message }
  }
}`;

export const MENU_UPDATE_MUTATION = `mutation MenuUpdate($id: ID!, $title: String!, $handle: String!, $items: [MenuItemUpdateInput!]!) {
  menuUpdate(id: $id, title: $title, handle: $handle, items: $items) {
    menu { id }
    userErrors { field message }
  }
}`;

/** Every collection and page handle the menus link to, deduplicated. */
export function collectMenuTargets(plans: readonly MenuPlan[]): {
  collections: string[];
  pages: string[];
} {
  const collections = new Set<string>();
  const pages = new Set<string>();
  const walk = (items: readonly MenuItemPlan[]): void => {
    for (const item of items) {
      if (item.target.kind === "collection") collections.add(item.target.handle);
      if (item.target.kind === "page") pages.add(item.target.handle);
      walk(item.items ?? []);
    }
  };
  for (const plan of plans) walk(plan.items);
  return { collections: [...collections], pages: [...pages] };
}

function buildItem(item: MenuItemPlan, ids: ResourceIds): MenuItemInput {
  const children = (item.items ?? []).map((child) => buildItem(child, ids));
  const nested = children.length > 0 ? { items: children } : {};

  switch (item.target.kind) {
    case "catalog":
      return { title: item.title, type: "CATALOG", ...nested };
    case "frontpage":
      return { title: item.title, type: "FRONTPAGE", ...nested };
    case "search":
      return { title: item.title, type: "SEARCH", ...nested };
    case "collection": {
      const resourceId = ids.collections[item.target.handle];
      if (resourceId === undefined) {
        throw new Error(
          `collection ${item.target.handle} is not in the store — run pnpm shop:seed first`,
        );
      }
      return { title: item.title, type: "COLLECTION", resourceId, ...nested };
    }
    case "page": {
      const resourceId = ids.pages[item.target.handle];
      if (resourceId === undefined) {
        throw new Error(`page ${item.target.handle} is not in the store — it must be created first`);
      }
      return { title: item.title, type: "PAGE", resourceId, ...nested };
    }
  }
}

export function buildMenuInput(plan: MenuPlan, ids: ResourceIds): MenuInput {
  return {
    handle: plan.handle,
    title: plan.title,
    items: plan.items.map((item) => buildItem(item, ids)),
  };
}

export interface SyncMenusOptions {
  dryRun?: boolean;
  log?: (message: string) => void;
}

export interface SyncedMenu {
  handle: string;
  menuId: string | null;
  created: boolean;
}

export interface SyncMenusResult {
  menus: SyncedMenu[];
}

function failOnUserErrors(label: string, errors: readonly UserError[] | undefined): void {
  const messages = (errors ?? []).map((error) => error.message);
  if (messages.length > 0) {
    throw new Error(`${label}: ${messages.join("; ")}`);
  }
}

/**
 * Rewrites each menu in place when its handle already exists — `main-menu` and
 * `footer` always do on a new store — and creates it otherwise. Updating
 * rather than creating matters: the theme's header and footer are bound to
 * those handles, and a second menu named `main-menu-1` would render nowhere.
 */
export async function syncMenus(
  client: AdminClient,
  plans: readonly MenuPlan[],
  ids: ResourceIds,
  options: SyncMenusOptions = {},
): Promise<SyncMenusResult> {
  const log = options.log ?? (() => {});
  const inputs = plans.map((plan) => buildMenuInput(plan, ids));

  if (options.dryRun === true) {
    log(`[menus] dry run — no request is sent to ${client.endpoint}`);
    for (const input of inputs) {
      const titles = input.items
        .map((item) => item.title + (item.items ? ` (${item.items.length})` : ""))
        .join(", ");
      log(`[menus] ${input.handle} would hold: ${titles}`);
    }
    log(`[menus] dry run complete: ${inputs.length} menus, 0 requests`);
    return { menus: inputs.map((input) => ({ handle: input.handle, menuId: null, created: false })) };
  }

  const menus: SyncedMenu[] = [];
  for (const input of inputs) {
    const found = await client.query<{ menus: { nodes: { id: string }[] } }>(MENU_BY_HANDLE_QUERY, {
      handle: `handle:${input.handle}`,
    });
    const existingId = found.menus.nodes[0]?.id ?? null;

    if (existingId === null) {
      const result = await client.query<{
        menuCreate: { menu: { id: string } | null; userErrors: UserError[] };
      }>(MENU_CREATE_MUTATION, { ...input });
      failOnUserErrors(`menuCreate ${input.handle}`, result.menuCreate.userErrors);
      menus.push({ handle: input.handle, menuId: result.menuCreate.menu?.id ?? null, created: true });
      log(`[menus] ${input.handle} created with ${input.items.length} items`);
      continue;
    }

    const result = await client.query<{
      menuUpdate: { menu: { id: string } | null; userErrors: UserError[] };
    }>(MENU_UPDATE_MUTATION, { id: existingId, ...input });
    failOnUserErrors(`menuUpdate ${input.handle}`, result.menuUpdate.userErrors);
    menus.push({ handle: input.handle, menuId: existingId, created: false });
    log(`[menus] ${input.handle} rewritten with ${input.items.length} items`);
  }

  return { menus };
}
