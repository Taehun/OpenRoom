import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    ".worktrees/**",
    ".claude/worktrees/**",
    ".wrangler/**",
    "next-env.d.ts",
    // Shopify's own Horizon theme, pulled by pnpm shop:theme:pull. Vendored
    // code: this repo only edits its JSON, never its assets or Liquid.
    "examples/shopify/theme/**",
  ]),
]);

export default eslintConfig;
