import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { AdminClient } from "../../examples/shopify/src/admin-client";
import {
  MAIN_MENU,
  MENU_PLANS,
  buildMenuInput,
  collectMenuTargets,
  syncMenus,
} from "../../examples/shopify/src/navigation";
import {
  PAGES_DIR,
  buildPageInput,
  loadPagePlans,
  parsePageSource,
  syncPages,
} from "../../examples/shopify/src/pages";

const PAGES = loadPagePlans();
const IDS = {
  collections: Object.fromEntries(
    collectMenuTargets(MENU_PLANS).collections.map((handle) => [
      handle,
      `gid://shopify/Collection/${handle}`,
    ]),
  ),
  pages: Object.fromEntries(
    collectMenuTargets(MENU_PLANS).pages.map((handle) => [handle, `gid://shopify/Page/${handle}`]),
  ),
};

describe("parsePageSource", () => {
  it("takes the title from the leading heading and the body from the rest", () => {
    const plan = parsePageSource("# Shipping\n\n<p>Free over $200.</p>\n", "shipping");

    expect(plan).toEqual({
      handle: "shipping",
      title: "Shipping",
      bodyHtml: "<p>Free over $200.</p>",
    });
  });

  it("rejects a file with no heading rather than inventing a title", () => {
    expect(() => parsePageSource("<p>orphan</p>", "x")).toThrow(/heading/i);
  });

  it("rejects a file with a heading but no body", () => {
    expect(() => parsePageSource("# Empty\n\n", "empty")).toThrow(/body/i);
  });
});

describe("loadPagePlans", () => {
  it("loads one plan per page file, skipping the folder's README", () => {
    const files = readdirSync(PAGES_DIR).filter(
      (name) => name.endsWith(".md") && name !== "README.md",
    );

    expect(PAGES).toHaveLength(files.length);
    expect(PAGES.map((page) => page.handle).sort()).toEqual(
      files.map((name) => name.replace(/\.md$/, "")).sort(),
    );
  });

  it("covers the pages the footer menu links to", () => {
    const linked = collectMenuTargets(MENU_PLANS).pages;
    const loaded = PAGES.map((page) => page.handle);
    // `contact` is Shopify's built-in page and is not written here.
    for (const handle of linked.filter((h) => h !== "contact")) {
      expect(loaded).toContain(handle);
    }
  });

  it("gives every page HTML, not markdown prose", () => {
    for (const page of PAGES) {
      expect(page.bodyHtml, page.handle).toMatch(/^<p>/);
      expect(page.bodyHtml, page.handle).not.toMatch(/^[*-] /m);
    }
  });

  it("says the store is a demonstration wherever it quotes money terms", () => {
    for (const page of PAGES.filter((p) => ["shipping", "returns"].includes(p.handle))) {
      expect(page.bodyHtml, page.handle).toMatch(/demonstration store/i);
    }
  });
});

describe("buildPageInput", () => {
  it("publishes the page and carries handle, title, and body", () => {
    const [page] = PAGES;
    expect(buildPageInput(page)).toEqual({
      handle: page.handle,
      title: page.title,
      body: page.bodyHtml,
      isPublished: true,
    });
  });
});

describe("menu plans", () => {
  it("links only to collections the seeder created and pages this kit writes", () => {
    const targets = collectMenuTargets(MENU_PLANS);
    for (const handle of targets.collections) {
      expect(handle).toMatch(/^(sofa|chair|coffee-table|side-table|bookshelf|floor-lamp|rug|plant)$/);
    }
  });

  it("gives every parent item its own destination, so no top level is a dead end", () => {
    for (const item of MAIN_MENU.items) {
      expect(item.target, item.title).toBeDefined();
    }
  });

  it("nests at most one level, which is all the header renders", () => {
    for (const plan of MENU_PLANS) {
      for (const item of plan.items) {
        for (const child of item.items ?? []) {
          expect(child.items ?? []).toHaveLength(0);
        }
      }
    }
  });
});

describe("buildMenuInput", () => {
  it("resolves a collection link to a COLLECTION item with its resource id", () => {
    const input = buildMenuInput(MAIN_MENU, IDS);
    const seating = input.items.find((item) => item.title === "Seating");

    expect(seating?.items?.[0]).toMatchObject({
      title: "Sofas",
      type: "COLLECTION",
      resourceId: "gid://shopify/Collection/sofa",
    });
  });

  it("uses CATALOG for shop-all rather than a hand-written URL", () => {
    const input = buildMenuInput(MAIN_MENU, IDS);
    expect(input.items[0]).toMatchObject({ title: "Shop all", type: "CATALOG" });
  });

  it("carries the menu's handle and title", () => {
    const input = buildMenuInput(MAIN_MENU, IDS);
    expect(input.handle).toBe("main-menu");
    expect(input.title).toBe(MAIN_MENU.title);
  });

  it("fails loudly when a linked resource was never created", () => {
    expect(() => buildMenuInput(MAIN_MENU, { collections: {}, pages: {} })).toThrow(
      /sofa|not in the store/i,
    );
  });
});

interface FakeCall {
  document: string;
  variables: Record<string, unknown>;
}

