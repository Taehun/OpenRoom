import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The token file is the single source of colour, type, shape and state for both
 * surfaces. The legacy aliases are what let the ~130 existing `var(--…)` usages
 * in `demo-workspace.module.css` adopt the Material palette without a per-rule
 * edit, so they are asserted line by line rather than by spot check.
 */
const tokens = readFileSync("app/material-tokens.css", "utf8");

/*
 * Every stylesheet the two surfaces ship, not just the CSS modules: the global
 * sheets carry the component classes and the base layer, so a raw literal there
 * would defeat the token system exactly as one in a module would.
 */
const MODULE_STYLESHEETS = [
  "app/globals.css",
  "app/material-components.css",
  "src/features/demo/demo-workspace.module.css",
  "src/features/home/home.module.css",
];

describe("material tokens", () => {
  it("defines the color roles and legacy aliases", () => {
    for (const line of [
      "--md-sys-color-primary: #4B6543",
      "--md-sys-color-surface: #FBF9F4",
      "--md-sys-color-outline-variant: #C3C8BC",
      "--ink: var(--md-sys-color-on-surface)",
      "--muted-text: var(--md-sys-color-on-surface-variant)",
      "--paper: var(--md-sys-color-surface-container-lowest)",
      "--limestone: var(--md-sys-color-surface)",
      "--warm-divider: var(--md-sys-color-outline-variant)",
      "--moss: var(--md-sys-color-primary)",
      "--terracotta: var(--md-sys-color-tertiary)",
      "--md-sys-shape-corner-extra-large: 28px",
      "--md-sys-typescale-label-large-size: 14px",
    ])
      expect(tokens).toContain(line);
  });

  it("leaves no hex color in the surface stylesheets", () => {
    for (const file of MODULE_STYLESHEETS) {
      expect(readFileSync(file, "utf8")).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });

  /*
   * Every colour on these surfaces has to come from a token. `color-mix()`
   * over a role is the way to express a translucent one, so the rule reads
   * past it; a genuinely black or white scrim or photo shadow is the only
   * other exception, and must say which it is on the same line.
   */
  it("keeps raw color literals out of the surface stylesheets", () => {
    for (const file of MODULE_STYLESHEETS) {
      const offenders = readFileSync(file, "utf8")
        .split("\n")
        .map((line, index) => ({ line, number: index + 1 }))
        .filter(
          ({ line }) =>
            /\b(?:rgba?|hsla?)\(/.test(line.replaceAll(/color-mix\([^;]*/g, "")) &&
            !/\/\* (?:scrim|shadow) \*\//.test(line),
        )
        .map(({ line, number }) => `${file}:${number}: ${line.trim()}`);
      expect(offenders).toEqual([]);
    }
  });

  it("drops the editorial serif family everywhere", () => {
    for (const file of [
      "app/globals.css",
      "app/layout.tsx",
      "src/features/demo/demo-workspace.module.css",
      "src/features/home/home.module.css",
    ]) {
      expect(readFileSync(file, "utf8")).not.toContain("--font-editorial");
    }
  });
});
