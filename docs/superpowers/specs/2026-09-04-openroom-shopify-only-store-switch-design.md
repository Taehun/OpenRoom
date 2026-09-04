# OpenRoom: Shopify-only commerce with a switchable store

Date: 2026-09-04
Status: approved design, not yet implemented

## Problem

OpenRoom ships two commerce providers. `demo` is the default: it opens a local
approval sheet, orders nothing, and says so. `shopify` is opt-in through three
`NEXT_PUBLIC_*` variables inlined at build time, and it turns the same sheet
into a cart permalink handoff.

The deployment is moving to Shopify permanently, against the seeded sample
store. That makes `demo` dead weight in the product — a mode nobody will run —
while still costing a branch in every commerce code path, a second string in
every piece of UI copy, and an assertion in every test that touches the
approval sheet.

Separately, the store is fixed at build time. Switching the demo to another
seeded store means editing an environment variable and rebuilding, which is not
something a person can do while presenting.

## Goals

- Remove the `demo` commerce provider. Shopify is the only provider.
- Let a presenter switch the connected store from the running page, and
  remember the choice on that browser.
- Validate what the presenter types, and say precisely what is wrong when it
  does not hold.
- Keep the deployment a static front end: no server, no credential, no request
  from OpenRoom to any store.

## Non-goals

- The `/demo` route, the room editor under `src/features/demo/`, and the 43
  `DEMO_PRODUCTS` stay exactly as they are. Only the commerce provider is
  removed; "demo" as a word in routes and directories is out of scope.
- No runtime catalog. Products still come from `DEMO_PRODUCTS`; the store is
  not queried for what it sells.
- No proof that a typed store exists. See "What validation cannot do".

## 1. Configuration model

`CommerceConfig` loses its `demo` variant and narrows to two states:

```ts
type CommerceConfig =
  | {
      status: "connected";
      storeDomain: string;
      mcpEndpoint: string;
      agentProfileUrl: string | null;
    }
  | { status: "unconfigured"; reason: "not-configured" | "invalid-domain" };
```

`parseCommerceConfig(env)` stays a pure function over the build environment. A
second pure function layers the runtime choice on top:

```ts
resolveCommerceConfig(env: CommerceEnv, storedDomain: string | null): CommerceConfig
```

The stored domain wins over the build environment. It is validated with the
same schema as the build value; a stored value that fails validation is
discarded and the build default is used instead, so one bad paste cannot leave
the app unusable on that browser.

`NEXT_PUBLIC_COMMERCE_PROVIDER` is deleted. With one provider it carries no
information: a build either names a store or does not.

### Persistence

`localStorage`, key `openroom.store-domain`. The app has no server, so there is
nowhere else to put it, and the value is a public store domain rather than
anything secret.

Reads and writes go through one small module that wraps both in `try`/`catch`.
`localStorage` is not merely empty in a private window or with site data
blocked — the accessor itself throws — and a throw during the first render
would take down the workspace. A failed read is indistinguishable from "nothing
stored", which is the correct fallback. A failed write is surfaced in the
popover as "This browser will not remember the store", because silently
appearing to save is worse than saying so.

The site is a static export, so the first paint always reflects the build
default. The stored value is applied on mount. The store chip must therefore
not flash a wrong domain: it renders a neutral placeholder until the stored
value has been read once.

### Wiring

`commerce-runtime.ts`'s module constant `ACTIVE_COMMERCE` becomes a
`useCommerceContext()` hook mounted at the workspace root. Everything below it
is unchanged: `demo-workspace.tsx` passes the same `CommerceContext` prop, and
`ToolContext.commerce` keeps its shape. The hook owns exactly two things — the
stored domain and the setter the popover calls.

## 2. Store URL validation

The presenter types into a text field, so the input has to be normalized before
it is judged, and judged before it is stored.

### Normalization

Applied in order, so that the common ways of copying a store address all
succeed rather than being rejected on a technicality:

1. Trim surrounding whitespace.
2. Strip a leading `http://` or `https://`.
3. Strip a leading `www.` — Shopify serves the apex, and `www.` is a habit.
4. Strip everything from the first `/`, `?`, or `#`. Pasting
   `https://openroom-x.myshopify.com/admin/products` yields the store.
5. Lowercase.

### Acceptance

The normalized value must be a bare host: dot-separated labels of letters,
digits, and inner hyphens, ending in a TLD of at least two letters. This is the
existing `storeDomainSchema` regex, reused rather than reimplemented, so the
build-time and runtime paths cannot drift.

Custom domains are accepted, not just `*.myshopify.com`. A merchant on
`shop.example.com` has a valid Shopify storefront, and both the cart permalink
and `/api/ucp/mcp` are served from whatever domain fronts the store.

### Rejection messages

Each failure names the fix rather than restating the rule. The field shows one
message at a time, resolved in this order:

| Input | Message |
| --- | --- |
| empty after normalization | "Enter your store's address, like your-store.myshopify.com" |
| contains a space, or `@` | "That looks like an email or a search, not a store address" |
| no dot — `openroom` | "Add the full address, like openroom.myshopify.com" |
| `localhost`, an IP, or a `.local` host | "A Shopify store address is needed here" |
| anything else failing the regex | "That is not a valid store address" |

