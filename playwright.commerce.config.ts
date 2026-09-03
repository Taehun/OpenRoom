import { defineConfig, devices } from "@playwright/test";

// Runs the Shopify-mode journeys against a second dev server. NEXT_PUBLIC_*
// values are inlined at compile time, so this config owns its own server and
// port; never run it concurrently with playwright.config.ts (both use .next).
export default defineConfig({
  testDir: "./tests/e2e/commerce",
  outputDir: "test-results-commerce",
  use: {
    baseURL: "http://127.0.0.1:3001",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm exec next dev --hostname 127.0.0.1 --port 3001",
    url: "http://127.0.0.1:3001",
    reuseExistingServer: false,
    env: {
      NEXT_PUBLIC_COMMERCE_PROVIDER: "shopify",
      NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: "openroom-placeholder.myshopify.com",
      NEXT_PUBLIC_SHOPIFY_VARIANTS:
        "coffee-table=gid://shopify/ProductVariant/1001,rug=gid://shopify/ProductVariant/1002,oak-frame-table=gid://shopify/ProductVariant/1003",
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
