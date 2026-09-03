# Nook Commerce Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an approved Nook cart reach a real Shopify checkout through a cart permalink, and expose Shopify merchandise lines plus the store's Storefront MCP endpoint in `add_scene_to_cart` results, with no token, no server route, and no request from Nook itself.

**Architecture:** A small pure `src/features/commerce/` module parses two public build-time variables, validates a static product→variant map (optionally overridden by a third public variable), resolves cart lines, builds the permalink, and enriches the existing `CartApprovalDraft` with an optional `commerce` block. The WebMCP handler and the approval sheet consume that block; demo mode is byte-for-byte unchanged.

**Tech Stack:** TypeScript 5, React 19.2, Next 16.3.3 App Router (`NEXT_PUBLIC_*` build-time inlining), Zod 4, Vitest 4 + Testing Library, Playwright 1.62, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-03-nook-commerce-integration-design.md`

## Global Constraints

- Work in a git worktree on branch `feat/commerce-integration` from `main` at or after `b4f3c6e`; never edit the main checkout directly.
- WebMCP remains exactly the Core 6; `add_scene_to_cart` still only opens the local approval sheet and performs no network request.
- Demo mode is the default and byte-for-byte the current behavior: no `commerce` block, announcement `Demo only — no external cart was created.`, zero requests. Existing unit and E2E tests must pass unchanged in demo mode.
- Nook stores no Shopify token. The only configuration is `NEXT_PUBLIC_COMMERCE_PROVIDER` (`demo` | `shopify`, default `demo`), `NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN` (bare host), and optional `NEXT_PUBLIC_SHOPIFY_VARIANTS` (`productId=gid://shopify/ProductVariant/<digits>` pairs, comma-separated). Values are inlined at build time; reference them only as literal `process.env.NEXT_PUBLIC_…` expressions.
- Invalid or missing Shopify configuration fails closed to demo mode with a visible reason; nothing throws at runtime or build time.
- No product is sent to Shopify without a registered variant mapping; unmapped or invalid products are excluded and listed; zero mapped lines means no permalink and a disabled primary button.
- Exact strings: permalink `https://{storeDomain}/cart/{variantId}:{qty}[,{variantId}:{qty}…]`; MCP endpoint `https://{storeDomain}/api/mcp`; announcement `Opened Shopify checkout in a new tab (N item|items)`; primary button accessible name `Continue to Shopify · $<total>` (demo fixture stays `Continue to Shopify · $626`, agent draft in demo mode stays `Approve Scene cart · $<total>`); blocked-popup link text `Open Shopify checkout`; skipped reason text `Not mapped to a Shopify variant`.
- The variant map file lists exactly the 18 catalog product ids and the 4 fixture cart ids, all `null` by default; no real GID is ever committed.
- Keep WebMCP contracts, handlers, registration, unit tests, and `tests/evals/webmcp-journeys.json` aligned (repository rule).
- Use TDD for every task: write the failing test, observe RED for the intended reason, implement the minimum, observe GREEN, commit. Run the narrowest Vitest file while iterating; before completion run `pnpm test`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run test:e2e`, `pnpm run test:e2e:commerce`, `pnpm run build`, and `pnpm run build:next`.
- Before changing React, CSS, or Next-facing code, read `node_modules/next/dist/docs/01-app/02-guides/environment-variables.md` (build-time inlining) and the CSS Modules guide; do not rely on remembered framework behavior.
- Never call a live provider, deploy, push, or open a pull request.

## File and Interface Map

- Create `src/features/commerce/commerce-types.ts` — shared types: `CommerceConfig`, `CommerceEnv`, `CartLineInput`, `CommerceLine`, `SkippedLine`, `CommerceDraft`, `ShopifyVariantMap`, `CommerceContext`.
- Create `src/features/commerce/commerce-config.ts` — `parseCommerceConfig(env)` and the inlined `COMMERCE_CONFIG`.
- Create `src/features/commerce/shopify-variants.ts` — `SHOPIFY_VARIANTS`, `SHOPIFY_VARIANT_GID_PATTERN`, `validateShopifyVariants`, `parseVariantOverrides`, `loadShopifyVariants`, `variantNumericId`, `ACTIVE_SHOPIFY_VARIANTS`.
- Create `src/features/commerce/shopify-cart.ts` — `resolveShopifyLines`, `buildCartPermalink`, `buildCommerceDraft`, `enrichCartDraft`.
- Create `src/features/commerce/commerce-runtime.ts` — `ACTIVE_COMMERCE: CommerceContext` combining the inlined config and variants.
- Create `tests/helpers/commerce-fixtures.ts` — `DEMO_COMMERCE`, `SHOPIFY_COMMERCE`, `PLACEHOLDER_STORE_DOMAIN`, `FIXTURE_VARIANTS` for unit and component tests.
- Modify `src/webmcp/tool-context.ts` — `CartApprovalDraft.commerce?: CommerceDraft`; `ToolContext.commerce: CommerceContext`.
- Modify `src/webmcp/tool-handlers.ts` — enrich the draft before `openCartApproval`.
- Modify `src/features/demo/demo-types.ts`, `demo-state.ts` — action `open-external-checkout`.
- Modify `src/features/demo/cart-approval-sheet.tsx`, `demo-workspace.tsx`, `demo-workspace.module.css` — Shopify-mode sheet.
- Create `.env.example`; modify `README.md`, `AGENTS.md`, `package.json` (script), `playwright.config.ts` (ignore the commerce directory); create `playwright.commerce.config.ts` and `tests/e2e/commerce/shopify-checkout.spec.ts`.
- Modify `tests/evals/webmcp-journeys.json` — one new journey.
- Tests: `tests/unit/commerce-config.test.ts`, `tests/unit/shopify-variants.test.ts`, `tests/unit/shopify-cart.test.ts`, `tests/unit/cart-approval-sheet.test.tsx`; extend `tests/unit/webmcp-tools.test.ts`, `tests/unit/register-tools.test.tsx`, `tests/unit/demo-state.test.ts`.

---

### Task 1: Commerce Config and `.env.example`

**Files:**
- Create: `src/features/commerce/commerce-types.ts`
- Create: `src/features/commerce/commerce-config.ts`
- Create: `.env.example`
- Test: `tests/unit/commerce-config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseCommerceConfig(env: CommerceEnv): CommerceConfig`, `COMMERCE_CONFIG: CommerceConfig`, and every shared type below.

- [ ] **Step 1: Create the shared types**

`src/features/commerce/commerce-types.ts`:

```ts
export type CommerceConfig =
  | {
      provider: "demo";
      reason: "default" | "not-configured" | "invalid-domain";
    }
  | { provider: "shopify"; storeDomain: string; mcpEndpoint: string };

export interface CommerceEnv {
  NEXT_PUBLIC_COMMERCE_PROVIDER?: string | undefined;
  NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN?: string | undefined;
}

export type ShopifyVariantMap = Readonly<Record<string, string | null>>;

export interface CartLineInput {
  productId: string;
  quantity: number;
}

export interface CommerceLine {
  productId: string;
  merchandiseId: string;
  quantity: number;
}

export interface SkippedLine {
  productId: string;
  reason: "unmapped" | "invalid";
}

export interface CommerceDraft {
  provider: "shopify";
  storeDomain: string;
  mcpEndpoint: string;
  lines: readonly CommerceLine[];
  skipped: readonly SkippedLine[];
  checkoutPermalink: string | null;
}

export interface CommerceContext {
  config: CommerceConfig;
  variants: ShopifyVariantMap;
}
```

- [ ] **Step 2: Write the failing config tests**

`tests/unit/commerce-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { parseCommerceConfig } from "../../src/features/commerce/commerce-config";