function fakeClient(options: { existingMenus?: string[]; existingPages?: string[] } = {}): {
  client: AdminClient;
  calls: FakeCall[];
} {
  const menus = new Set(options.existingMenus ?? []);
  const pages = new Set(options.existingPages ?? []);
  const calls: FakeCall[] = [];
  const client: AdminClient = {
    endpoint: "https://fake-store.myshopify.com/admin/api/2026-01/graphql.json",
    async query<T>(document: string, variables: Record<string, unknown> = {}): Promise<T> {
      calls.push({ document, variables });
      // Both lookups filter with a search string, e.g. `handle:about`.
      const queried = String(variables.handle ?? "").replace(/^handle:/, "");
      if (document.includes("query PageByHandle")) {
        const handle = queried;
        return {
          pages: { nodes: pages.has(handle) ? [{ id: `gid://shopify/Page/${handle}`, handle }] : [] },
        } as T;
      }
      if (document.includes("mutation PageCreate")) {
        const input = variables.page as { handle: string };
        return {
          pageCreate: { page: { id: `gid://shopify/Page/${input.handle}` }, userErrors: [] },
        } as T;
      }
      if (document.includes("mutation PageUpdate")) {
        return { pageUpdate: { page: { id: String(variables.id) }, userErrors: [] } } as T;
      }
      if (document.includes("query Menus")) {
        // The real `menus` connection ignores a `handle:` filter and answers
        // with every menu, main-menu first. Reproduce that exactly.
        const all = ["main-menu", "footer", "customer-account-main-menu"].filter((h) =>
          menus.has(h),
        );
        return {
          menus: { nodes: all.map((handle) => ({ id: `gid://shopify/Menu/${handle}`, handle })) },
        } as T;
      }
      if (document.includes("mutation MenuCreate")) {
        return { menuCreate: { menu: { id: "gid://shopify/Menu/new" }, userErrors: [] } } as T;
      }
      if (document.includes("mutation MenuUpdate")) {
        return { menuUpdate: { menu: { id: String(variables.id) }, userErrors: [] } } as T;
      }
      throw new Error(`unexpected document: ${document.slice(0, 40)}`);
    },
  };
  return { client, calls };
}

describe("syncPages", () => {
  it("sends nothing on a dry run", async () => {
    const { client, calls } = fakeClient();
    const result = await syncPages(client, PAGES, { dryRun: true });

    expect(calls).toHaveLength(0);
    expect(result.pages).toHaveLength(PAGES.length);
  });

  it("creates a page that does not exist and updates one that does", async () => {
    const { client, calls } = fakeClient({ existingPages: ["about"] });
    const result = await syncPages(client, PAGES);

    expect(result.pages.find((p) => p.handle === "about")?.created).toBe(false);
    expect(result.pages.find((p) => p.handle === "shipping")?.created).toBe(true);
    expect(calls.some((c) => c.document.includes("mutation PageUpdate"))).toBe(true);
    expect(calls.some((c) => c.document.includes("mutation PageCreate"))).toBe(true);
  });

  it("returns an id for every page, so the menus can link them", async () => {
    const { client } = fakeClient();
    const result = await syncPages(client, PAGES);

    for (const page of result.pages) {
      expect(page.pageId, page.handle).toMatch(/^gid:\/\/shopify\/Page\//);
    }
  });
});

describe("syncMenus", () => {
  it("sends nothing on a dry run", async () => {
    const { client, calls } = fakeClient();
    await syncMenus(client, MENU_PLANS, IDS, { dryRun: true });

    expect(calls).toHaveLength(0);
  });

  it("updates the stock menus in place rather than creating duplicates", async () => {
    const { client, calls } = fakeClient({ existingMenus: ["main-menu", "footer"] });
    const result = await syncMenus(client, MENU_PLANS, IDS);

    expect(result.menus.every((menu) => !menu.created)).toBe(true);
    expect(calls.some((c) => c.document.includes("mutation MenuCreate"))).toBe(false);
  });

  it("creates a menu whose handle is absent", async () => {
    const { client, calls } = fakeClient({ existingMenus: ["main-menu"] });
    const result = await syncMenus(client, MENU_PLANS, IDS);

    expect(result.menus.find((m) => m.handle === "footer")?.created).toBe(true);
    expect(calls.some((c) => c.document.includes("mutation MenuCreate"))).toBe(true);
  });

  it("matches the handle exactly instead of trusting the query filter", async () => {
    // Regression: `menus(query: "handle:footer")` returns main-menu first, so
    // taking node[0] rewrote the wrong menu and Shopify answered
    // "Handle can't be changed in a default list".
    const { client, calls } = fakeClient({ existingMenus: ["main-menu", "footer"] });
    await syncMenus(client, MENU_PLANS, IDS);

    const updates = calls.filter((c) => c.document.includes("mutation MenuUpdate"));
    expect(updates.map((c) => [c.variables.handle, c.variables.id])).toEqual([
      ["main-menu", "gid://shopify/Menu/main-menu"],
      ["footer", "gid://shopify/Menu/footer"],
    ]);
  });

  it("reads the menu list once, not once per menu", async () => {
    const { client, calls } = fakeClient({ existingMenus: ["main-menu", "footer"] });
    await syncMenus(client, MENU_PLANS, IDS);

    expect(calls.filter((c) => c.document.includes("query Menus"))).toHaveLength(1);
  });

  it("fails loudly on a userErrors response", async () => {
    const client: AdminClient = {
      endpoint: "https://fake-store.myshopify.com/admin/api/2026-01/graphql.json",
      async query<T>(document: string): Promise<T> {
        if (document.includes("query Menus")) {
          return { menus: { nodes: [{ id: "gid://shopify/Menu/1", handle: "main-menu" }] } } as T;
        }
        return {
          menuUpdate: {
            menu: null,
            userErrors: [{ field: ["items"], message: "Resource is not published" }],
          },
        } as T;
      },
    };

    await expect(syncMenus(client, MENU_PLANS, IDS)).rejects.toThrow(/Resource is not published/);
  });
});

describe("content/menus.md", () => {
  it("documents the same handles the code sends", () => {
    const doc = readFileSync(join(PAGES_DIR, "..", "menus.md"), "utf8");
    for (const handle of collectMenuTargets(MENU_PLANS).collections) {
      expect(doc, handle).toContain(`/collections/${handle}`);
    }
  });
});
