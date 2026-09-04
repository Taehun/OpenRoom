import { defineConfig, devices } from "@playwright/test";

import {
  FIXTURE_SITE_ORIGIN,
  FIXTURE_VARIANT_OVERRIDES,
  PLACEHOLDER_STORE_DOMAIN,
} from "./tests/helpers/commerce-fixtures";

// Runs the connected-store journeys against a second dev server. NEXT_PUBLIC_*
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
      NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: PLACEHOLDER_STORE_DOMAIN,
      NEXT_PUBLIC_SHOPIFY_VARIANTS: FIXTURE_VARIANT_OVERRIDES,
      NEXT_PUBLIC_SITE_ORIGIN: FIXTURE_SITE_ORIGIN,
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
