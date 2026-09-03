import { describe, expect, it } from "vitest";

import { CART_ITEMS, DEMO_PRODUCTS } from "../../src/features/demo/demo-data";
import {
  SHOPIFY_VARIANTS,
  loadShopifyVariants,
  parseVariantOverrides,
  validateShopifyVariants,
  variantNumericId,
} from "../../src/features/commerce/shopify-variants";

const GID_A = "gid://shopify/ProductVariant/1001";
const GID_B = "gid://shopify/ProductVariant/1002";

describe("SHOPIFY_VARIANTS", () => {
  it("lists every catalog product and fixture cart item, unmapped by default", () => {
    const expectedKeys = [
      ...DEMO_PRODUCTS.map(({ id }) => id),
      ...CART_ITEMS.map(({ id }) => id),
    ].sort();
    expect(Object.keys(SHOPIFY_VARIANTS).sort()).toEqual(expectedKeys);
    expect(Object.values(SHOPIFY_VARIANTS).every((gid) => gid === null)).toBe(true);
  });
});

describe("validateShopifyVariants", () => {
  it("keeps well-formed gids and ignores nulls", () => {
    expect(validateShopifyVariants({ a: GID_A, b: null })).toEqual({
      variants: { a: GID_A },
      issues: [],
    });
  });

  it("reports malformed gids", () => {
    expect(
      validateShopifyVariants({
        a: "1001",
        b: "gid://shopify/Product/1001",
        c: "gid://shopify/ProductVariant/abc",
        d: " gid://shopify/ProductVariant/1001",
      }).issues,
    ).toEqual([
      { productId: "a", issue: "invalid-gid" },
      { productId: "b", issue: "invalid-gid" },
      { productId: "c", issue: "invalid-gid" },
      { productId: "d", issue: "invalid-gid" },
    ]);
  });

  it("keeps the first product for a duplicated gid and flags the rest", () => {
    expect(validateShopifyVariants({ a: GID_A, b: GID_A, c: GID_B })).toEqual({
      variants: { a: GID_A, c: GID_B },
      issues: [{ productId: "b", issue: "duplicate-gid" }],
    });
  });
});

describe("parseVariantOverrides", () => {
  it("parses comma-separated productId=gid pairs and ignores malformed entries", () => {
    expect(
      parseVariantOverrides(` a=${GID_A} , ,b=${GID_B},novalue=,=nokey,justtext`),
    ).toEqual({ a: GID_A, b: GID_B });
    expect(parseVariantOverrides(undefined)).toEqual({});
    expect(parseVariantOverrides("")).toEqual({});
  });

  it("accepts the bare numeric id Shopify admin shows and both spellings agree", () => {
    expect(parseVariantOverrides("a=44352465993")).toEqual({
      a: "gid://shopify/ProductVariant/44352465993",
    });
    expect(parseVariantOverrides("a=44352465993")).toEqual(
      parseVariantOverrides("a=gid://shopify/ProductVariant/44352465993"),
    );
    expect(
      validateShopifyVariants(parseVariantOverrides("a=44352465993")).issues,
    ).toEqual([]);
  });

  it("leaves anything else untouched so the validator still rejects it", () => {
    const overrides = parseVariantOverrides(
      "a=gid://shopify/ProductVariant/44352465993?x=1,b=44352465993abc",
    );
    expect(overrides).toEqual({
      a: "gid://shopify/ProductVariant/44352465993?x=1",
      b: "44352465993abc",
    });
    expect(validateShopifyVariants(overrides).issues).toEqual([
      { productId: "a", issue: "invalid-gid" },
      { productId: "b", issue: "invalid-gid" },
    ]);
  });
});

describe("loadShopifyVariants", () => {
  it("merges overrides over the base map without dropping base keys", () => {
    expect(
      loadShopifyVariants({ NEXT_PUBLIC_SHOPIFY_VARIANTS: `rug=${GID_A}` }, { rug: null, plant: null }),
    ).toEqual({ rug: GID_A, plant: null });
  });

  it("returns the base map when no override is set", () => {
    expect(loadShopifyVariants({}, { rug: null })).toEqual({ rug: null });
  });
});

describe("variantNumericId", () => {
  it("extracts the numeric id from a variant gid", () => {
    expect(variantNumericId(GID_A)).toBe("1001");
    expect(variantNumericId("gid://shopify/Product/1001")).toBeNull();
  });
});
