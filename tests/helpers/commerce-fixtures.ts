import type { CommerceContext, ShopifyVariantMap } from "../../src/features/commerce/commerce-types";

export const PLACEHOLDER_STORE_DOMAIN = "openroom-placeholder.myshopify.com";

// The site origin the Shopify-mode dev server is built with, and the agent
// profile URL that follows from it. Shopify fetches that URL itself, so the
// fixture uses an https origin rather than the loopback host the server runs on.
export const FIXTURE_SITE_ORIGIN = "https://openroom-placeholder.pages.dev";

export const FIXTURE_AGENT_PROFILE_URL = `${FIXTURE_SITE_ORIGIN}/ucp/agent-profile.json`;

// Real Shopify variant ids are 13-14 digits; the fixtures use realistic-length
// ids so the permalink and the override string are exercised at full width.
export const FIXTURE_VARIANT_IDS = {
  "coffee-table": "4435246599371",
  rug: "4435246599372",
  "oak-frame-table": "4435246599373",
  "woven-jute-rug": "4435246599374",
} as const;

export function fixtureGid(productId: keyof typeof FIXTURE_VARIANT_IDS): string {
  return `gid://shopify/ProductVariant/${FIXTURE_VARIANT_IDS[productId]}`;
}

export const FIXTURE_VARIANTS: ShopifyVariantMap = {
  "coffee-table": fixtureGid("coffee-table"),
  rug: fixtureGid("rug"),
  "oak-frame-table": fixtureGid("oak-frame-table"),
  "woven-jute-rug": fixtureGid("woven-jute-rug"),
  "floor-lamp": null,
  plant: null,
};

/**
 * The catalog products the Shopify-mode dev server is started with
 * (`playwright.commerce.config.ts`), so the E2E and the unit fixtures cannot
 * drift apart. Every other catalog product stays unmapped on purpose: the
 * journeys need a skipped line to render.
 */
export const FIXTURE_VARIANT_OVERRIDES = (
  ["oak-frame-table", "woven-jute-rug"] as const
)
  .map((productId) => `${productId}=${fixtureGid(productId)}`)
  .join(",");

export const DEMO_COMMERCE: CommerceContext = {
  config: { provider: "demo", reason: "default" },
  variants: FIXTURE_VARIANTS,
};

export const SHOPIFY_COMMERCE: CommerceContext = {
  config: {
    provider: "shopify",
    storeDomain: PLACEHOLDER_STORE_DOMAIN,
    mcpEndpoint: `https://${PLACEHOLDER_STORE_DOMAIN}/api/ucp/mcp`,
    agentProfileUrl: FIXTURE_AGENT_PROFILE_URL,
  },
  variants: FIXTURE_VARIANTS,
};
