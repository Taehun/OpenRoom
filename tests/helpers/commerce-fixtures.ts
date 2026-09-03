import type { CommerceContext, ShopifyVariantMap } from "../../src/features/commerce/commerce-types";

export const PLACEHOLDER_STORE_DOMAIN = "nook-placeholder.myshopify.com";

export const FIXTURE_VARIANTS: ShopifyVariantMap = {
  "coffee-table": "gid://shopify/ProductVariant/1001",
  rug: "gid://shopify/ProductVariant/1002",
  "oak-frame-table": "gid://shopify/ProductVariant/1003",
  "woven-jute-rug": "gid://shopify/ProductVariant/1004",
  "floor-lamp": null,
  plant: null,
};

export const DEMO_COMMERCE: CommerceContext = {
  config: { provider: "demo", reason: "default" },
  variants: FIXTURE_VARIANTS,
};

export const SHOPIFY_COMMERCE: CommerceContext = {
  config: {
    provider: "shopify",
    storeDomain: PLACEHOLDER_STORE_DOMAIN,
    mcpEndpoint: `https://${PLACEHOLDER_STORE_DOMAIN}/api/mcp`,
  },
  variants: FIXTURE_VARIANTS,
};
