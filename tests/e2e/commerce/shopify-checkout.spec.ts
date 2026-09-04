import { expect, test, type Page } from "@playwright/test";

import {
  FIXTURE_AGENT_PROFILE_URL,
  FIXTURE_VARIANT_IDS,
  PLACEHOLDER_STORE_DOMAIN,
  fixtureGid,
} from "../../helpers/commerce-fixtures";

const STORE = PLACEHOLDER_STORE_DOMAIN;
const APP_ORIGIN = "http://127.0.0.1:3001";
const ROOM_PERMALINK = `https://${STORE}/cart/${FIXTURE_VARIANT_IDS["oak-frame-table"]}:1,${FIXTURE_VARIANT_IDS["woven-jute-rug"]}:1`;
const TABLE_PERMALINK = `https://${STORE}/cart/${FIXTURE_VARIANT_IDS["oak-frame-table"]}:1`;
// app/globals.css:10 — --terracotta: #c8784e
// --md-sys-color-tertiary (#8A5A3C), the role skipped lines are painted with.
const TERTIARY = "rgb(138, 90, 60)";

interface BrowserToolResult {
  structuredContent: {
    ok: boolean;
    sceneRevision: number;
    stateVersion: number;
    data?: unknown;
    error?: { code: string };
  };
}

interface CapturedTool {
  name: string;
  execute(
    input: unknown,
    options: { signal: AbortSignal },
  ): Promise<BrowserToolResult>;
}

declare global {
  interface Window {
    __commerceTools: Record<string, CapturedTool>;
  }
}

/**
 * Stubs the store domain and records the traffic. Every journey must call this
 * before navigating: the route is what keeps a request to the store inside the
 * browser, and `foreign` deliberately whitelists that domain, so a journey that
 * only watched would let a real request reach Shopify and still see `foreign`
 * empty. Registered on the context, so popups are covered too.
 */
async function watchNetwork(page: Page) {
  const storeRequests: string[] = [];
  const foreign: string[] = [];
  const consoleErrors: string[] = [];
  await page.context().route(`https://${STORE}/**`, (route) => {
    storeRequests.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: "text/html",
      // The inline icon keeps Chromium from issuing a second /favicon.ico hit,
      // so `storeRequests` stays an exact record of what the app opened.
      body: '<title>stub</title><link rel="icon" href="data:,">',
    });
  });
  page.context().on("request", (request) => {
    const url = request.url();
    if (!url.startsWith(APP_ORIGIN) && !url.startsWith(`https://${STORE}`)) {
      foreign.push(url);
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      consoleErrors.push(`${message.type()}: ${message.text()}`);
    }
  });
  return { storeRequests, foreign, consoleErrors };
}

async function captureModelContextTools(page: Page) {
  await page.addInitScript(() => {
    window.__commerceTools = {};
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        async registerTool(tool: CapturedTool) {
          window.__commerceTools[tool.name] = tool;
        },
      },
    });
  });
}

async function callTool(
  page: Page,
  name: string,
  input: unknown,
): Promise<BrowserToolResult> {
  return page.evaluate(
    async ({ toolName, toolInput }) => {
      const tool = window.__commerceTools[toolName];
      if (!tool) throw new Error(`Missing captured tool ${toolName}`);
      return tool.execute(toolInput, { signal: new AbortController().signal });
    },
    { toolName: name, toolInput: input },
  );
}

/** Replaces the seed object of a category with a catalog product. */
async function replaceWith(page: Page, objectType: string, productId: string) {
  const scene = await callTool(page, "get_scene", {});
  const { objects } = scene.structuredContent.data as {
    objects: Array<{ id: string; type: string }>;
  };
  const target = objects.find(({ type }) => type === objectType);
  if (!target) throw new Error(`seed has no ${objectType}`);
  const replaced = await callTool(page, "replace_object", {
    objectId: target.id,
    productId,
    expectedRevision: scene.structuredContent.sceneRevision,
    expectedStateVersion: scene.structuredContent.stateVersion,
  });
  if (!replaced.structuredContent.ok) {
    throw new Error(`replace_object failed for ${productId}`);
  }
}

