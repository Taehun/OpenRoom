import { describe, expect, it } from "vitest";

import { parseCommerceConfig } from "../../src/features/commerce/commerce-config";

describe("parseCommerceConfig", () => {
  it("defaults to demo when nothing is configured", () => {
    expect(parseCommerceConfig({})).toEqual({ provider: "demo", reason: "default" });
    expect(parseCommerceConfig({ NEXT_PUBLIC_COMMERCE_PROVIDER: "  " })).toEqual({
      provider: "demo",
      reason: "default",
    });
    expect(parseCommerceConfig({ NEXT_PUBLIC_COMMERCE_PROVIDER: "demo" })).toEqual({
      provider: "demo",
      reason: "default",
    });
  });

  it("treats an unknown provider as not configured", () => {
    expect(
      parseCommerceConfig({
        NEXT_PUBLIC_COMMERCE_PROVIDER: "woocommerce",
        NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: "store.myshopify.com",
      }),
    ).toEqual({ provider: "demo", reason: "not-configured" });
  });

  it("fails closed when shopify has no store domain", () => {
    expect(parseCommerceConfig({ NEXT_PUBLIC_COMMERCE_PROVIDER: "shopify" })).toEqual({
      provider: "demo",
      reason: "not-configured",
    });
    expect(
      parseCommerceConfig({
        NEXT_PUBLIC_COMMERCE_PROVIDER: "shopify",
        NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: "   ",
      }),
    ).toEqual({ provider: "demo", reason: "not-configured" });
  });

  it.each([
    "https://store.myshopify.com",
    "store.myshopify.com/cart",
    "store my shop.com",
    "-bad.myshopify.com",
    "localhost",
    "store.myshopify.com?x=1",
  ])("rejects the malformed domain %s", (domain) => {
    expect(
      parseCommerceConfig({
        NEXT_PUBLIC_COMMERCE_PROVIDER: "shopify",
        NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: domain,
      }),
    ).toEqual({ provider: "demo", reason: "invalid-domain" });
  });

  it("accepts a bare store host, normalizes it, and derives the MCP endpoint", () => {
    expect(
      parseCommerceConfig({
        NEXT_PUBLIC_COMMERCE_PROVIDER: " shopify ",
        NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: " Example-Store.myshopify.com ",
      }),
    ).toEqual({
      provider: "shopify",
      storeDomain: "example-store.myshopify.com",
      mcpEndpoint: "https://example-store.myshopify.com/api/mcp",
    });
    expect(
      parseCommerceConfig({
        NEXT_PUBLIC_COMMERCE_PROVIDER: "shopify",
        NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: "shop.example.com",
      }),
    ).toMatchObject({ provider: "shopify", storeDomain: "shop.example.com" });
  });
});
