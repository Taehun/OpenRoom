import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  // tests/e2e/commerce needs shopify-mode NEXT_PUBLIC_* values inlined at
  // compile time; playwright.commerce.config.ts owns that server. The pattern
  // is matched against the absolute path, so it is anchored to the test
  // directory — a bare "**/commerce/**" also matches a checkout living under
  // a directory named "commerce" and would ignore every spec.
  testIgnore: ["**/tests/e2e/commerce/**"],
  outputDir: "test-results",
  use: {
    baseURL: externalBaseUrl ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  webServer: skipWebServer
    ? undefined
    : {
        command: "pnpm exec next dev --hostname 127.0.0.1 --port 3000",
        url: "http://127.0.0.1:3000",
        reuseExistingServer: false,
      },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