test("opens a Shopify cart permalink in a new tab without any request from OpenRoom", async ({
  context,
  page,
}) => {
  const { storeRequests, foreign, consoleErrors } = await watchNetwork(page);
  await captureModelContextTools(page);

  await page.goto("/demo");
  await expect
    .poll(() => page.evaluate(() => Object.keys(window.__commerceTools).length))
    .toBe(6);

  // Two mapped catalog products and one that the store has no variant for.
  await replaceWith(page, "coffee_table", "oak-frame-table");
  await replaceWith(page, "rug", "woven-jute-rug");
  await replaceWith(page, "floor_lamp", "rice-paper-floor-lamp");

  // The header cart is the room, so it opens the same draft the tool builds.
  await page.getByRole("button", { name: /^View cart/ }).click();

  const dialog = page.getByRole("dialog", { name: "Review your room" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("listitem")).toHaveCount(3);
  await expect(dialog.getByText(STORE, { exact: false })).toHaveCount(1);
  await expect(
    dialog.getByText(
      `Checkout opens on ${STORE} in a new tab. OpenRoom stores no Shopify credentials and makes no request of its own.`,
    ),
  ).toBeVisible();

  // Only the table ($169) and the rug ($349) are mapped, so the lamp ($289) is
  // shown skipped and the estimate counts the mapped lines only.
  const skipped = dialog.getByText("Not mapped to a Shopify variant");
  await expect(skipped).toHaveCount(1);
  await expect(dialog.getByText("$518 USD")).toBeVisible();
  await expect(dialog.getByText("Catalog estimate")).toBeVisible();
  await expect(
    dialog.getByText("Shopify shows the store's prices at checkout."),
  ).toBeVisible();

  // Guards the `.cartItemCopy small.cartSkipped` specificity fix (ec23001):
  // jsdom cannot observe the cascade, so the marker must be verified as
  // terracotta in a real engine, and distinct from the muted `Qty …` line.
  await expect(skipped.first()).toHaveCSS("color", TERTIARY);
  const skippedColor = await skipped
    .first()
    .evaluate((node) => getComputedStyle(node).color);
  const detailColor = await dialog
    .getByText("Qty 1")
    .first()
    .evaluate((node) => getComputedStyle(node).color);
  expect(skippedColor).toBe(TERTIARY);
  expect(skippedColor).not.toBe(detailColor);

  const [popup] = await Promise.all([
    context.waitForEvent("page"),
    dialog
      .getByRole("button", { name: "Continue to Shopify · $518" })
      .click(),
  ]);
  await popup.waitForLoadState();
  expect(popup.url()).toBe(ROOM_PERMALINK);

  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Opened Shopify checkout in a new tab (2 items)" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The permalink is the only thing that ever touched the store domain, and it
  // came from the popup Chromium opened — OpenRoom itself issued no request.
  expect(storeRequests).toEqual([ROOM_PERMALINK]);
  expect(foreign).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("returns Shopify lines and the store MCP endpoint from add_scene_to_cart", async ({
  page,
}) => {
  const { storeRequests, foreign, consoleErrors } = await watchNetwork(page);
  await captureModelContextTools(page);

  await page.goto("/demo");
  await expect
    .poll(() => page.evaluate(() => Object.keys(window.__commerceTools).length))
    .toBe(6);

  const scene = await callTool(page, "get_scene", {});
  expect(scene.structuredContent.ok).toBe(true);
  const sceneData = scene.structuredContent.data as {
    revision: number;
    objects: Array<{ id: string; type: string }>;
  };
  const table = sceneData.objects.find(({ type }) => type === "coffee_table");
  if (!table) throw new Error("seed has no coffee table");

  const replaced = await callTool(page, "replace_object", {
    objectId: table.id,
    productId: "oak-frame-table",
    expectedRevision: sceneData.revision,
    expectedStateVersion: scene.structuredContent.stateVersion,
  });
  expect(replaced.structuredContent.ok).toBe(true);

  const cart = await callTool(page, "add_scene_to_cart", {
    expectedRevision: replaced.structuredContent.sceneRevision,
    expectedStateVersion: replaced.structuredContent.stateVersion,
  });
  expect(cart.structuredContent.ok).toBe(true);
  const { draft } = cart.structuredContent.data as {
    draft: { commerce?: unknown; items: Array<Record<string, unknown>> };
  };
  // The demo catalog's id travels as `demoVariantId`, so an agent cannot mistake
  // it for something `update_cart` would accept.
  expect(draft.items).toEqual([
    expect.objectContaining({
      productId: "oak-frame-table",
      demoVariantId: "demo-variant-oak-frame-table",
    }),
  ]);
  expect(draft.items[0]).not.toHaveProperty("variantId");
  expect(draft.commerce).toEqual({
    provider: "shopify",
    storeDomain: STORE,
    mcpEndpoint: `https://${STORE}/api/ucp/mcp`,
    agentProfileUrl: FIXTURE_AGENT_PROFILE_URL,
    lines: [
      {
        productId: "oak-frame-table",
        merchandiseId: fixtureGid("oak-frame-table"),
        quantity: 1,
      },
    ],
    skipped: [],
    checkoutPermalink: TABLE_PERMALINK,
  });

  const dialog = page.getByRole("dialog", { name: "Review your room" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("listitem")).toHaveCount(1);
  await expect(dialog.getByText("Oak Frame Table")).toBeVisible();
  await expect(dialog.getByText("Not mapped to a Shopify variant")).toHaveCount(
    0,
  );
  await expect(
    dialog.getByRole("button", { name: "Continue to Shopify · $169" }),
  ).toBeEnabled();

  // Building the draft is local: nothing left the app origin, and nothing was
  // sent to the store — the permalink is data on the draft, not a request.
  expect(storeRequests).toEqual([]);
  expect(foreign).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
