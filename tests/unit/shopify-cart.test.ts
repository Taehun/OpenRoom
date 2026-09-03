import { describe, expect, it } from "vitest";

import {
  buildCartPermalink,
  buildCommerceDraft,
  enrichCartDraft,
  resolveShopifyLines,
} from "../../src/features/commerce/shopify-cart";
import type { CartApprovalDraft } from "../../src/webmcp/tool-context";
import {
  DEMO_COMMERCE,
  FIXTURE_VARIANTS,
  PLACEHOLDER_STORE_DOMAIN,
  SHOPIFY_COMMERCE,
} from "../helpers/commerce-fixtures";

const DRAFT: CartApprovalDraft = {
  id: "scene-demo-rev-3",
  sceneId: "demo",
  sceneRevision: 3,
  items: [
    {
      objectId: "table_01",
      productId: "oak-frame-table",
      variantId: "demo-variant-oak-frame-table",
      title: "Oak Frame Table",
      quantity: 1,
      price: { amountMinor: 16900, currency: "USD" },
    },
    {
      objectId: "rug_01",
      productId: "woven-jute-rug",
      variantId: "demo-variant-woven-jute-rug",
      title: "Woven Jute Rug",
      quantity: 1,
      price: { amountMinor: 32900, currency: "USD" },
    },
    {
      objectId: "lamp_01",
      productId: "rice-paper-floor-lamp",
      variantId: "demo-variant-rice-paper-floor-lamp",
      title: "Rice Paper Floor Lamp",
      quantity: 1,
      price: { amountMinor: 14900, currency: "USD" },
    },
  ],
  totalMinor: 64700,
};

describe("resolveShopifyLines", () => {
  it("maps products to merchandise ids, aggregates quantities, and lists skipped products once", () => {
    const result = resolveShopifyLines(
      [
        { productId: "coffee-table", quantity: 1 },
        { productId: "floor-lamp", quantity: 1 },
        { productId: "coffee-table", quantity: 2 },
        { productId: "unknown-product", quantity: 1 },
        { productId: "floor-lamp", quantity: 1 },
      ],
      FIXTURE_VARIANTS,
    );
    expect(result.lines).toEqual([
      {
        productId: "coffee-table",
        merchandiseId: "gid://shopify/ProductVariant/1001",
        variantId: "1001",
        quantity: 3,
      },
    ]);
    expect(result.skipped).toEqual([
      { productId: "floor-lamp", reason: "unmapped" },
      { productId: "unknown-product", reason: "unmapped" },
    ]);
  });

  it("skips products whose mapping is invalid or duplicated", () => {
    const result = resolveShopifyLines(
      [
        { productId: "a", quantity: 1 },
        { productId: "b", quantity: 1 },
        { productId: "c", quantity: 1 },
      ],
      { a: "gid://shopify/ProductVariant/7", b: "gid://shopify/ProductVariant/7", c: "bad" },
    );
    expect(result.lines.map(({ productId }) => productId)).toEqual(["a"]);
    expect(result.skipped).toEqual([
      { productId: "b", reason: "invalid" },
      { productId: "c", reason: "invalid" },
    ]);
  });

  it("ignores non-positive or fractional quantities", () => {
    const result = resolveShopifyLines(
      [
        { productId: "coffee-table", quantity: 0 },
        { productId: "rug", quantity: 1.5 },
      ],
      FIXTURE_VARIANTS,
    );
    expect(result.lines).toEqual([]);
    expect(result.skipped).toEqual([]);
  });
});

describe("buildCartPermalink", () => {
  it("joins variant ids and quantities in order", () => {
    expect(
      buildCartPermalink(PLACEHOLDER_STORE_DOMAIN, [
        { productId: "a", merchandiseId: "gid://shopify/ProductVariant/1001", variantId: "1001", quantity: 2 },
        { productId: "b", merchandiseId: "gid://shopify/ProductVariant/1002", variantId: "1002", quantity: 1 },
      ]),
    ).toBe(`https://${PLACEHOLDER_STORE_DOMAIN}/cart/1001:2,1002:1`);
  });

  it("returns null without lines", () => {
    expect(buildCartPermalink(PLACEHOLDER_STORE_DOMAIN, [])).toBeNull();
  });
});

describe("buildCommerceDraft", () => {
  it("returns null in demo mode", () => {
    expect(buildCommerceDraft(DEMO_COMMERCE, [{ productId: "coffee-table", quantity: 1 }])).toBeNull();
  });

  it("builds public lines, skipped products, endpoint, and permalink in shopify mode", () => {
    expect(
      buildCommerceDraft(SHOPIFY_COMMERCE, [
        { productId: "coffee-table", quantity: 1 },
        { productId: "plant", quantity: 1 },
      ]),
    ).toEqual({
      provider: "shopify",
      storeDomain: PLACEHOLDER_STORE_DOMAIN,
      mcpEndpoint: `https://${PLACEHOLDER_STORE_DOMAIN}/api/mcp`,
      lines: [
        { productId: "coffee-table", merchandiseId: "gid://shopify/ProductVariant/1001", quantity: 1 },
      ],
      skipped: [{ productId: "plant", reason: "unmapped" }],
      checkoutPermalink: `https://${PLACEHOLDER_STORE_DOMAIN}/cart/1001:1`,
    });
  });

  it("yields no permalink when nothing is mapped", () => {
    expect(buildCommerceDraft(SHOPIFY_COMMERCE, [{ productId: "plant", quantity: 1 }])).toMatchObject({
      lines: [],
      checkoutPermalink: null,
    });
  });
});

describe("enrichCartDraft", () => {
  it("returns the same draft object in demo mode", () => {
    expect(enrichCartDraft(DEMO_COMMERCE, DRAFT)).toBe(DRAFT);
    expect("commerce" in DRAFT).toBe(false);
  });

  it("adds a commerce block without mutating the input in shopify mode", () => {
    const enriched = enrichCartDraft(SHOPIFY_COMMERCE, DRAFT);
    expect(enriched).not.toBe(DRAFT);
    expect(DRAFT.commerce).toBeUndefined();
    expect(enriched.items).toBe(DRAFT.items);
    expect(enriched.commerce).toEqual({
      provider: "shopify",
      storeDomain: PLACEHOLDER_STORE_DOMAIN,
      mcpEndpoint: `https://${PLACEHOLDER_STORE_DOMAIN}/api/mcp`,
      lines: [
        { productId: "oak-frame-table", merchandiseId: "gid://shopify/ProductVariant/1003", quantity: 1 },
        { productId: "woven-jute-rug", merchandiseId: "gid://shopify/ProductVariant/1004", quantity: 1 },
      ],
      skipped: [{ productId: "rice-paper-floor-lamp", reason: "unmapped" }],
      checkoutPermalink: `https://${PLACEHOLDER_STORE_DOMAIN}/cart/1003:1,1004:1`,
    });
  });
});
