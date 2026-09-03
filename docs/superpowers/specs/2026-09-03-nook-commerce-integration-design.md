# Nook Commerce Integration Design

**Date:** 2026-09-03

**Status:** Approved in chat on 2026-09-03 (user chose Shopify without credentials,
new-tab checkout, static variant mapping, and no separate backend).

**Depends on:** WebMCP Core 6 (`2026-09-01-nook-webmcp-core-spec.md`) and the
photo compositor / natural placement work merged into `main` at `21a80e9`.

## 1. Outcome

A person who approves a Scene cart in Nook reaches a real Shopify checkout, and an
AI app that talks to the store's own MCP server can build the same cart from the
data Nook already returns. Nook itself keeps **no credentials, no server route,
and no external request** other than the top-level navigation a person triggers.

Two paths use the same static product-to-variant mapping:

- **Human path:** the approval sheet's `Continue to Shopify` opens a Shopify
  cart permalink (`https://{store}/cart/{variantId}:{qty},...`) in a new tab.
- **Agent path:** `add_scene_to_cart` returns an optional `commerce` block with
  Shopify `merchandiseId` lines and the store's Storefront MCP endpoint
  (`https://{store}/api/mcp`, no authentication), so Claude, ChatGPT, or any MCP
  client connected to that store can call `update_cart` / `get_cart` itself.

## 2. Invariants

- WebMCP remains exactly the Core 6. `add_scene_to_cart` still only opens the
  local approval sheet and performs no network request.
- Demo mode is the default and is byte-for-byte the current behavior: no
  `commerce` block, `Demo only — no external cart was created.` on approval,
  zero requests.
- Nook stores no Shopify token. Only public, build-time values exist:
  `NEXT_PUBLIC_COMMERCE_PROVIDER`, `NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN`, and the
  optional `NEXT_PUBLIC_SHOPIFY_VARIANTS` mapping override.
- Invalid or missing Shopify configuration fails closed to demo mode with a
  visible reason in the sheet; it never throws at runtime or build time.
- No product is sent to Shopify without a registered variant mapping. Unmapped
  products are excluded and listed; a cart with zero mapped lines cannot open.
- Static export, vinext/Cloudflare build, and the existing privacy E2E
  assertions (zero fetch, zero cross-origin requests during demo approval) stay
  intact.

## 3. Non-goals

Server cart routes, Storefront API tokens, order status, inventory/price sync
from Shopify, discounts, multi-currency, the local MCP companion, and the hybrid
renderer are out of scope.

## 4. Configuration

`src/features/commerce/commerce-config.ts` parses the two public variables once
at module load with Zod and exports a `CommerceConfig`:

```ts
type CommerceConfig =
  | { provider: "demo"; reason: "default" | "not-configured" | "invalid-domain" }
  | { provider: "shopify"; storeDomain: string; mcpEndpoint: string };
```

- `NEXT_PUBLIC_COMMERCE_PROVIDER`: `demo` (default) or `shopify`.
- `NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN`: bare host such as
  `your-store.myshopify.com` (or a custom domain). Scheme, path, and whitespace
  are rejected as `invalid-domain`.
- `mcpEndpoint` is derived: `https://{storeDomain}/api/mcp`.

`.env.example` documents both with safe defaults and comments. Values are inlined
at build time, so changing them requires a rebuild; the README says so.

## 5. Variant mapping

