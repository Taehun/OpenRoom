import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  UCP_AGENT_PROFILE_PATH,
  parseCommerceConfig,
  resolveCommerceConfig,
} from "../../src/features/commerce/commerce-config";

describe("parseCommerceConfig", () => {
  it("is unconfigured when no store domain is named", () => {
    expect(parseCommerceConfig({})).toEqual({
      status: "unconfigured",
      reason: "not-configured",
    });
    expect(
      parseCommerceConfig({
        NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: "   ",
      }),
    ).toEqual({ status: "unconfigured", reason: "not-configured" });
  });

  it.each([
    "store my shop.com",
    "-bad.myshopify.com",
    "localhost",
    "store..myshopify.com",
  ])("rejects the malformed domain %s", (domain) => {
    expect(
      parseCommerceConfig({
        NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: domain,
      }),
    ).toEqual({ status: "unconfigured", reason: "invalid-domain" });
  });

  it("connects a store, normalizes it, and derives the MCP endpoint", () => {
    expect(
      parseCommerceConfig({
        NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: " Example-Store.myshopify.com ",
      }),
    ).toEqual({
      status: "connected",
      storeDomain: "example-store.myshopify.com",
      mcpEndpoint: "https://example-store.myshopify.com/api/ucp/mcp",
      agentProfileUrl: null,
    });
    expect(
      parseCommerceConfig({
        NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: "shop.example.com",
      }),
    ).toMatchObject({ status: "connected", storeDomain: "shop.example.com" });
  });

  it("derives the agent profile URL from a site origin", () => {
    expect(
      parseCommerceConfig({
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

describe("resolveCommerceConfig", () => {
  const ENV = {
    NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: "build-default.myshopify.com",
    NEXT_PUBLIC_SITE_ORIGIN: "https://openroom.example",
  };

  it("uses the build default when nothing is stored", () => {
    expect(resolveCommerceConfig(ENV, null)).toMatchObject({
      status: "connected",
      storeDomain: "build-default.myshopify.com",
    });
  });

  it("prefers the stored domain over the build default", () => {
    expect(resolveCommerceConfig(ENV, "chosen.myshopify.com")).toMatchObject({
      status: "connected",
      storeDomain: "chosen.myshopify.com",
      mcpEndpoint: "https://chosen.myshopify.com/api/ucp/mcp",
    });
  });

  it("normalizes a stored value that was written with a scheme", () => {
    expect(resolveCommerceConfig(ENV, "https://Chosen.myshopify.com/")).toMatchObject({
      storeDomain: "chosen.myshopify.com",
    });
  });

  // One bad paste must not leave the app unusable on that browser.
  it("falls back to the build default when the stored value is unusable", () => {
    expect(resolveCommerceConfig(ENV, "not a domain")).toMatchObject({
      status: "connected",
      storeDomain: "build-default.myshopify.com",
    });
  });

  it("is unconfigured when neither the store nor a stored value is present", () => {
    expect(resolveCommerceConfig({}, null)).toEqual({
      status: "unconfigured",
      reason: "not-configured",
    });
  });

  it("is connected on a stored domain even with no build default", () => {
    expect(resolveCommerceConfig({}, "chosen.myshopify.com")).toMatchObject({
      status: "connected",
      storeDomain: "chosen.myshopify.com",
      agentProfileUrl: null,
    });
  });
});