Validation runs as the presenter types, but the message appears only after the
field is blurred or Save is pressed. Judging a half-typed domain is noise.

### What validation cannot do

Format is the whole of it. Whether the store exists, is published, carries the
43 products, or has its password page off cannot be checked from this page:

- Any check is a request from OpenRoom to a store, which the project's
  invariant forbids and two E2E assertions actively enforce
  (`window.__webMcpFetchCount === 0` and the recorded external-request list).
- Even with that invariant lifted, it would not work. Shopify's storefront
  sends no permissive CORS headers, so a `fetch` is either blocked or opaque —
  an opaque response has no readable status, and a 404 store is
  indistinguishable from a live one.

The spec therefore does not pretend to verify existence. The honest signals
already exist downstream and are kept: unmapped products are listed as such in
the approval sheet, and the store link opens in a new tab where the presenter
sees the truth immediately. The popover's help text says plainly that OpenRoom
does not contact the store.

## 3. Store switching UI

A store chip sits in the header's `headerStatus` block, left of Room total:

- connected → the domain, as a button
- unconfigured → "Connect a store", in the tertiary role that already marks
  skipped lines

Clicking opens a popover holding one text field, a Save button, and a "Use the
sample store" button that clears the stored value and falls back to the build
default. It reuses the approval sheet's focus trap and Escape handling; the two
are the only overlays in the app and should not behave differently.

## 4. Approval sheet

`buildCommerceDraft` gains a second handoff alongside the permalink:

```ts
checkoutPermalink: string | null                  // when at least one variant is mapped
productLinks: readonly { productId, url }[]       // always, https://<store>/products/<productId>
```

The seed kit writes the OpenRoom product id as the Shopify handle and the
variant SKU, so `productLinks` needs no mapping table and stays correct on any
store seeded with the kit — which is what makes switching stores useful rather
than decorative.

The sheet's primary action becomes one of three:

| State | Action |
| --- | --- |
| permalink available | **Continue to Shopify · $N** — unchanged |
| store connected, nothing mapped | **Open N products on `<store>`** — expands the links inline; it does not open N tabs, which popup blockers eat |
| unconfigured | **Connect a store** — opens the chip's popover |

The "Approve demo cart" button, the demo total copy, and the demo branch of
`configurationNotice` are deleted.

## 5. Tool contract

`draft.commerce` becomes non-optional and gains `productLinks`. When no store is
connected, `add_scene_to_cart` returns a tool error rather than a draft with an
empty commerce block: an agent that gets a draft reasonably assumes it can act
on it, and there is nothing to act on.

Changed together, per the repository rule: `tool-contracts.ts`,
`tool-context.ts`, `tool-handlers.ts`, `core-tool-manifest.ts`, the unit tests,
and `tests/evals/webmcp-journeys.json`.

`AGENTS.md` states "`demo` is the default" as a commerce invariant. That
sentence stops being true and is rewritten in the same change.

## 6. Frontend-only constraint

Nothing here adds a server, a route handler, a credential, or a request from
OpenRoom to any store. Concretely:

- The store domain is public by construction and lives in the browser.
- The cart permalink and the product links are navigations the person makes,
  in a new tab, not requests the page issues.
- `mcpEndpoint` and `agentProfileUrl` are strings OpenRoom reports to an agent;
  the agent, not OpenRoom, calls the store.
- The published UCP agent profile is a static file under `public/`.

The existing E2E assertions that count external requests stay, and they are the
regression test for this section.

## 7. Testing

Unit:

- `resolveCommerceConfig` — stored wins over build, invalid stored value falls
  back rather than breaking, neither present yields `unconfigured`.
- Normalization and rejection — a table covering each row of the message table,
  plus the paste-a-full-admin-URL case.
- The storage module — a `localStorage` whose getter and setter both throw does
  not propagate.
- The popover — save updates the chip, an invalid entry shows its message and
  stores nothing, "Use the sample store" clears the stored value.
- The approval sheet in all three states.
- `buildCommerceDraft` — `productLinks` for mapped and unmapped products alike.

E2E:

- Both Playwright configs pin their commerce environment on the web server.
  With `NEXT_PUBLIC_COMMERCE_PROVIDER` gone, the pin is the store domain and
  what follows from it: `playwright.commerce.config.ts` keeps naming the
  placeholder store, its variants, and the fixture site origin, and its two
  journeys are unchanged. `playwright.config.ts` pins the domain to the empty
  string, which is what puts its journeys in the `unconfigured` state.
- Two of those journeys assert approval-sheet copy today
  (`demo-workspace.spec.ts` and `webmcp-core.spec.ts`); their assertions move to
  the unconfigured state. The other nine never touch commerce. What all of them
  actually guard — that the room editor completes a full round trip and issues
  no external request — belongs to the editor, not to commerce, and survives
  the move.

## Risks

- **The demo journeys change meaning.** Two of the eleven assert demo approval
  copy. Rewriting them to the unconfigured state is mechanical but touches the
  suite that catches editor regressions; the diff should be read with that in
  mind.
- **A switched store looks broken before it looks useful.** With no variant map
  for it, every line reads as unmapped and only product links work. The copy in
  that state has to explain why, or it reads as a bug.
- **`localStorage` is per-browser.** A presenter who switches machines gets the
  build default back. This is accepted; the alternative needs a server.