`src/features/commerce/shopify-variants.ts` exports
`SHOPIFY_VARIANTS: Readonly<Record<string, string | null>>` keyed by demo product
id (all 24 catalog products plus the human fixture cart's product ids), with
`null` meaning "not mapped yet". Operators may also supply or override entries
without editing source through `NEXT_PUBLIC_SHOPIFY_VARIANTS`, a comma-separated
list of `productId=gid://shopify/ProductVariant/<digits>` pairs merged over the
file at build time. A validator rejects any value that is not
`gid://shopify/ProductVariant/<digits>` and any duplicate GID, returning typed
issues the tests assert; production paths never throw and treat products with
issues as skipped with reason `invalid`.

## 6. Permalink and draft enrichment

`src/features/commerce/shopify-cart.ts` owns pure functions:

- `resolveShopifyLines(items)` → `{ lines: Array<{ productId, merchandiseId,
  variantId, quantity }>, skipped: Array<{ productId, reason: "unmapped" }> }`.
  Quantities aggregate per variant in first-appearance order.
- `buildCartPermalink(storeDomain, lines)` → `https://{storeDomain}/cart/{variantId}:{qty}[,...]`,
  or `null` when there are no lines. No query parameters.
- `enrichCartDraft(config, draft)` → the draft unchanged in demo mode, or the
  draft plus `commerce`:

```ts
interface CommerceDraft {
  provider: "shopify";
  storeDomain: string;
  mcpEndpoint: string;
  lines: Array<{ productId: string; merchandiseId: string; quantity: number }>;
  skipped: Array<{ productId: string; reason: "unmapped" | "invalid" }>;
  checkoutPermalink: string | null;
}
```

The `add_scene_to_cart` handler applies `enrichCartDraft` through its tool
context before opening the sheet; the tool contract's `draft` schema gains the
optional `commerce` field, and `tests/evals/webmcp-journeys.json` gains a journey
for it. The human fixture cart is enriched by the same function when the header
cart opens.

## 7. Approval sheet behavior

- Demo mode: unchanged.
- Shopify mode with at least one mapped line: the primary button reads
  `Continue to Shopify · $<subtotal of mapped lines>`. On click, Nook calls
  `window.open(permalink, "_blank", "noopener,noreferrer")`; on success it closes
  the sheet and announces `Opened Shopify checkout in a new tab (N items)`. If
  the browser blocks the popup, the sheet stays open and shows an anchor
  `Open Shopify checkout` (`target="_blank" rel="noopener noreferrer"`).
- Shopify mode with zero mapped lines: the primary button is disabled and the
  sheet explains that no product is mapped to a Shopify variant.
- Skipped products are listed under the items with `Not mapped to a Shopify
  variant`. The sheet shows the store domain so the operator can confirm the
  target store.
- Focus, dialog semantics, and layout stability at 1440x900 and 1280x800 remain.

## 8. Privacy and security

- Nook never sends product, Scene, or prompt data to Shopify; the only external
  action is the person's own new-tab navigation to the store.
- No secret exists in the repository, bundle, or environment example.
- The agent path exposes only public product identifiers already visible on the
  store; the AI app's own tool-approval UX governs the cart write it performs.

## 9. Documentation

- `.env.example` with the three variables and an `ASSET_PROVIDER=cached` line the
  README already references.
- README: a `Commerce integration` section covering modes, environment
  variables, variant mapping steps, the human checkout flow, connecting
  Claude/ChatGPT to `https://{store}/api/mcp` and the `update_cart` → `get_cart`
  flow, and the no-token guarantee.
- AGENTS.md: one rule that commerce stays token-free and server-free unless a
  new approved spec says otherwise, and that `commerce` contract changes keep
  contracts, handlers, tests, and evals aligned.

## 10. Verification

- Unit: config parsing (defaults, invalid domain, missing domain, provider
  values), variant validation (format, duplicates, null), line resolution and
  aggregation, permalink construction, draft enrichment in both modes, tool
  contract/handler/evals alignment, sheet component states (demo unchanged,
  shopify success, popup blocked, zero mapped lines, skipped list).
- E2E: existing demo journeys unchanged. A second Playwright config
  (`playwright.commerce.config.ts`, dev server on port 3001) sets
  `NEXT_PUBLIC_COMMERCE_PROVIDER=shopify`, a placeholder domain, and placeholder
  variant GIDs through `NEXT_PUBLIC_SHOPIFY_VARIANTS`, stubs every request to
  that domain at the browser-context level, and asserts the new tab's URL, the
  announcement, and that no real external request left the browser.
- Full gate: `pnpm test`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run
  test:e2e`, and `pnpm run build`/`pnpm run build:next` because the config is
  build-time inlined.

## 11. Acceptance criteria

- Demo mode is unchanged in behavior, tool results, and tests.
- Shopify mode opens a correct permalink for mapped products and excludes
  unmapped ones visibly.
- `add_scene_to_cart` returns the `commerce` block only in Shopify mode, with
  merchandise ids and the MCP endpoint, and its contract, handler, unit tests,
  and evals agree.
- No token, server route, or external fetch exists in the implementation.
- README, `.env.example`, and AGENTS.md document the modes and operator steps.
