import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    // The companion integration test opts into the node environment with its
    // own `@vitest-environment` docblock; everything else stays on jsdom.
    include: ["tests/unit/**/*.test.{ts,tsx}", "tests/integration/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
  },
});
