import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  UCP_AGENT_PROFILE_PATH,
  parseCommerceConfig,
} from "../../src/features/commerce/commerce-config";

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

  it("matches the provider case-insensitively", () => {
    expect(
      parseCommerceConfig({
        NEXT_PUBLIC_COMMERCE_PROVIDER: "Shopify",
        NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: "store.myshopify.com",
      }),
    ).toEqual({
      provider: "shopify",
      storeDomain: "store.myshopify.com",
      mcpEndpoint: "https://store.myshopify.com/api/ucp/mcp",
      agentProfileUrl: null,
    });
    expect(parseCommerceConfig({ NEXT_PUBLIC_COMMERCE_PROVIDER: "DEMO" })).toEqual({
      provider: "demo",
      reason: "default",
    });
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
      mcpEndpoint: "https://example-store.myshopify.com/api/ucp/mcp",
      agentProfileUrl: null,
    });
    expect(
      parseCommerceConfig({
        NEXT_PUBLIC_COMMERCE_PROVIDER: "shopify",
        NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: "shop.example.com",
      }),
    ).toMatchObject({ provider: "shopify", storeDomain: "shop.example.com" });
  });

  it("derives the agent profile URL from a site origin", () => {
    expect(
      parseCommerceConfig({
        NEXT_PUBLIC_COMMERCE_PROVIDER: "shopify",
        NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: "store.myshopify.com",
        NEXT_PUBLIC_SITE_ORIGIN: " https://openroom.example/ ",
      }),
    ).toMatchObject({
      agentProfileUrl: `https://openroom.example${UCP_AGENT_PROFILE_PATH}`,
    });
  });

  // Shopify fetches this URL from its own servers on every /api/ucp/mcp call.
  // An origin it cannot reach, or one carrying anything but a bare host, would
  // produce a profile URL that fails there — better to advertise none.
  it.each([
    ["http, not https", "http://openroom.example"],
    ["a loopback host", "https://localhost:3000"],
    ["a .localhost host", "https://openroom.localhost"],
    ["a path", "https://openroom.example/app"],
    ["a query", "https://openroom.example/?v=1"],
    ["credentials", "https://user:pw@openroom.example"],
    ["not a URL at all", "openroom.example"],
    ["an empty value", "   "],
  ])("refuses a site origin with %s", (_label, origin) => {
    expect(
      parseCommerceConfig({
        NEXT_PUBLIC_COMMERCE_PROVIDER: "shopify",
        NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: "store.myshopify.com",
        NEXT_PUBLIC_SITE_ORIGIN: origin,
      }),
    ).toMatchObject({ agentProfileUrl: null });
  });

  it("ships the agent profile the URL points at", () => {
    const profile = JSON.parse(
      readFileSync(join(process.cwd(), "public", UCP_AGENT_PROFILE_PATH), "utf8"),
    ) as { ucp?: { version?: string; capabilities?: Record<string, unknown> } };
    expect(profile.ucp?.version).toBe("2026-08-25");
    // The two capabilities OpenRoom actually hands off: a cart built from the
    // draft's merchandise ids, and the checkout the buyer completes.
    expect(Object.keys(profile.ucp?.capabilities ?? {})).toEqual([
      "dev.ucp.shopping.cart",
      "dev.ucp.shopping.checkout",
    ]);
  });
});
