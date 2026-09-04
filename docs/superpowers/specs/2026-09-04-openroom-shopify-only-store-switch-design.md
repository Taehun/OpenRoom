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
- Keep the deployment a static front end: no server and no credential. The one
  request OpenRoom makes is the capability probe in §2, and only when a person
  presses Save.

## Non-goals

- The `/demo` route, the room editor under `src/features/demo/`, and the 43
  `DEMO_PRODUCTS` stay exactly as they are. Only the commerce provider is
  removed; "demo" as a word in routes and directories is out of scope.
- No runtime catalog. Products still come from `DEMO_PRODUCTS`; the store is
  not queried for what it sells.
- No catalog-level proof. The probe in §2 confirms the store speaks the
  protocol; it does not confirm the store carries the 43 products.

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

### Capability probe

Format is necessary but not sufficient: a well-formed domain can be a typo, a
non-Shopify host, or a Shopify store whose agent surface OpenRoom cannot use.
The point of connecting a store is the handoff, so the check is whether the
handoff will work.

On Save — and only on Save — the popover POSTs a `tools/list` to
`https://<domain>/api/ucp/mcp` and reads the answer.

That endpoint is browser-callable. Measured against the seeded store, it
answers a preflight with `access-control-allow-methods: POST`,
`access-control-allow-headers: … Content-Type …`, and
`access-control-allow-origin: *`, and the POST itself carries the same
permissive origin header. `tools/list` needs no credential and no UCP agent
profile — the profile is required for `tools/call`, not for discovery — so the
probe sends nothing but a JSON-RPC envelope.

The three failure shapes are distinguishable from the browser:

| Store | Wire response | In the browser |
| --- | --- | --- |
| seeded and healthy | 200, permissive CORS, 13 tools | resolves, body readable |
| no such `*.myshopify.com` | 404, **no CORS header** | `fetch` rejects |
| not a Shopify host | 405, no CORS header | `fetch` rejects |
| Shopify, retired agent surface | 200, readable, short tool list | resolves, tools missing |

The last row is the one worth having. The retired `/api/mcp` still answers 200
and still lists a tool, so an endpoint can look alive while the cart tools it
is being connected for are gone — which is exactly what happened to this
project on 31 August 2026. A probe that only asked "did it respond" would have
called that store healthy.

Success therefore requires all three: the request resolves, the body parses as
a JSON-RPC result, and the tool list contains `create_cart`, `update_cart`, and
`get_cart`. The probe times out at 5 seconds; a timeout is a failure with its
own message rather than an indefinite spinner.

### Probe outcomes

| Outcome | Store saved? | Message |
| --- | --- | --- |
| all three hold | yes | "Connected. This store speaks the cart protocol." |
| tool list is missing cart tools | yes, with a warning | "This store answers but does not offer cart tools. Checkout links will still work; an agent cannot build the cart." |
| request rejects or times out | no | "Could not reach a Shopify store at `<domain>`. Check the address, or that the store is published." |
| resolves but the body is not JSON-RPC | no | "That address answered, but not as a Shopify store." |

A missing cart surface is a warning rather than a rejection: the permalink and
product-link paths do not depend on MCP, so such a store is degraded, not
unusable. Saying which half works is more useful than refusing the store.

What the probe still does not prove is that the store carries the 43 products.
That is left to the signals already downstream — unmapped lines are listed as
such in the approval sheet, and the link opens in a new tab where the presenter
sees the truth at once.

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

Nothing here adds a server, a route handler, or a credential. Concretely:

- The store domain is public by construction and lives in the browser.
- The cart permalink and the product links are navigations the person makes,
  in a new tab, not requests the page issues.
- `mcpEndpoint` and `agentProfileUrl` are strings OpenRoom reports to an agent;
  the agent, not OpenRoom, calls the store.
- The published UCP agent profile is a static file under `public/`.

### The one request, and its fence

`AGENTS.md` currently says OpenRoom makes no external request at all. The
capability probe breaks that, deliberately, and this spec is the approval that
rule asks for. The rule is replaced by a narrower one that says what actually
matters, and the narrower one is enforced rather than assumed:

> OpenRoom issues exactly one kind of external request: an unauthenticated
> `tools/list` to the store's `/api/ucp/mcp`, in direct response to a person
> pressing Save in the store popover. It sends no credential, and it happens
> nowhere else.

"Nowhere else" is the part with teeth, and it is the part a test can hold:
page load, scene editing, product search, and `add_scene_to_cart` must all
still issue zero requests. The existing E2E assertions
(`window.__webMcpFetchCount === 0` and the recorded external-request list)
cover exactly those flows and are kept unchanged — the probe lives outside all
of them. A regression that starts probing on load, or on every keystroke, fails
them.

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
- The probe, against a stubbed `fetch`, once per row of the outcomes table:
  healthy, cart tools missing, rejection, timeout, non-JSON-RPC body. The
  stub also asserts the request carries no credential header.
- The fence — format rejection short-circuits before any `fetch`, and typing in
  the field issues none.
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
- **The probe depends on Shopify's CORS policy.** It works because
  `/api/ucp/mcp` answers with `access-control-allow-origin: *`, which is
  Shopify's choice and not a contract with us. If that tightens, the probe
  starts failing for every store at once. The failure is safe — a rejected
  probe refuses the save — but it would read as "no store works". Worth a
  comment at the call site naming the dependency, so the next person does not
  debug their own code first.
- **A store behind a password page.** The seeded development store is password
  protected, and `/api/ucp/mcp` answers anyway, so the probe passes there. That
  is correct — the cart and checkout tools genuinely work — but a presenter may
  read "Connected" as "shoppers can reach this".
