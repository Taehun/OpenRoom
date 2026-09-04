import { describe, expect, it } from "vitest";

import {
  domainRejectionMessage,
  normalizeStoreDomain,
  parseStoreDomain,
} from "../../src/features/commerce/store-domain";

describe("normalizeStoreDomain", () => {
  it.each([
    ["  openroom-x.myshopify.com  ", "openroom-x.myshopify.com"],
    ["https://openroom-x.myshopify.com", "openroom-x.myshopify.com"],
    ["http://openroom-x.myshopify.com", "openroom-x.myshopify.com"],
    ["www.shop.example.com", "shop.example.com"],
    ["https://www.shop.example.com/", "shop.example.com"],
    // The address a presenter most plausibly copies: an admin deep link.
    ["https://openroom-x.myshopify.com/admin/products", "openroom-x.myshopify.com"],
    ["openroom-x.myshopify.com?utm=1", "openroom-x.myshopify.com"],
    ["openroom-x.myshopify.com#top", "openroom-x.myshopify.com"],
    ["OpenRoom-X.MyShopify.com", "openroom-x.myshopify.com"],
  ])("normalizes %s", (raw, expected) => {
    expect(normalizeStoreDomain(raw)).toBe(expected);
  });
});

describe("parseStoreDomain", () => {
  it("accepts a bare myshopify host", () => {
    expect(parseStoreDomain("openroom-x.myshopify.com")).toEqual({
      ok: true,
      domain: "openroom-x.myshopify.com",
    });
  });

  // A merchant on a custom domain has a real storefront; both the permalink
  // and /api/ucp/mcp are served from whatever domain fronts the store.
  it("accepts a custom domain", () => {
    expect(parseStoreDomain("shop.example.com")).toEqual({
      ok: true,
      domain: "shop.example.com",
    });
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["https://", "empty"],
    ["me@example.com", "looks-like-email"],
    ["my store", "looks-like-email"],
    ["openroom", "no-dot"],
    ["localhost", "no-dot"],
    ["localhost:3000", "not-public-host"],
    ["127.0.0.1", "not-public-host"],
    ["store.local", "not-public-host"],
    ["-bad-.myshopify.com", "malformed"],
    ["store..myshopify.com", "malformed"],
  ])("rejects %s as %s", (raw, rejection) => {
    expect(parseStoreDomain(raw)).toEqual({ ok: false, rejection });
  });
});

describe("domainRejectionMessage", () => {
  it("names the fix rather than restating the rule", () => {
    expect(domainRejectionMessage("no-dot")).toBe(
      "Add the full address, like openroom.myshopify.com",
    );
    expect(domainRejectionMessage("looks-like-email")).toBe(
      "That looks like an email or a search, not a store address",
    );
  });

  it("has a message for every rejection", () => {
    for (const rejection of [
      "empty",
      "looks-like-email",
      "no-dot",
      "not-public-host",
      "malformed",
    ] as const) {
      expect(domainRejectionMessage(rejection)).not.toBe("");
    }
  });
});