describe("parseCommerceConfig", () => {
  it("defaults to demo when nothing is configured", () => {
    expect(parseCommerceConfig({})).toEqual({ provider: "demo", reason: "default" });
    expect(parseCommerceConfig({ NEXT_PUBLIC_COMMERCE_PROVIDER: "  " })).toEqual({
      provider: "demo",
      reason: "default",
    });
    expect(parseCommerceConfig({ NEXT_PUBLIC_COMMERCE_PROVIDER: "demo" })).toEqual({
      provider: "demo",
      reason: "default",
    });
  });

  it("treats an unknown provider as not configured", () => {
    expect(
      parseCommerceConfig({
        NEXT_PUBLIC_COMMERCE_PROVIDER: "woocommerce",
        NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: "store.myshopify.com",
      }),
    ).toEqual({ provider: "demo", reason: "not-configured" });
  });

  it("fails closed when shopify has no store domain", () => {
    expect(parseCommerceConfig({ NEXT_PUBLIC_COMMERCE_PROVIDER: "shopify" })).toEqual({
      provider: "demo",
      reason: "not-configured",
    });
    expect(
      parseCommerceConfig({
        NEXT_PUBLIC_COMMERCE_PROVIDER: "shopify",
        NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: "   ",
      }),
    ).toEqual({ provider: "demo", reason: "not-configured" });
  });

  it.each([
    "https://store.myshopify.com",
    "store.myshopify.com/cart",
    "store my shop.com",
    "-bad.myshopify.com",
    "localhost",
    "store.myshopify.com?x=1",
  ])("rejects the malformed domain %s", (domain) => {
    expect(
      parseCommerceConfig({
        NEXT_PUBLIC_COMMERCE_PROVIDER: "shopify",
        NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: domain,
      }),
    ).toEqual({ provider: "demo", reason: "invalid-domain" });
  });

  it("accepts a bare store host, normalizes it, and derives the MCP endpoint", () => {
    expect(
      parseCommerceConfig({
        NEXT_PUBLIC_COMMERCE_PROVIDER: " shopify ",
        NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: " Example-Store.myshopify.com ",
      }),
    ).toEqual({
      provider: "shopify",
      storeDomain: "example-store.myshopify.com",
      mcpEndpoint: "https://example-store.myshopify.com/api/mcp",
    });
    expect(
      parseCommerceConfig({
        NEXT_PUBLIC_COMMERCE_PROVIDER: "shopify",
        NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: "shop.example.com",
      }),
    ).toMatchObject({ provider: "shopify", storeDomain: "shop.example.com" });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/unit/commerce-config.test.ts`
Expected: FAIL — cannot resolve `../../src/features/commerce/commerce-config`.

- [ ] **Step 4: Implement the config parser**

`src/features/commerce/commerce-config.ts`:

```ts
import { z } from "zod";

import type { CommerceConfig, CommerceEnv } from "./commerce-types";

const providerSchema = z.enum(["demo", "shopify"]);

// Bare host only: labels of letters, digits, and inner hyphens, a TLD of at
// least two letters, no scheme, path, port, query, or whitespace.
const storeDomainSchema = z
  .string()
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);

export function parseCommerceConfig(env: CommerceEnv): CommerceConfig {
  const providerValue = env.NEXT_PUBLIC_COMMERCE_PROVIDER?.trim() ?? "";
  if (providerValue === "") return { provider: "demo", reason: "default" };

  const provider = providerSchema.safeParse(providerValue);
  if (!provider.success) return { provider: "demo", reason: "not-configured" };
  if (provider.data === "demo") return { provider: "demo", reason: "default" };

  const domainValue =
    env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN?.trim().toLowerCase() ?? "";
  if (domainValue === "") return { provider: "demo", reason: "not-configured" };

  const domain = storeDomainSchema.safeParse(domainValue);
  if (!domain.success) return { provider: "demo", reason: "invalid-domain" };

  return {
    provider: "shopify",
    storeDomain: domain.data,
    mcpEndpoint: `https://${domain.data}/api/mcp`,
  };
}

// Literal `process.env.NEXT_PUBLIC_*` references are inlined by Next at build time.
export const COMMERCE_CONFIG: CommerceConfig = parseCommerceConfig({
  NEXT_PUBLIC_COMMERCE_PROVIDER: process.env.NEXT_PUBLIC_COMMERCE_PROVIDER,
  NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN,
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/unit/commerce-config.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Create `.env.example`**

```dotenv
# Nook environment example. Copy to .env.local for local work.
# Every value here is public and build-time: Next inlines NEXT_PUBLIC_* values
# when you run `next build`, so change them and rebuild. Nook never needs a
# Shopify access token.

# Commerce mode: demo (default; no external requests) or shopify.
NEXT_PUBLIC_COMMERCE_PROVIDER=demo

# Bare store host, e.g. your-store.myshopify.com. Used for cart permalinks
# (https://<domain>/cart/<variantId>:<qty>) and the Storefront MCP endpoint
# (https://<domain>/api/mcp). Required when NEXT_PUBLIC_COMMERCE_PROVIDER=shopify.
NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN=

# Optional: map demo product ids to Shopify variant GIDs without editing
# src/features/commerce/shopify-variants.ts. Comma-separated productId=gid pairs;
# entries here override the file. Example:
# NEXT_PUBLIC_SHOPIFY_VARIANTS=hinoki-low-sofa=gid://shopify/ProductVariant/1234567890,oak-frame-table=gid://shopify/ProductVariant/2345678901
NEXT_PUBLIC_SHOPIFY_VARIANTS=

# Asset provider stays cached; no live asset generation exists.
ASSET_PROVIDER=cached
```

Confirm `.gitignore` keeps `.env*` ignored and `!.env.example` tracked (it already does).

- [ ] **Step 7: Commit**

```bash
git add src/features/commerce/commerce-types.ts src/features/commerce/commerce-config.ts .env.example tests/unit/commerce-config.test.ts
git diff --cached --check
git commit -m "feat(commerce): parse public commerce configuration"
```

### Task 2: Shopify Variant Map, Validation, and Env Override

**Files:**
- Create: `src/features/commerce/shopify-variants.ts`
- Test: `tests/unit/shopify-variants.test.ts`

**Interfaces:**
- Consumes: `ShopifyVariantMap` from `commerce-types.ts`; `DEMO_PRODUCTS` and `CART_ITEMS` from `src/features/demo/demo-data.ts` (tests only).
- Produces: `SHOPIFY_VARIANTS`, `SHOPIFY_VARIANT_GID_PATTERN`, `validateShopifyVariants(map): ValidatedVariants`, `parseVariantOverrides(value): ShopifyVariantMap`, `loadShopifyVariants(env, base?): ShopifyVariantMap`, `variantNumericId(gid): string | null`, `ACTIVE_SHOPIFY_VARIANTS`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/shopify-variants.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/shopify-variants.test.ts`
Expected: FAIL — cannot resolve `shopify-variants`.

- [ ] **Step 3: Implement the variant module**

`src/features/commerce/shopify-variants.ts`:

```ts
import type { ShopifyVariantMap } from "./commerce-types";

export const SHOPIFY_VARIANT_GID_PATTERN = /^gid:\/\/shopify\/ProductVariant\/(\d+)$/;

// Fill these with your store's variant GIDs, or set NEXT_PUBLIC_SHOPIFY_VARIANTS.
// Keys are demo catalog product ids (src/features/demo/demo-data.ts) followed by
// the four human fixture cart item ids. Never commit a real store's GIDs here.
export const SHOPIFY_VARIANTS: ShopifyVariantMap = {
  "hinoki-low-sofa": null,
  "boucle-curve-sofa": null,
  "walnut-frame-sofa": null,
  "oak-frame-table": null,
  "travertine-plinth-table": null,
  "walnut-nesting-table": null,
  "woven-jute-rug": null,
  "wool-pebble-rug": null,
  "geometric-flatweave-rug": null,
  "rice-paper-floor-lamp": null,
  "linen-dome-lamp": null,
  "brass-globe-lamp": null,
  "ash-lounge-chair": null,
  "boucle-barrel-chair": null,
  "cognac-sling-chair": null,
  "ceramic-olive-tree": null,
  "stone-planter-ficus": null,
  "teak-planter-palm": null,
  "coffee-table": null,
  "floor-lamp": null,
  rug: null,
  plant: null,
};

export interface VariantIssue {
  productId: string;
  issue: "invalid-gid" | "duplicate-gid";
}

export interface ValidatedVariants {
  variants: Readonly<Record<string, string>>;
  issues: readonly VariantIssue[];
}

export function validateShopifyVariants(map: ShopifyVariantMap): ValidatedVariants {
  const variants: Record<string, string> = {};
  const issues: VariantIssue[] = [];
  const owners = new Set<string>();
  for (const [productId, gid] of Object.entries(map)) {
    if (gid === null) continue;
    if (!SHOPIFY_VARIANT_GID_PATTERN.test(gid)) {
      issues.push({ productId, issue: "invalid-gid" });
      continue;
    }
    if (owners.has(gid)) {
      issues.push({ productId, issue: "duplicate-gid" });
      continue;
    }
    owners.add(gid);
    variants[productId] = gid;
  }
  return { variants, issues };
}

export function parseVariantOverrides(value: string | undefined): ShopifyVariantMap {
  if (value === undefined) return {};
  const entries: Record<string, string> = {};
  for (const pair of value.split(",")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const productId = pair.slice(0, separator).trim();
    const gid = pair.slice(separator + 1).trim();
    if (productId === "" || gid === "") continue;
    entries[productId] = gid;
  }
  return entries;
}

export function loadShopifyVariants(
  env: { NEXT_PUBLIC_SHOPIFY_VARIANTS?: string | undefined },
  base: ShopifyVariantMap = SHOPIFY_VARIANTS,
): ShopifyVariantMap {
  return { ...base, ...parseVariantOverrides(env.NEXT_PUBLIC_SHOPIFY_VARIANTS) };
}

export function variantNumericId(gid: string): string | null {
  return SHOPIFY_VARIANT_GID_PATTERN.exec(gid)?.[1] ?? null;
}

export const ACTIVE_SHOPIFY_VARIANTS: ShopifyVariantMap = loadShopifyVariants({
  NEXT_PUBLIC_SHOPIFY_VARIANTS: process.env.NEXT_PUBLIC_SHOPIFY_VARIANTS,
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/shopify-variants.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/commerce/shopify-variants.ts tests/unit/shopify-variants.test.ts
git diff --cached --check
git commit -m "feat(commerce): register Shopify variant mapping"
```

### Task 3: Cart Lines, Permalink, and Draft Enrichment

**Files:**
- Create: `src/features/commerce/shopify-cart.ts`
- Create: `src/features/commerce/commerce-runtime.ts`
- Create: `tests/helpers/commerce-fixtures.ts`
- Modify: `src/webmcp/tool-context.ts` (add `commerce?: CommerceDraft` to `CartApprovalDraft`)
- Test: `tests/unit/shopify-cart.test.ts`

**Interfaces:**
- Consumes: `CommerceContext`, `CartLineInput`, `CommerceDraft` types; `validateShopifyVariants`, `variantNumericId`; `CartApprovalDraft`.
- Produces: `resolveShopifyLines(items, map): { lines: ResolvedLine[]; skipped: SkippedLine[] }`, `buildCartPermalink(storeDomain, lines): string | null`, `buildCommerceDraft(commerce, items): CommerceDraft | null`, `enrichCartDraft(commerce, draft): CartApprovalDraft`, `ACTIVE_COMMERCE`, test fixtures `DEMO_COMMERCE`, `SHOPIFY_COMMERCE`, `PLACEHOLDER_STORE_DOMAIN`, `FIXTURE_VARIANTS`.

- [ ] **Step 1: Add the optional `commerce` field to the draft type**

In `src/webmcp/tool-context.ts` add the import and field (only `CommerceDraft` for now; Task 4 adds `CommerceContext`, so an unused import does not trip lint here):

```ts
import type { CommerceDraft } from "../features/commerce/commerce-types";

export interface CartApprovalDraft {
  id: string;
  sceneId: string;
  sceneRevision: number;
  items: readonly CartApprovalItem[];
  totalMinor: number;
  commerce?: CommerceDraft;
}
```

(The `ToolContext.commerce: CommerceContext` field is added in Task 4; leave `ToolContext` unchanged here so this task compiles on its own.)

- [ ] **Step 2: Write the test fixtures**

`tests/helpers/commerce-fixtures.ts`:

```ts
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
```

- [ ] **Step 3: Write the failing cart tests**

`tests/unit/shopify-cart.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  buildCartPermalink,
  buildCommerceDraft,
  enrichCartDraft,
  resolveShopifyLines,
} from "../../src/features/commerce/shopify-cart";
import type { CartApprovalDraft } from "../../src/webmcp/tool-context";
import {
  DEMO_COMMERCE,
  FIXTURE_VARIANTS,
  PLACEHOLDER_STORE_DOMAIN,
  SHOPIFY_COMMERCE,
} from "../helpers/commerce-fixtures";

const DRAFT: CartApprovalDraft = {
  id: "scene-demo-rev-3",
  sceneId: "demo",
  sceneRevision: 3,
  items: [
    {
      objectId: "table_01",
      productId: "oak-frame-table",
      variantId: "demo-variant-oak-frame-table",
      title: "Oak Frame Table",
      quantity: 1,
      price: { amountMinor: 16900, currency: "USD" },
    },
    {
      objectId: "rug_01",
      productId: "woven-jute-rug",
      variantId: "demo-variant-woven-jute-rug",
      title: "Woven Jute Rug",
      quantity: 1,
      price: { amountMinor: 32900, currency: "USD" },
    },
    {
      objectId: "lamp_01",
      productId: "rice-paper-floor-lamp",
      variantId: "demo-variant-rice-paper-floor-lamp",
      title: "Rice Paper Floor Lamp",
      quantity: 1,
      price: { amountMinor: 14900, currency: "USD" },
    },
  ],
  totalMinor: 64700,
};

describe("resolveShopifyLines", () => {
  it("maps products to merchandise ids, aggregates quantities, and lists skipped products once", () => {
    const result = resolveShopifyLines(
      [
        { productId: "coffee-table", quantity: 1 },
        { productId: "floor-lamp", quantity: 1 },
        { productId: "coffee-table", quantity: 2 },
        { productId: "unknown-product", quantity: 1 },
        { productId: "floor-lamp", quantity: 1 },
      ],
      FIXTURE_VARIANTS,
    );
    expect(result.lines).toEqual([
      {
        productId: "coffee-table",
        merchandiseId: "gid://shopify/ProductVariant/1001",
        variantId: "1001",
        quantity: 3,
      },
    ]);
    expect(result.skipped).toEqual([
      { productId: "floor-lamp", reason: "unmapped" },
      { productId: "unknown-product", reason: "unmapped" },
    ]);
  });

  it("skips products whose mapping is invalid or duplicated", () => {
    const result = resolveShopifyLines(
      [
        { productId: "a", quantity: 1 },
        { productId: "b", quantity: 1 },
        { productId: "c", quantity: 1 },
      ],
      { a: "gid://shopify/ProductVariant/7", b: "gid://shopify/ProductVariant/7", c: "bad" },
    );
    expect(result.lines.map(({ productId }) => productId)).toEqual(["a"]);
    expect(result.skipped).toEqual([
      { productId: "b", reason: "invalid" },
      { productId: "c", reason: "invalid" },
    ]);
  });

  it("ignores non-positive or fractional quantities", () => {
    const result = resolveShopifyLines(
      [
        { productId: "coffee-table", quantity: 0 },
        { productId: "rug", quantity: 1.5 },
      ],
      FIXTURE_VARIANTS,
    );
    expect(result.lines).toEqual([]);
    expect(result.skipped).toEqual([]);
  });
});

describe("buildCartPermalink", () => {
  it("joins variant ids and quantities in order", () => {
    expect(
      buildCartPermalink(PLACEHOLDER_STORE_DOMAIN, [
        { productId: "a", merchandiseId: "gid://shopify/ProductVariant/1001", variantId: "1001", quantity: 2 },
        { productId: "b", merchandiseId: "gid://shopify/ProductVariant/1002", variantId: "1002", quantity: 1 },
      ]),
    ).toBe(`https://${PLACEHOLDER_STORE_DOMAIN}/cart/1001:2,1002:1`);
  });

  it("returns null without lines", () => {
    expect(buildCartPermalink(PLACEHOLDER_STORE_DOMAIN, [])).toBeNull();
  });
});

describe("buildCommerceDraft", () => {
  it("returns null in demo mode", () => {
    expect(buildCommerceDraft(DEMO_COMMERCE, [{ productId: "coffee-table", quantity: 1 }])).toBeNull();
  });

  it("builds public lines, skipped products, endpoint, and permalink in shopify mode", () => {
    expect(
      buildCommerceDraft(SHOPIFY_COMMERCE, [
        { productId: "coffee-table", quantity: 1 },
        { productId: "plant", quantity: 1 },
      ]),
    ).toEqual({
      provider: "shopify",
      storeDomain: PLACEHOLDER_STORE_DOMAIN,
      mcpEndpoint: `https://${PLACEHOLDER_STORE_DOMAIN}/api/mcp`,
      lines: [
        { productId: "coffee-table", merchandiseId: "gid://shopify/ProductVariant/1001", quantity: 1 },
      ],
      skipped: [{ productId: "plant", reason: "unmapped" }],
      checkoutPermalink: `https://${PLACEHOLDER_STORE_DOMAIN}/cart/1001:1`,
    });
  });

  it("yields no permalink when nothing is mapped", () => {
    expect(buildCommerceDraft(SHOPIFY_COMMERCE, [{ productId: "plant", quantity: 1 }])).toMatchObject({
      lines: [],
      checkoutPermalink: null,
    });
  });
});

describe("enrichCartDraft", () => {
  it("returns the same draft object in demo mode", () => {
    expect(enrichCartDraft(DEMO_COMMERCE, DRAFT)).toBe(DRAFT);
    expect("commerce" in DRAFT).toBe(false);
  });

  it("adds a commerce block without mutating the input in shopify mode", () => {
    const enriched = enrichCartDraft(SHOPIFY_COMMERCE, DRAFT);
    expect(enriched).not.toBe(DRAFT);
    expect(DRAFT.commerce).toBeUndefined();
    expect(enriched.items).toBe(DRAFT.items);
    expect(enriched.commerce).toEqual({
      provider: "shopify",
      storeDomain: PLACEHOLDER_STORE_DOMAIN,
      mcpEndpoint: `https://${PLACEHOLDER_STORE_DOMAIN}/api/mcp`,
      lines: [
        { productId: "oak-frame-table", merchandiseId: "gid://shopify/ProductVariant/1003", quantity: 1 },
        { productId: "woven-jute-rug", merchandiseId: "gid://shopify/ProductVariant/1004", quantity: 1 },
      ],
      skipped: [{ productId: "rice-paper-floor-lamp", reason: "unmapped" }],
      checkoutPermalink: `https://${PLACEHOLDER_STORE_DOMAIN}/cart/1003:1,1004:1`,
    });
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/shopify-cart.test.ts`
Expected: FAIL — cannot resolve `shopify-cart`.

- [ ] **Step 5: Implement the cart module and runtime context**

`src/features/commerce/shopify-cart.ts`:

```ts
import type { CartApprovalDraft } from "../../webmcp/tool-context";
import type {
  CartLineInput,
  CommerceContext,
  CommerceDraft,
  CommerceLine,
  ShopifyVariantMap,
  SkippedLine,
} from "./commerce-types";
import { validateShopifyVariants, variantNumericId } from "./shopify-variants";

export interface ResolvedLine extends CommerceLine {
  variantId: string;
}

export function resolveShopifyLines(
  items: readonly CartLineInput[],
  map: ShopifyVariantMap,
): { lines: ResolvedLine[]; skipped: SkippedLine[] } {
  const { variants, issues } = validateShopifyVariants(map);
  const invalidProductIds = new Set(issues.map(({ productId }) => productId));
  const lines: ResolvedLine[] = [];
  const linesByGid = new Map<string, ResolvedLine>();
  const skipped: SkippedLine[] = [];
  const skippedProductIds = new Set<string>();

  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) continue;
    const gid = variants[item.productId];
    const variantId = gid === undefined ? null : variantNumericId(gid);
    if (gid === undefined || variantId === null) {
      if (!skippedProductIds.has(item.productId)) {
        skippedProductIds.add(item.productId);
        skipped.push({
          productId: item.productId,
          reason: invalidProductIds.has(item.productId) ? "invalid" : "unmapped",
        });
      }
      continue;
    }
    const existing = linesByGid.get(gid);
    if (existing) {
      existing.quantity += item.quantity;
      continue;
    }
    const line: ResolvedLine = {
      productId: item.productId,
      merchandiseId: gid,
      variantId,
      quantity: item.quantity,
    };
    linesByGid.set(gid, line);
    lines.push(line);
  }

  return { lines, skipped };
}

export function buildCartPermalink(
  storeDomain: string,
  lines: readonly ResolvedLine[],
): string | null {
  if (lines.length === 0) return null;
  const path = lines.map(({ variantId, quantity }) => `${variantId}:${quantity}`).join(",");
  return `https://${storeDomain}/cart/${path}`;
}

export function buildCommerceDraft(
  commerce: CommerceContext,
  items: readonly CartLineInput[],
): CommerceDraft | null {
  if (commerce.config.provider !== "shopify") return null;
  const { lines, skipped } = resolveShopifyLines(items, commerce.variants);
  return {
    provider: "shopify",
    storeDomain: commerce.config.storeDomain,
    mcpEndpoint: commerce.config.mcpEndpoint,
    lines: lines.map(({ productId, merchandiseId, quantity }) => ({
      productId,
      merchandiseId,
      quantity,
    })),
    skipped,
    checkoutPermalink: buildCartPermalink(commerce.config.storeDomain, lines),
  };
}

export function enrichCartDraft(
  commerce: CommerceContext,
  draft: CartApprovalDraft,
): CartApprovalDraft {
  const block = buildCommerceDraft(
    commerce,
    draft.items.map(({ productId, quantity }) => ({ productId, quantity })),
  );
  return block === null ? draft : { ...draft, commerce: block };
}
```

`src/features/commerce/commerce-runtime.ts`:

```ts
import { COMMERCE_CONFIG } from "./commerce-config";
import type { CommerceContext } from "./commerce-types";
import { ACTIVE_SHOPIFY_VARIANTS } from "./shopify-variants";

export const ACTIVE_COMMERCE: CommerceContext = {
  config: COMMERCE_CONFIG,
  variants: ACTIVE_SHOPIFY_VARIANTS,
};
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/shopify-cart.test.ts tests/unit/shopify-variants.test.ts`
Expected: PASS (all).

- [ ] **Step 7: Commit**

```bash
git add src/features/commerce/shopify-cart.ts src/features/commerce/commerce-runtime.ts tests/helpers/commerce-fixtures.ts src/webmcp/tool-context.ts tests/unit/shopify-cart.test.ts
git diff --cached --check
git commit -m "feat(commerce): build Shopify cart lines and permalinks"
```

### Task 4: Tool Context, Handler, and Evals Alignment

**Files:**
- Modify: `src/webmcp/tool-context.ts` (add `commerce: CommerceContext` to `ToolContext`)
- Modify: `src/webmcp/tool-handlers.ts` (`add_scene_to_cart` execute)
- Modify: `src/features/demo/demo-workspace.tsx` (tool context field; optional prop)
- Modify: `tests/unit/webmcp-tools.test.ts`, `tests/unit/register-tools.test.tsx`
- Modify: `tests/evals/webmcp-journeys.json`

**Interfaces:**
- Consumes: `enrichCartDraft`, `ACTIVE_COMMERCE`, `CommerceContext`, test fixtures.
- Produces: `ToolContext.commerce`, `DemoWorkspace` prop `commerce?: CommerceContext` (default `ACTIVE_COMMERCE`), and an `add_scene_to_cart` result whose `draft.commerce` exists only in shopify mode.

- [ ] **Step 1: Write the failing handler tests**

In `tests/unit/webmcp-tools.test.ts`, find the context factory (the object literal containing `openCartApproval: (draft) => {`) and add `commerce: DEMO_COMMERCE` to it, importing `DEMO_COMMERCE` and `SHOPIFY_COMMERCE` from `../helpers/commerce-fixtures`. Give the factory an optional parameter so a test can pass `SHOPIFY_COMMERCE`; if the factory is a plain object, wrap it in `function createContext(commerce = DEMO_COMMERCE)` and update its call sites. Then add:

```ts
describe("add_scene_to_cart commerce block", () => {
  it("omits commerce in demo mode", async () => {
    const { context, drafts } = createContext(DEMO_COMMERCE); // reuse the factory's captured drafts
    // Replace the seed table with the first coffee-table catalog product so the
    // Scene has a product-backed object, exactly as the existing journey does.
    // (Copy the replace_object call already used in this file.)
    const result = await callTool(context, "add_scene_to_cart", {
      expectedRevision: currentRevision(),
      expectedStateVersion: currentStateVersion(),
    });
    expect(result.ok).toBe(true);
    expect("commerce" in result.structuredContent.draft).toBe(false);
    expect("commerce" in drafts[0]).toBe(false);
  });

  it("returns public Shopify lines, skipped products, and the MCP endpoint in shopify mode", async () => {
    const { context, drafts } = createContext(SHOPIFY_COMMERCE);
    // same replacement of the table with "oak-frame-table"
    const result = await callTool(context, "add_scene_to_cart", {
      expectedRevision: currentRevision(),
      expectedStateVersion: currentStateVersion(),
    });
    expect(result.ok).toBe(true);
    expect(result.structuredContent.draft.commerce).toEqual({
      provider: "shopify",
      storeDomain: "nook-placeholder.myshopify.com",
      mcpEndpoint: "https://nook-placeholder.myshopify.com/api/mcp",
      lines: [
        {
          productId: "oak-frame-table",
          merchandiseId: "gid://shopify/ProductVariant/1003",
          quantity: 1,
        },
      ],
      skipped: [],
      checkoutPermalink: "https://nook-placeholder.myshopify.com/cart/1003:1",
    });
    expect(drafts[0].commerce).toEqual(result.structuredContent.draft.commerce);
    expect(JSON.stringify(result)).not.toMatch(/token/i);
  });
});
```

Adapt `callTool`, `currentRevision`, and `currentStateVersion` to the helper names that already exist in the file; the assertions are the requirement, the helper names are not. Also add `commerce: DEMO_COMMERCE` to the context literal in `tests/unit/register-tools.test.tsx`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/webmcp-tools.test.ts tests/unit/register-tools.test.tsx`
Expected: FAIL — TypeScript/`ToolContext` has no `commerce` field and the shopify-mode assertion finds `commerce` undefined.

- [ ] **Step 3: Extend the tool context and handler**

In `src/webmcp/tool-context.ts` extend the type import to `import type { CommerceContext, CommerceDraft } from "../features/commerce/commerce-types";` and add the field:

```ts
export interface ToolContext {
  getScene(): Scene;
  getStateVersion(): number;
  getSelection(): SceneObject | null;
  searchProducts(input: SearchProductsInput): readonly CatalogProduct[];
  resolveProduct(productId: string): CatalogProduct | undefined;
  applyCommand(request: CommandRequest): CommandResult;
  openCartApproval(draft: CartApprovalDraft): void;
  commerce: CommerceContext;
}
```

In `src/webmcp/tool-handlers.ts` import `enrichCartDraft` from `../features/commerce/shopify-cart` and change the tail of the `add_scene_to_cart` execute:

```ts
        const baseDraft = draftFor(snapshot.scene, objects);
        if (baseDraft.items.length === 0) {
          return toolError(
            "add_scene_to_cart",
            snapshot.scene.revision,
            snapshot.stateVersion,
            "NO_CART_ITEMS",
            "No eligible product-backed Scene objects are available.",
            false,
          );
        }
        const draft = enrichCartDraft(context.commerce, baseDraft);
        signal.throwIfAborted();
        context.openCartApproval(draft);
        return toolSuccess(
          "add_scene_to_cart",
          snapshot.scene.revision,
          snapshot.stateVersion,
          { draft },
          "Cart approval is ready.",
        );
```

In `src/features/demo/demo-workspace.tsx` add a prop and pass it through:

```tsx
import { ACTIVE_COMMERCE } from "../commerce/commerce-runtime";
import type { CommerceContext } from "../commerce/commerce-types";

interface DemoWorkspaceProps {
  commerce?: CommerceContext;
}

export function DemoWorkspace({ commerce = ACTIVE_COMMERCE }: DemoWorkspaceProps = {}) {
  // …existing body…
  const toolContext = useMemo<ToolContext>(
    () => ({
      // …existing fields…
      commerce,
    }),
    [/* existing deps */, commerce],
  );
```

Keep `app/demo/page.tsx` rendering `<DemoWorkspace />` unchanged.

- [ ] **Step 4: Add the evals journey**

Append to `tests/evals/webmcp-journeys.json`:

```json
  {
    "id": "cart-approval-shopify-lines",
    "prompt": "Add the product-backed scene objects to the cart, then create the Shopify cart through the store's MCP server",
    "expectedTools": ["add_scene_to_cart"],
    "assertions": [
      "In shopify mode the draft carries commerce.lines with merchandiseId and quantity plus commerce.mcpEndpoint",
      "Unmapped products appear in commerce.skipped and are not sent anywhere",
      "Nook makes no external request; the agent calls update_cart and get_cart on the store MCP itself"
    ]
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/webmcp-tools.test.ts tests/unit/register-tools.test.tsx tests/unit/tool-contracts.test.ts tests/unit/demo-workspace.test.tsx`
Expected: PASS (all, including every pre-existing demo-mode assertion).

- [ ] **Step 6: Commit**

```bash
git add src/webmcp/tool-context.ts src/webmcp/tool-handlers.ts src/features/demo/demo-workspace.tsx tests/unit/webmcp-tools.test.ts tests/unit/register-tools.test.tsx tests/evals/webmcp-journeys.json
git diff --cached --check
git commit -m "feat(webmcp): expose Shopify lines in cart approval drafts"
```

### Task 5: Approval Sheet Shopify Mode

**Files:**
- Modify: `src/features/demo/demo-types.ts`, `src/features/demo/demo-state.ts`
- Modify: `src/features/demo/cart-approval-sheet.tsx`
- Modify: `src/features/demo/demo-workspace.tsx` (pass `commerce` to the sheet)
- Modify: `src/features/demo/demo-workspace.module.css`
- Test: `tests/unit/demo-state.test.ts` (extend), `tests/unit/cart-approval-sheet.test.tsx` (new)

**Interfaces:**
- Consumes: `buildCommerceDraft`, `CommerceContext`, `CommerceDraft`, `CART_ITEMS`, fixtures.
- Produces: `DemoAction` `{ type: "open-external-checkout"; itemCount: number }`; `CartApprovalSheet` props `commerce: CommerceContext` and `openWindow?: (url: string) => Window | null`; exported `openInNewTab(url)`.

- [ ] **Step 1: Write the failing reducer test**

Append to `tests/unit/demo-state.test.ts`:

```ts
it("closes the cart and announces an external checkout", () => {
  const opened = demoReducer(createInitialDemoState(), { type: "open-cart" });
  const closed = demoReducer(opened, { type: "open-external-checkout", itemCount: 2 });
  expect(closed.isCartOpen).toBe(false);
  expect(closed.cartDraft).toBeNull();
  expect(closed.announcement).toBe("Opened Shopify checkout in a new tab (2 items)");
  expect(
    demoReducer(opened, { type: "open-external-checkout", itemCount: 1 }).announcement,
  ).toBe("Opened Shopify checkout in a new tab (1 item)");
});
```

- [ ] **Step 2: Write the failing sheet component tests**

`tests/unit/cart-approval-sheet.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CartApprovalSheet } from "../../src/features/demo/cart-approval-sheet";
import type { CartApprovalDraft } from "../../src/webmcp/tool-context";
import {
  DEMO_COMMERCE,
  PLACEHOLDER_STORE_DOMAIN,
  SHOPIFY_COMMERCE,
} from "../helpers/commerce-fixtures";

const PERMALINK = `https://${PLACEHOLDER_STORE_DOMAIN}/cart/1001:1,1002:1`;

function agentDraft(): CartApprovalDraft {
  return {
    id: "scene-demo-rev-4",
    sceneId: "demo",
    sceneRevision: 4,
    items: [
      {
        objectId: "table_01",
        productId: "oak-frame-table",
        variantId: "demo-variant-oak-frame-table",
        title: "Oak Frame Table",
        quantity: 1,
        price: { amountMinor: 16900, currency: "USD" },
      },
      {
        objectId: "lamp_01",
        productId: "rice-paper-floor-lamp",
        variantId: "demo-variant-rice-paper-floor-lamp",
        title: "Rice Paper Floor Lamp",
        quantity: 1,
        price: { amountMinor: 14900, currency: "USD" },
      },
    ],
    totalMinor: 31800,
    commerce: {
      provider: "shopify",
      storeDomain: PLACEHOLDER_STORE_DOMAIN,
      mcpEndpoint: `https://${PLACEHOLDER_STORE_DOMAIN}/api/mcp`,
      lines: [
        { productId: "oak-frame-table", merchandiseId: "gid://shopify/ProductVariant/1003", quantity: 1 },
      ],
      skipped: [{ productId: "rice-paper-floor-lamp", reason: "unmapped" }],
      checkoutPermalink: `https://${PLACEHOLDER_STORE_DOMAIN}/cart/1003:1`,
    },
  };
}

describe("CartApprovalSheet in demo mode", () => {
  it("keeps the fixture cart demo-only", () => {
    const dispatch = vi.fn();
    render(<CartApprovalSheet commerce={DEMO_COMMERCE} dispatch={dispatch} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue to Shopify · $626" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "confirm-demo-cart" });
    expect(screen.queryByText("Not mapped to a Shopify variant")).toBeNull();
  });
});

describe("CartApprovalSheet in shopify mode", () => {
  it("opens the fixture permalink in a new tab and announces it", () => {
    const dispatch = vi.fn();
    const openWindow = vi.fn(() => ({ opener: {} }) as unknown as Window);
    render(
      <CartApprovalSheet commerce={SHOPIFY_COMMERCE} dispatch={dispatch} openWindow={openWindow} />,
    );
    expect(screen.getByText(PLACEHOLDER_STORE_DOMAIN, { exact: false })).toBeVisible();
    expect(screen.getAllByText("Not mapped to a Shopify variant")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Continue to Shopify · $438" }));
    expect(openWindow).toHaveBeenCalledWith(PERMALINK);
    expect(dispatch).toHaveBeenCalledWith({ type: "open-external-checkout", itemCount: 2 });
  });

  it("shows a fallback link when the popup is blocked", () => {
    const dispatch = vi.fn();
    const openWindow = vi.fn(() => null);
    render(
      <CartApprovalSheet commerce={SHOPIFY_COMMERCE} dispatch={dispatch} openWindow={openWindow} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue to Shopify · $438" }));
    const link = screen.getByRole("link", { name: "Open Shopify checkout" });
    expect(link).toHaveAttribute("href", PERMALINK);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "open-external-checkout" }));
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("uses the agent draft's commerce block and skips unmapped items", () => {
    const dispatch = vi.fn();
    const openWindow = vi.fn(() => ({ opener: {} }) as unknown as Window);
    render(
      <CartApprovalSheet
        commerce={SHOPIFY_COMMERCE}
        dispatch={dispatch}
        draft={agentDraft()}
        openWindow={openWindow}
      />,
    );
    expect(screen.getByText("Rice Paper Floor Lamp").closest("li")).toHaveTextContent(
      "Not mapped to a Shopify variant",
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue to Shopify · $169" }));
    expect(openWindow).toHaveBeenCalledWith(`https://${PLACEHOLDER_STORE_DOMAIN}/cart/1003:1`);
    expect(dispatch).toHaveBeenCalledWith({ type: "open-external-checkout", itemCount: 1 });
  });

  it("disables checkout when nothing is mapped", () => {
    const dispatch = vi.fn();
    const draft = { ...agentDraft(), commerce: { ...agentDraft().commerce!, lines: [], checkoutPermalink: null, skipped: [
      { productId: "oak-frame-table", reason: "unmapped" as const },
      { productId: "rice-paper-floor-lamp", reason: "unmapped" as const },
    ] } };
    render(<CartApprovalSheet commerce={SHOPIFY_COMMERCE} dispatch={dispatch} draft={draft} />);
    expect(screen.getByRole("button", { name: "Continue to Shopify · $0" })).toBeDisabled();
    expect(screen.getByText("No item in this cart is mapped to a Shopify variant yet.")).toBeVisible();
  });
});
```

The demo fixture total in shopify mode is the mapped subtotal: coffee-table 18900 + rug 24900 = 43800 → `$438`; the agent draft's mapped subtotal is 16900 → `$169`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/demo-state.test.ts tests/unit/cart-approval-sheet.test.tsx`
Expected: FAIL — unknown action type and missing `commerce`/`openWindow` props.

- [ ] **Step 4: Add the reducer action**

`src/features/demo/demo-types.ts` — add to `DemoAction`:

```ts
  | { type: "open-external-checkout"; itemCount: number }
```

`src/features/demo/demo-state.ts` — add the case:

```ts
    case "open-external-checkout":
      return {
        ...state,
        isCartOpen: false,
        cartDraft: null,
        announcement: `Opened Shopify checkout in a new tab (${action.itemCount} item${action.itemCount === 1 ? "" : "s"})`,
      };
```

- [ ] **Step 5: Implement the Shopify-mode sheet**

Read `node_modules/next/dist/docs/01-app/02-guides/environment-variables.md` and the CSS Modules guide first. Then in `src/features/demo/cart-approval-sheet.tsx`:

```tsx
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
} from "react";
import { CART_ITEMS } from "./demo-data";
import type { DemoAction } from "./demo-types";
import { NookIcon } from "./nook-icon";
import styles from "./demo-workspace.module.css";
import type { CartApprovalDraft } from "../../webmcp/tool-context";
import type { CommerceContext, CommerceDraft } from "../commerce/commerce-types";
import { buildCommerceDraft } from "../commerce/shopify-cart";

interface CartApprovalSheetProps {
  commerce: CommerceContext;
  dispatch: Dispatch<DemoAction>;
  draft?: CartApprovalDraft | null;
  openWindow?: (url: string) => Window | null;
}

export function openInNewTab(url: string): Window | null {
  const opened = window.open(url, "_blank");
  if (opened) opened.opener = null;
  return opened;
}

function formatPrice(priceMinor: number) {
  return `$${Math.round(priceMinor / 100).toLocaleString("en-US")}`;
}

const CART_TOTAL_MINOR = CART_ITEMS.reduce((total, item) => total + item.priceMinor, 0);

interface SheetLine {
  key: string;
  productId: string;
  title: string;
  detail: string;
  priceMinor: number;
}

export function CartApprovalSheet({
  commerce,
  dispatch,
  draft,
  openWindow = openInNewTab,
}: CartApprovalSheetProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);
  const isShopify = commerce.config.provider === "shopify";

  const lines = useMemo<SheetLine[]>(
    () =>
      draft
        ? draft.items.map((item) => ({
            key: item.objectId,
            productId: item.productId,
            title: item.title,
            detail: `Qty ${item.quantity} · Scene product`,
            priceMinor: item.price.amountMinor,
          }))
        : CART_ITEMS.map((item) => ({
            key: item.id,
            productId: item.id,
            title: item.name,
            detail: "Qty 1 · Demo fixture",
            priceMinor: item.priceMinor,
          })),
    [draft],
  );

  const commerceDraft = useMemo<CommerceDraft | null>(() => {
    if (!isShopify) return null;
    if (draft) return draft.commerce ?? null;
    return buildCommerceDraft(
      commerce,
      CART_ITEMS.map(({ id }) => ({ productId: id, quantity: 1 })),
    );
  }, [commerce, draft, isShopify]);

  const mappedProductIds = useMemo(
    () => new Set(commerceDraft?.lines.map(({ productId }) => productId) ?? []),
    [commerceDraft],
  );
  const skippedProductIds = useMemo(
    () => new Set(commerceDraft?.skipped.map(({ productId }) => productId) ?? []),
    [commerceDraft],
  );

  const totalMinor = isShopify
    ? lines
        .filter(({ productId }) => mappedProductIds.has(productId))
        .reduce((total, line) => total + line.priceMinor, 0)
    : (draft?.totalMinor ?? CART_TOTAL_MINOR);
  const total = formatPrice(totalMinor);
  const checkoutUrl = commerceDraft?.checkoutPermalink ?? null;
  const canCheckout = isShopify && checkoutUrl !== null;

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    // …unchanged focus trap…
  }

  function handleContinue() {
    if (!isShopify) {
      dispatch({ type: "confirm-demo-cart" });
      return;
    }
    if (!commerceDraft || checkoutUrl === null) return;
    const opened = openWindow(checkoutUrl);
    if (opened === null) {
      setBlockedUrl(checkoutUrl);
      return;
    }
    dispatch({ type: "open-external-checkout", itemCount: commerceDraft.lines.length });
  }

  const storeDomain = commerce.config.provider === "shopify" ? commerce.config.storeDomain : null;
  const buttonLabel = draft && !isShopify ? "Approve Scene cart" : "Continue to Shopify";

  return (
    <div className={styles.sheetLayer}>
      <div className={styles.sheetScrim} aria-hidden="true" />
      <aside aria-labelledby="cart-sheet-title" aria-modal="true" className={styles.cartSheet} onKeyDown={handleKeyDown} role="dialog">
        <header className={styles.sheetHeader}>{/* unchanged */}</header>

        <p className={styles.sheetIntro}>
          {isShopify && storeDomain
            ? `Approving opens Shopify checkout for ${storeDomain} in a new tab. Nook sends nothing itself.`
            : draft
              ? `Nook has prepared ${draft.items.length} Scene item${draft.items.length === 1 ? "" : "s"} from Scene revision ${draft.sceneRevision} for your approval. Nothing has been sent to Shopify.`
              : "Nook has prepared these four fixtures for your approval. Nothing has been sent to Shopify."}
        </p>

        <ul className={styles.cartItems}>
          {lines.map((line, index) => (
            <li key={line.key}>
              <span className={styles.cartThumbnail} aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className={styles.cartItemCopy}>
                <strong>{line.title}</strong>
                <small>{line.detail}</small>
                {isShopify && skippedProductIds.has(line.productId) ? (
                  <small className={styles.cartSkipped}>Not mapped to a Shopify variant</small>
                ) : null}
              </span>
              <strong>{formatPrice(line.priceMinor)}</strong>
            </li>
          ))}
        </ul>

        <div className={styles.cartTotal}>
          <span>
            <strong>Estimated total</strong>
            <small>{isShopify ? "Mapped items only · taxes and delivery calculated by Shopify" : "Taxes and delivery calculated later"}</small>
          </span>
          <strong>{total} USD</strong>
        </div>

        <div className={styles.sheetDisclosure}>
          <span aria-hidden="true">i</span>
          <p>
            {isShopify && storeDomain
              ? `Checkout opens on ${storeDomain} in a new tab. Nook stores no Shopify credentials and makes no request of its own.`
              : "UI-only approval. Continuing closes this sheet and creates no external cart or network request."}
          </p>
        </div>

        {isShopify && !canCheckout ? (
          <p className={styles.sheetNotice} role="status">
            No item in this cart is mapped to a Shopify variant yet.
          </p>
        ) : null}

        {blockedUrl ? (
          <p className={styles.sheetNotice} role="status">
            Your browser blocked the new tab.{" "}
            <a href={blockedUrl} rel="noopener noreferrer" target="_blank">
              Open Shopify checkout
            </a>
          </p>
        ) : null}

        <div className={styles.sheetActions}>
          <button
            aria-label={`${buttonLabel} · ${total}`}
            className={styles.commerceButton}
            disabled={isShopify && !canCheckout}
            onClick={handleContinue}
            type="button"
          >
            <span>{buttonLabel}</span>
            <strong>{total}</strong>
          </button>
          <button className={styles.cancelButton} onClick={() => dispatch({ type: "close-cart" })} type="button">
            Keep editing
          </button>
        </div>
      </aside>
    </div>
  );
}
```

Demo-mode labels stay exactly `Continue to Shopify · $626` (fixture) and `Approve Scene cart · $<total>` (agent draft). Add to `demo-workspace.module.css` (next to `.sheetDisclosure`):

```css
.cartSkipped {
  color: var(--color-warning, #8a5a00);
}

.sheetNotice {
  margin: 0 0 12px;
  font-size: 0.875rem;
  line-height: 1.4;
}

.sheetNotice a {
  text-decoration: underline;
}
```

Use existing CSS variables from the module for colors if a warning tone exists; otherwise the literal fallback above is acceptable. In `src/features/demo/demo-workspace.tsx` pass the context:

```tsx
<CartApprovalSheet commerce={commerce} dispatch={routeAction} draft={state.cartDraft} />
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/demo-state.test.ts tests/unit/cart-approval-sheet.test.tsx tests/unit/demo-workspace.test.tsx`
Expected: PASS, including the pre-existing `Continue to Shopify · $626` and `Demo only — no external cart was created.` assertions.

- [ ] **Step 7: Commit**

```bash
git add src/features/demo/demo-types.ts src/features/demo/demo-state.ts src/features/demo/cart-approval-sheet.tsx src/features/demo/demo-workspace.tsx src/features/demo/demo-workspace.module.css tests/unit/demo-state.test.ts tests/unit/cart-approval-sheet.test.tsx
git diff --cached --check
git commit -m "feat(demo): open Shopify checkout from cart approval"
```

### Task 6: Shopify-Mode Browser Journey

**Files:**
- Create: `playwright.commerce.config.ts`
- Create: `tests/e2e/commerce/shopify-checkout.spec.ts`
- Modify: `playwright.config.ts` (add `testIgnore: ["**/commerce/**"]`)
- Modify: `package.json` (add script `"test:e2e:commerce": "playwright test --config=playwright.commerce.config.ts"`)

**Interfaces:**
- Consumes: the running app in shopify mode with placeholder domain `nook-placeholder.myshopify.com` and `NEXT_PUBLIC_SHOPIFY_VARIANTS=coffee-table=gid://shopify/ProductVariant/1001,rug=gid://shopify/ProductVariant/1002,oak-frame-table=gid://shopify/ProductVariant/1003`.
- Produces: `pnpm run test:e2e:commerce`.

- [ ] **Step 1: Write the commerce Playwright config**

`playwright.commerce.config.ts`:

```ts
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
      NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: "nook-placeholder.myshopify.com",
      NEXT_PUBLIC_SHOPIFY_VARIANTS:
        "coffee-table=gid://shopify/ProductVariant/1001,rug=gid://shopify/ProductVariant/1002,oak-frame-table=gid://shopify/ProductVariant/1003",
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
```

In `playwright.config.ts` add `testIgnore: ["**/commerce/**"]` beside `testDir`. In `package.json` scripts add `"test:e2e:commerce": "playwright test --config=playwright.commerce.config.ts"`.

- [ ] **Step 2: Write the failing journey**

`tests/e2e/commerce/shopify-checkout.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";

const STORE = "nook-placeholder.myshopify.com";

interface CapturedTool {
  name: string;
  execute(input: unknown, options: { signal: AbortSignal }): Promise<unknown>;
}

declare global {
  interface Window {
    __commerceTools: Record<string, CapturedTool>;
  }
}

async function captureModelContextTools(page: Page) {
  await page.addInitScript(() => {
    window.__commerceTools = {};
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        async registerTool(tool: CapturedTool) {
          window.__commerceTools[tool.name] = tool;
        },
      },
    });
  });
}

async function callTool(page: Page, name: string, input: unknown) {
  return page.evaluate(
    async ({ toolName, toolInput }) => {
      const tool = window.__commerceTools[toolName];
      if (!tool) throw new Error(`Missing captured tool ${toolName}`);
      return tool.execute(toolInput, { signal: new AbortController().signal });
    },
    { toolName: name, toolInput: input },
  );
}

test("opens a Shopify cart permalink in a new tab without any request from Nook", async ({
  context,
  page,
}) => {
  const storeRequests: string[] = [];
  const foreignRequests: string[] = [];
  await context.route(`https://${STORE}/**`, (route) => {
    storeRequests.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "text/html", body: "<title>stub</title>" });
  });
  context.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith("http://127.0.0.1:3001") && !url.startsWith(`https://${STORE}`)) {
      foreignRequests.push(url);
    }
  });
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") consoleErrors.push(message.text());
  });

  await page.goto("/demo");
  await page.getByRole("button", { name: "View cart" }).click();
  const dialog = page.getByRole("dialog", { name: "Review your room" });
  await expect(dialog.getByText(STORE, { exact: false })).toBeVisible();
  await expect(dialog.getByText("Not mapped to a Shopify variant")).toHaveCount(2);

  const [popup] = await Promise.all([
    context.waitForEvent("page"),
    dialog.getByRole("button", { name: "Continue to Shopify · $438" }).click(),
  ]);
  await popup.waitForLoadState();
  expect(popup.url()).toBe(`https://${STORE}/cart/1001:1,1002:1`);
  await expect(page.getByRole("status").filter({ hasText: "Opened Shopify checkout in a new tab (2 items)" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  expect(storeRequests).toEqual([`https://${STORE}/cart/1001:1,1002:1`]);
  expect(foreignRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("returns Shopify lines and the store MCP endpoint from add_scene_to_cart", async ({ page }) => {
  await captureModelContextTools(page);
  await page.goto("/demo");
  await expect.poll(() => page.evaluate(() => Object.keys(window.__commerceTools).length)).toBe(6);

  const scene = (await callTool(page, "get_scene", {})) as {
    structuredContent: { data: { revision: number; objects: Array<{ id: string; type: string }> }; stateVersion: number };
  };
  const table = scene.structuredContent.data.objects.find(({ type }) => type === "coffee_table");
  if (!table) throw new Error("seed has no coffee table");

  const replaced = (await callTool(page, "replace_object", {
    objectId: table.id,
    productId: "oak-frame-table",
    expectedRevision: scene.structuredContent.data.revision,
    expectedStateVersion: scene.structuredContent.stateVersion,
  })) as { ok: boolean; structuredContent: { sceneRevision: number; stateVersion: number } };
  expect(replaced.ok).toBe(true);

  const cart = (await callTool(page, "add_scene_to_cart", {
    expectedRevision: replaced.structuredContent.sceneRevision,
    expectedStateVersion: replaced.structuredContent.stateVersion,
  })) as { ok: boolean; structuredContent: { draft: { commerce?: unknown } } };
  expect(cart.ok).toBe(true);
  expect(cart.structuredContent.draft.commerce).toEqual({
    provider: "shopify",
    storeDomain: STORE,
    mcpEndpoint: `https://${STORE}/api/mcp`,
    lines: [{ productId: "oak-frame-table", merchandiseId: "gid://shopify/ProductVariant/1003", quantity: 1 }],
    skipped: [],
    checkoutPermalink: `https://${STORE}/cart/1003:1`,
  });
  await expect(page.getByRole("dialog", { name: "Review your room" })).toBeVisible();
});
```

Check the exact input field names of `replace_object` and `add_scene_to_cart` in `src/webmcp/tool-contracts.ts` and the result field names in `tests/e2e/photo-compositor.spec.ts` before running; adjust the literal keys to the real contract, never the assertions on the `commerce` block.

- [ ] **Step 3: Run the journey to verify it fails**

Run: `pnpm run test:e2e:commerce`
Expected: FAIL only if Tasks 1-5 are incomplete on this branch; on a complete branch it must PASS (2 tests). Record whichever happened and why. Also run `pnpm run test:e2e` to confirm the demo-mode suite still ignores the commerce directory and passes (10 tests).

- [ ] **Step 4: Commit**

```bash
git add playwright.commerce.config.ts playwright.config.ts package.json tests/e2e/commerce/shopify-checkout.spec.ts
git diff --cached --check
git commit -m "test(commerce): verify Shopify checkout journey"
```

### Task 7: Operator Documentation and Full Gate

**Files:**
- Modify: `README.md`, `AGENTS.md`

**Interfaces:**
- Consumes: everything above.
- Produces: operator instructions and a green full matrix.

- [ ] **Step 1: Document the integration in README**

Replace the `## Environment variables` section of `README.md` with:

```markdown
## Environment variables

Copy `.env.example` to `.env.local` and set only what you need. Every variable is
public and inlined at build time (`NEXT_PUBLIC_*`), so rebuild after changing
one. Nook never needs a Shopify access token.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_COMMERCE_PROVIDER` | `demo` | `demo` keeps cart approval local with zero requests; `shopify` enables checkout on your store. |
| `NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN` | empty | Bare store host such as `your-store.myshopify.com`. Required in `shopify` mode; invalid or missing values fall back to demo mode with a reason shown in the approval sheet. |
| `NEXT_PUBLIC_SHOPIFY_VARIANTS` | empty | Optional comma-separated `productId=gid://shopify/ProductVariant/<id>` pairs that override `src/features/commerce/shopify-variants.ts`. |
| `ASSET_PROVIDER` | `cached` | Assets are cached; no live generation exists. |

## Commerce integration

Nook has no backend and stores no credentials. Two paths use one static mapping
from demo product ids to Shopify variant GIDs:

1. **Human checkout.** In `shopify` mode, `Continue to Shopify` in the approval
   sheet opens a cart permalink (`https://<store>/cart/<variantId>:<qty>,...`)
   in a new tab. Products without a mapping are listed as
   `Not mapped to a Shopify variant` and left out; if nothing is mapped the
   button is disabled.
2. **Agent checkout.** `add_scene_to_cart` returns `draft.commerce` with
   `lines` (`productId`, `merchandiseId`, `quantity`), `skipped`,
   `checkoutPermalink`, and `mcpEndpoint` (`https://<store>/api/mcp`). Connect
   Claude, ChatGPT, or any MCP client to that endpoint (Shopify's Storefront MCP
   needs no authentication), let it call `update_cart` with the returned
   `merchandise_id` lines, then `get_cart` for the checkout URL. Nook itself
   makes no request.

Setup:

1. Find each product's variant GID in Shopify admin (Products → variant →
   the id in the URL, or the Storefront MCP `search_catalog` tool) and record
   it in `src/features/commerce/shopify-variants.ts` or
   `NEXT_PUBLIC_SHOPIFY_VARIANTS`.
2. Set `NEXT_PUBLIC_COMMERCE_PROVIDER=shopify` and
   `NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN=<your-store>.myshopify.com`, then rebuild.
3. Run `pnpm run test:e2e:commerce` to exercise the Shopify-mode journey against
   a placeholder store; it stubs the store domain and makes no real request.

Demo mode remains the default and is byte-for-byte unchanged.
```

Also update the README sentence that says Shopify integration "remain future work" so it reads that checkout is available through cart permalinks and the Storefront MCP, with no server or token.

- [ ] **Step 2: Add the repository rule to AGENTS.md**

Append under `## Repository workflow`:

```markdown
- Commerce stays token-free and server-free: `demo` is the default, Shopify works only through cart permalinks and the store's Storefront MCP endpoint, and no access token, server cart route, or external request may be added without a new approved spec. When the `commerce` block of `add_scene_to_cart` changes, update `tool-context.ts`, `tool-handlers.ts`, the unit tests, and `tests/evals/webmcp-journeys.json` together.
```

- [ ] **Step 3: Run the full gate**

Run each separately and record counts and exit codes:

```bash
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run test:e2e
pnpm run test:e2e:commerce
pnpm run build
pnpm run build:next
git diff --check
git status --short
```

Expected: every command exits 0; `pnpm run test:e2e` still reports 10 tests; the commerce suite reports 2; both builds succeed with the known vinext `punycode`/route notices only.

- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md
git diff --cached --check
git commit -m "docs(commerce): document token-free Shopify checkout"
```
