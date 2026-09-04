# Shopify-only Commerce with a Switchable Store — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the `demo` commerce provider, and let a presenter connect the running page to another seeded Shopify store — validated by asking that store whether it speaks the cart protocol.

**Architecture:** `parseCommerceConfig` stays a pure function over the build environment; a second pure function overlays a `localStorage`-persisted store domain on top of it. A hook at the workspace root owns that stored value and hands the same `CommerceContext` down the existing prop path, so nothing below changes shape. A store chip in the header opens a popover that normalizes, validates, and then probes the typed domain before saving it.

**Tech Stack:** Next 16 (static export), React 19, TypeScript, Zod, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-04-openroom-shopify-only-store-switch-design.md`

## Global Constraints

- Package manager is `pnpm`. Node and pnpm versions are pinned in `package.json` and `.node-version`.
- Run the narrowest Vitest file first: `pnpm vitest run tests/unit/<file>`. Before calling the plan done, run `pnpm test`, `pnpm typecheck`, and `pnpm lint` once each.
- `pnpm test:e2e` and `pnpm test:e2e:commerce` cannot run while a `next dev` server is up — both use `.next`. Stop the dev server first.
- OpenRoom issues **exactly one** kind of external request: an unauthenticated `tools/list` POST to `https://<domain>/api/ucp/mcp`, fired only when a person presses Save in the store popover. No credential is ever sent. Page load, scene editing, product search, and `add_scene_to_cart` must still issue zero requests.
- Commerce stays token-free and server-free. No access token, no server cart route.
- The UCP endpoint path is `/api/ucp/mcp`. The retired `/api/mcp` must not appear in new code.
- Required cart tools, exactly: `create_cart`, `update_cart`, `get_cart`.
- `localStorage` key, exactly: `openroom.store-domain`.
- Probe timeout: 5000 ms.
- Every touched file keeps the surrounding comment density and voice: comments explain *why*, never *what*.

---

### Task 1: Store domain normalization and validation

Pure functions. No React, no storage, no network. Everything later in the plan depends on these names.

**Files:**
- Create: `src/features/commerce/store-domain.ts`
- Test: `tests/unit/store-domain.test.ts`

**Interfaces:**
- Consumes: `storeDomainSchema` — currently a module-private const in `src/features/commerce/commerce-config.ts:9-11`. Task 1 moves it here and re-exports; Task 5 updates the config to import it.
- Produces:
  ```ts
  export const STORE_DOMAIN_PATTERN: RegExp;
  export type DomainRejection =
    | "empty" | "looks-like-email" | "no-dot" | "not-public-host" | "malformed";
  export type DomainParse =
    | { ok: true; domain: string }
    | { ok: false; rejection: DomainRejection };
  export function normalizeStoreDomain(raw: string): string;
  export function parseStoreDomain(raw: string): DomainParse;
  export function domainRejectionMessage(rejection: DomainRejection): string;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/store-domain.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  domainRejectionMessage,
  normalizeStoreDomain,
  parseStoreDomain,
} from "../../src/features/commerce/store-domain";

describe("normalizeStoreDomain", () => {
  it.each([
    ["  openroom-x.myshopify.com  ", "openroom-x.myshopify.com"],
    ["https://openroom-x.myshopify.com", "openroom-x.myshopify.com"],
    ["http://openroom-x.myshopify.com", "openroom-x.myshopify.com"],
    ["www.shop.example.com", "shop.example.com"],
    ["https://www.shop.example.com/", "shop.example.com"],
    // The address a presenter most plausibly copies: an admin deep link.
    ["https://openroom-x.myshopify.com/admin/products", "openroom-x.myshopify.com"],
    ["openroom-x.myshopify.com?utm=1", "openroom-x.myshopify.com"],
    ["openroom-x.myshopify.com#top", "openroom-x.myshopify.com"],
    ["OpenRoom-X.MyShopify.com", "openroom-x.myshopify.com"],
  ])("normalizes %s", (raw, expected) => {
    expect(normalizeStoreDomain(raw)).toBe(expected);
  });
});

describe("parseStoreDomain", () => {
  it("accepts a bare myshopify host", () => {
    expect(parseStoreDomain("openroom-x.myshopify.com")).toEqual({
      ok: true,
      domain: "openroom-x.myshopify.com",
    });
  });

  // A merchant on a custom domain has a real storefront; both the permalink
  // and /api/ucp/mcp are served from whatever domain fronts the store.
  it("accepts a custom domain", () => {
    expect(parseStoreDomain("shop.example.com")).toEqual({
      ok: true,
      domain: "shop.example.com",
    });
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["https://", "empty"],
    ["me@example.com", "looks-like-email"],
    ["my store", "looks-like-email"],
    ["openroom", "no-dot"],
    ["localhost", "no-dot"],
    ["localhost:3000", "not-public-host"],
    ["127.0.0.1", "not-public-host"],
    ["store.local", "not-public-host"],
    ["-bad-.myshopify.com", "malformed"],
    ["store..myshopify.com", "malformed"],
  ])("rejects %s as %s", (raw, rejection) => {
    expect(parseStoreDomain(raw)).toEqual({ ok: false, rejection });
  });
});

describe("domainRejectionMessage", () => {
  it("names the fix rather than restating the rule", () => {
    expect(domainRejectionMessage("no-dot")).toBe(
      "Add the full address, like openroom.myshopify.com",
    );
    expect(domainRejectionMessage("looks-like-email")).toBe(
      "That looks like an email or a search, not a store address",
    );
  });

  it("has a message for every rejection", () => {
    for (const rejection of [
      "empty",
      "looks-like-email",
      "no-dot",
      "not-public-host",
      "malformed",
    ] as const) {
      expect(domainRejectionMessage(rejection)).not.toBe("");
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/store-domain.test.ts`
Expected: FAIL — cannot resolve `../../src/features/commerce/store-domain`.

- [ ] **Step 3: Write the implementation**

Create `src/features/commerce/store-domain.ts`:

```ts
/**
 * Turning what a person pastes into a store host, and saying what is wrong
 * when it cannot be one.
 *
 * Format is a gate, not a verdict: it decides whether the domain is worth a
 * network round trip (see `store-probe.ts`), and nothing more.
 */

// Bare host only: labels of letters, digits, and inner hyphens, a TLD of at
// least two letters, no scheme, path, port, query, or whitespace. Moved here
// from commerce-config so the build-time and runtime paths judge a domain the
// same way rather than drifting apart.
export const STORE_DOMAIN_PATTERN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export type DomainRejection =
  | "empty"
  | "looks-like-email"
  | "no-dot"
  | "not-public-host"
  | "malformed";

export type DomainParse =
  | { ok: true; domain: string }
  | { ok: false; rejection: DomainRejection };

/**
 * Applied in order, so the ordinary ways of copying a store address all
 * succeed instead of being rejected on a technicality.
 */
export function normalizeStoreDomain(raw: string): string {
  let value = raw.trim();
  value = value.replace(/^https?:\/\//i, "");
  value = value.replace(/^www\./i, "");
  const cut = value.search(/[/?#]/);
  if (cut !== -1) value = value.slice(0, cut);
  return value.toLowerCase();
}

const IPV4_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export function parseStoreDomain(raw: string): DomainParse {
  const domain = normalizeStoreDomain(raw);
  if (domain === "") return { ok: false, rejection: "empty" };
  if (/[\s@]/.test(domain)) return { ok: false, rejection: "looks-like-email" };
  // A port survives normalization because it is not a path separator, and it
  // is the usual shape of a local address someone types out of habit.
  if (domain.includes(":") || IPV4_PATTERN.test(domain) || domain.endsWith(".local")) {
    return { ok: false, rejection: "not-public-host" };
  }
  if (!domain.includes(".")) return { ok: false, rejection: "no-dot" };
  if (!STORE_DOMAIN_PATTERN.test(domain)) {
    return { ok: false, rejection: "malformed" };
  }
  return { ok: true, domain };
}

export function domainRejectionMessage(rejection: DomainRejection): string {
  switch (rejection) {
    case "empty":
      return "Enter your store's address, like your-store.myshopify.com";
    case "looks-like-email":
      return "That looks like an email or a search, not a store address";
    case "no-dot":
      return "Add the full address, like openroom.myshopify.com";
    case "not-public-host":
      return "A Shopify store address is needed here";
    case "malformed":
      return "That is not a valid store address";
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/unit/store-domain.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/commerce/store-domain.ts tests/unit/store-domain.test.ts
git commit -m "feat(commerce): parse a pasted address into a store host"
```

---

### Task 2: Storage that survives a browser refusing it

**Files:**
- Create: `src/features/commerce/store-storage.ts`
- Test: `tests/unit/store-storage.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export const STORE_DOMAIN_KEY = "openroom.store-domain";
  export function readStoredStoreDomain(storage?: Storage | null): string | null;
  export function writeStoredStoreDomain(
    domain: string | null,
    storage?: Storage | null,
  ): boolean;   // false when the browser refused to persist it
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/store-storage.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  STORE_DOMAIN_KEY,
  readStoredStoreDomain,
  writeStoredStoreDomain,
} from "../../src/features/commerce/store-storage";

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  } as Storage;
}

/** Site data blocked: the accessors throw rather than returning null. */
function hostileStorage(): Storage {
  return {
    get length(): number {
      throw new Error("blocked");
    },
    clear: () => {
      throw new Error("blocked");
    },
    getItem: () => {
      throw new Error("blocked");
    },
    key: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  } as unknown as Storage;
}

describe("readStoredStoreDomain", () => {
  it("returns the stored domain", () => {
    const storage = memoryStorage({ [STORE_DOMAIN_KEY]: "openroom-x.myshopify.com" });
    expect(readStoredStoreDomain(storage)).toBe("openroom-x.myshopify.com");
  });

  it("returns null when nothing is stored", () => {
    expect(readStoredStoreDomain(memoryStorage())).toBeNull();
  });

  it("treats an empty stored value as nothing stored", () => {
    expect(readStoredStoreDomain(memoryStorage({ [STORE_DOMAIN_KEY]: "  " }))).toBeNull();
  });

  // A throw here would take down the first render of the workspace.
  it("returns null when the browser refuses to be read", () => {
    expect(readStoredStoreDomain(hostileStorage())).toBeNull();
  });

  it("returns null when there is no storage at all", () => {
    expect(readStoredStoreDomain(null)).toBeNull();
  });
});

describe("writeStoredStoreDomain", () => {
  it("stores a domain and reports success", () => {
    const storage = memoryStorage();
    expect(writeStoredStoreDomain("openroom-x.myshopify.com", storage)).toBe(true);
    expect(storage.getItem(STORE_DOMAIN_KEY)).toBe("openroom-x.myshopify.com");
  });

  it("removes the key when passed null", () => {
    const storage = memoryStorage({ [STORE_DOMAIN_KEY]: "openroom-x.myshopify.com" });
    expect(writeStoredStoreDomain(null, storage)).toBe(true);
    expect(storage.getItem(STORE_DOMAIN_KEY)).toBeNull();
  });

  // Reported, not swallowed: appearing to save and not saving is worse than
  // saying the browser will not remember it.
  it("reports failure when the browser refuses to be written", () => {
    expect(writeStoredStoreDomain("openroom-x.myshopify.com", hostileStorage())).toBe(false);
  });

  it("reports failure when there is no storage at all", () => {
    expect(writeStoredStoreDomain("openroom-x.myshopify.com", null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/store-storage.test.ts`
Expected: FAIL — cannot resolve `store-storage`.

- [ ] **Step 3: Write the implementation**

Create `src/features/commerce/store-storage.ts`:

```ts
/**
 * The chosen store, remembered on this browser and nowhere else.
 *
 * Every access is guarded because `localStorage` does not merely come back
 * empty when a browser refuses it — reaching for the property throws, and a
 * throw during the first render would take the workspace down with it.
 */
export const STORE_DOMAIN_KEY = "openroom.store-domain";

function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readStoredStoreDomain(
  storage: Storage | null = defaultStorage(),
): string | null {
  if (storage === null) return null;
  try {
    const value = storage.getItem(STORE_DOMAIN_KEY)?.trim() ?? "";
    return value === "" ? null : value;
  } catch {
    // Indistinguishable from "nothing stored", which is the right fallback.
    return null;
  }
}

export function writeStoredStoreDomain(
  domain: string | null,
  storage: Storage | null = defaultStorage(),
): boolean {
  if (storage === null) return false;
  try {
    if (domain === null) storage.removeItem(STORE_DOMAIN_KEY);
    else storage.setItem(STORE_DOMAIN_KEY, domain);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/unit/store-storage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/commerce/store-storage.ts tests/unit/store-storage.test.ts
git commit -m "feat(commerce): remember the chosen store, or say the browser will not"
```

---

### Task 3: Capability probe

The check that gives the popover its answer. Note it asks for tools rather than for liveness: the retired `/api/mcp` answers 200 and lists a tool, so "did it respond" would have called a dead cart surface healthy.

**Files:**
- Create: `src/features/commerce/store-probe.ts`
- Test: `tests/unit/store-probe.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export const REQUIRED_CART_TOOLS: readonly ["create_cart", "update_cart", "get_cart"];
  export const PROBE_TIMEOUT_MS = 5000;
  export function ucpEndpoint(storeDomain: string): string;
  export type ProbeOutcome =
    | { status: "ok"; tools: readonly string[] }
    | { status: "missing-cart-tools"; tools: readonly string[] }
    | { status: "not-shopify" }
    | { status: "unreachable" };
  export function probeStoreCapability(
    storeDomain: string,
    options?: { fetch?: typeof globalThis.fetch; timeoutMs?: number },
  ): Promise<ProbeOutcome>;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/store-probe.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import {
  probeStoreCapability,
  ucpEndpoint,
} from "../../src/features/commerce/store-probe";

const DOMAIN = "openroom-x.myshopify.com";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function toolsResponse(names: readonly string[]): Response {
  return jsonResponse({
    jsonrpc: "2.0",
    id: 1,
    result: { tools: names.map((name) => ({ name })) },
  });
}

const FULL_TOOLS = [
  "get_checkout",
  "create_checkout",
  "get_cart",
  "create_cart",
  "update_cart",
  "search_catalog",
];

describe("ucpEndpoint", () => {
  it("targets the UCP path, never the retired one", () => {
    expect(ucpEndpoint(DOMAIN)).toBe(`https://${DOMAIN}/api/ucp/mcp`);
  });
});

describe("probeStoreCapability", () => {
  it("reports ok when the store offers every cart tool", async () => {
    const fetchImpl = vi.fn(async () => toolsResponse(FULL_TOOLS));
    await expect(probeStoreCapability(DOMAIN, { fetch: fetchImpl })).resolves.toMatchObject({
      status: "ok",
    });
  });

  it("sends a tools/list with no credential", async () => {
    const fetchImpl = vi.fn(async () => toolsResponse(FULL_TOOLS));
    await probeStoreCapability(DOMAIN, { fetch: fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`https://${DOMAIN}/api/ucp/mcp`);
    expect(JSON.parse(String(init?.body))).toMatchObject({ method: "tools/list" });
    const headers = new Headers(init?.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("X-Shopify-Access-Token")).toBeNull();
  });

  // The row that justifies probing rather than pinging: the retired /api/mcp
  // answers 200 and lists a tool while the cart surface is gone.
  it("reports missing-cart-tools when only the policies tool is offered", async () => {
    const fetchImpl = vi.fn(async () => toolsResponse(["search_shop_policies_and_faqs"]));
    await expect(probeStoreCapability(DOMAIN, { fetch: fetchImpl })).resolves.toEqual({
      status: "missing-cart-tools",
      tools: ["search_shop_policies_and_faqs"],
    });
  });

  it("reports missing-cart-tools when one cart tool is absent", async () => {
    const fetchImpl = vi.fn(async () =>
      toolsResponse(["get_cart", "create_cart", "search_catalog"]),
    );
    await expect(probeStoreCapability(DOMAIN, { fetch: fetchImpl })).resolves.toMatchObject({
      status: "missing-cart-tools",
    });
  });

  // A missing store and a non-Shopify host both send no CORS header, so the
  // browser rejects the fetch rather than handing back a readable status.
  it("reports unreachable when the request rejects", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(probeStoreCapability(DOMAIN, { fetch: fetchImpl })).resolves.toEqual({
      status: "unreachable",
    });
  });

  it("reports unreachable when the probe times out", async () => {
    const fetchImpl = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    ) as unknown as typeof globalThis.fetch;

    await expect(
      probeStoreCapability(DOMAIN, { fetch: fetchImpl, timeoutMs: 5 }),
    ).resolves.toEqual({ status: "unreachable" });
  });

  it("reports not-shopify when the body is not a JSON-RPC result", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("<!doctype html><title>Example</title>", { status: 200 }),
    );
    await expect(probeStoreCapability(DOMAIN, { fetch: fetchImpl })).resolves.toEqual({
      status: "not-shopify",
    });
  });

  it("reports not-shopify when JSON-RPC answers with an error", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "nope" } }),
    );
    await expect(probeStoreCapability(DOMAIN, { fetch: fetchImpl })).resolves.toEqual({
      status: "not-shopify",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/store-probe.test.ts`
Expected: FAIL — cannot resolve `store-probe`.

- [ ] **Step 3: Write the implementation**

Create `src/features/commerce/store-probe.ts`:

```ts
/**
 * Asking a store whether it can do the thing it is being connected for.
 *
 * This is the only external request OpenRoom makes, and it happens only when
 * a person presses Save in the store popover. It carries no credential: the
 * UCP endpoint serves `tools/list` unauthenticated, and the agent profile it
 * requires elsewhere is a `tools/call` concern.
 *
 * It works from the browser because Shopify answers `/api/ucp/mcp` with
 * `access-control-allow-origin: *`. That is Shopify's policy rather than a
 * contract with us — if it tightens, every probe fails at once, and the
 * failure will look like a bug in this file before it looks like a policy
 * change.
 */
export const REQUIRED_CART_TOOLS = ["create_cart", "update_cart", "get_cart"] as const;

export const PROBE_TIMEOUT_MS = 5000;

export function ucpEndpoint(storeDomain: string): string {
  return `https://${storeDomain}/api/ucp/mcp`;
}

export type ProbeOutcome =
  | { status: "ok"; tools: readonly string[] }
  | { status: "missing-cart-tools"; tools: readonly string[] }
  | { status: "not-shopify" }
  | { status: "unreachable" };

interface ToolsListResult {
  result?: { tools?: { name?: unknown }[] };
}

function toolNamesOf(body: unknown): readonly string[] | null {
  const tools = (body as ToolsListResult | null)?.result?.tools;
  if (!Array.isArray(tools)) return null;
  return tools
    .map((tool) => tool?.name)
    .filter((name): name is string => typeof name === "string");
}

export async function probeStoreCapability(
  storeDomain: string,
  options: { fetch?: typeof globalThis.fetch; timeoutMs?: number } = {},
): Promise<ProbeOutcome> {
  const { fetch: fetchImpl = globalThis.fetch, timeoutMs = PROBE_TIMEOUT_MS } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let body: unknown;
  try {
    const response = await fetchImpl(ucpEndpoint(storeDomain), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      signal: controller.signal,
    });
    body = await response.json();
  } catch {
    // A rejected fetch covers three cases the browser cannot tell apart: DNS
    // failure, a 404 store, and a non-Shopify host — none send a CORS header.
    return { status: "unreachable" };
  } finally {
    clearTimeout(timer);
  }

  const tools = toolNamesOf(body);
  if (tools === null) return { status: "not-shopify" };
  const missing = REQUIRED_CART_TOOLS.some((tool) => !tools.includes(tool));
  return missing ? { status: "missing-cart-tools", tools } : { status: "ok", tools };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/unit/store-probe.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/commerce/store-probe.ts tests/unit/store-probe.test.ts
git commit -m "feat(commerce): ask a store for its cart tools before trusting it"
```

---

### Task 4: Product links in the commerce draft

Additive, so it lands before the breaking config change. The seed kit writes the OpenRoom product id as the Shopify handle, which is what makes these links correct on any seeded store.

**Files:**
- Modify: `src/features/commerce/commerce-types.ts` (add `productLinks` to `CommerceDraft`)
- Modify: `src/features/commerce/shopify-cart.ts:68-88` (`buildCommerceDraft`)
- Test: `tests/unit/shopify-cart.test.ts`
- Modify: `tests/helpers/commerce-fixtures.ts`, `tests/unit/cart-approval-sheet.test.tsx`, `tests/unit/webmcp-tools.test.ts`, `tests/e2e/commerce/shopify-checkout.spec.ts` (existing `toEqual` draft literals must gain the field)

**Interfaces:**
- Consumes: `ResolvedLine`, `buildCommerceDraft` from `shopify-cart.ts`.
- Produces:
  ```ts
  export interface ProductLink { productId: string; url: string }
  // CommerceDraft gains: productLinks: readonly ProductLink[]
  export function buildProductLinks(
    storeDomain: string,
    items: readonly CartLineInput[],
  ): ProductLink[];
  ```

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/shopify-cart.test.ts`:

```ts
describe("buildProductLinks", () => {
  it("links every requested product by handle, mapped or not", () => {
    expect(
      buildProductLinks(PLACEHOLDER_STORE_DOMAIN, [
        { productId: "oak-frame-table", quantity: 1 },
        { productId: "plant", quantity: 1 },
      ]),
    ).toEqual([
      {
        productId: "oak-frame-table",
        url: `https://${PLACEHOLDER_STORE_DOMAIN}/products/oak-frame-table`,
      },
      {
        productId: "plant",
        url: `https://${PLACEHOLDER_STORE_DOMAIN}/products/plant`,
      },
    ]);
  });

  it("lists each product once and drops non-positive quantities", () => {
    expect(
      buildProductLinks(PLACEHOLDER_STORE_DOMAIN, [
        { productId: "rug", quantity: 1 },
        { productId: "rug", quantity: 2 },
        { productId: "coffee-table", quantity: 0 },
      ]).map(({ productId }) => productId),
    ).toEqual(["rug"]);
  });
});
```

Also add to the existing `buildCommerceDraft` assertion in that file — inside the `toEqual({...})` for "builds public lines, skipped products, endpoint, and permalink in shopify mode":

```ts
    productLinks: [
      {
        productId: "coffee-table",
        url: `https://${PLACEHOLDER_STORE_DOMAIN}/products/coffee-table`,
      },
      {
        productId: "plant",
        url: `https://${PLACEHOLDER_STORE_DOMAIN}/products/plant`,
      },
    ],
```

and import `buildProductLinks` alongside the existing imports from `../../src/features/commerce/shopify-cart`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/shopify-cart.test.ts`
Expected: FAIL — `buildProductLinks` is not exported, and the draft has no `productLinks`.

- [ ] **Step 3: Write the implementation**

In `src/features/commerce/commerce-types.ts`, add above `CommerceDraft`:

```ts
export interface ProductLink {
  productId: string;
  url: string;
}
```

and add the field to `CommerceDraft`, after `checkoutPermalink`:

```ts
  /**
   * One link per requested product, mapped or not. The seed kit writes the
   * OpenRoom product id as the Shopify handle, so these stay correct on any
   * store seeded with it — which is what makes switching stores useful rather
   * than decorative.
   */
  productLinks: readonly ProductLink[];
```

In `src/features/commerce/shopify-cart.ts`, add after `buildCartPermalink`:

```ts
export function buildProductLinks(
  storeDomain: string,
  items: readonly CartLineInput[],
): ProductLink[] {
  const seen = new Set<string>();
  const links: ProductLink[] = [];
  for (const { productId, quantity } of items) {
    if (!Number.isInteger(quantity) || quantity <= 0) continue;
    if (seen.has(productId)) continue;
    seen.add(productId);
    links.push({ productId, url: `https://${storeDomain}/products/${productId}` });
  }
  return links;
}
```

Add `ProductLink` to the type import block at the top of the file, and add to the object `buildCommerceDraft` returns, after `checkoutPermalink`:

```ts
    productLinks: buildProductLinks(commerce.config.storeDomain, items),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/unit/shopify-cart.test.ts`
Expected: PASS.

- [ ] **Step 5: Fix the other draft literals**

`pnpm typecheck` now fails in four files that spell a `CommerceDraft` out in full. Add `productLinks` to each, computed the same way:

- `tests/helpers/commerce-fixtures.ts` — no draft literal, but export a helper so the rest stay short:
  ```ts
  export function fixtureProductLinks(
    ...productIds: readonly string[]
  ): { productId: string; url: string }[] {
    return productIds.map((productId) => ({
      productId,
      url: `https://${PLACEHOLDER_STORE_DOMAIN}/products/${productId}`,
    }));
  }
  ```
- `tests/unit/cart-approval-sheet.test.tsx` — `mappedDraft()` gets `productLinks: fixtureProductLinks("oak-frame-table", "woven-jute-rug")`; `emptyDraft(true)` gets `productLinks: []`; `agentDraft()` gets `productLinks: fixtureProductLinks("oak-frame-table", "rice-paper-floor-lamp")`.
- `tests/unit/webmcp-tools.test.ts` — the `draft.commerce` assertion gets `productLinks: fixtureProductLinks("oak-frame-table")`.
- `tests/e2e/commerce/shopify-checkout.spec.ts` — the `draft.commerce` assertion gets the same, spelled out with `STORE` since that file builds its own URLs.

- [ ] **Step 6: Verify the whole suite**

Run: `pnpm vitest run && pnpm typecheck`
Expected: PASS both.

- [ ] **Step 7: Commit**

```bash
git add src/features/commerce tests/unit tests/helpers tests/e2e/commerce
git commit -m "feat(commerce): carry a product link for every line, mapped or not"
```

---

### Task 5: Narrow the config to connected or unconfigured

The breaking change. It lands in one commit because the type is consumed by the cart builder, the approval sheet, and the tool handler; splitting it would leave the tree red between tasks.

**Files:**
- Modify: `src/features/commerce/commerce-types.ts` (`CommerceConfig`, `CommerceEnv`)
- Modify: `src/features/commerce/commerce-config.ts` (drop provider parsing, add `resolveCommerceConfig`, import the moved regex)
- Modify: `src/features/commerce/shopify-cart.ts:71` (`provider !== "shopify"` → `status !== "connected"`)
- Modify: `src/features/demo/cart-approval-sheet.tsx:48-57, 113-115` (`configurationNotice`, `storeDomain`)
- Modify: `tests/helpers/commerce-fixtures.ts` (`DEMO_COMMERCE` → `UNCONFIGURED_COMMERCE`)
- Modify: `tests/unit/commerce-config.test.ts`, `tests/unit/shopify-cart.test.ts`, `tests/unit/cart-approval-sheet.test.tsx`, `tests/unit/webmcp-tools.test.ts`
- Modify: `playwright.config.ts`, `playwright.commerce.config.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `STORE_DOMAIN_PATTERN`, `parseStoreDomain` (Task 1).
- Produces:
  ```ts
  export type CommerceConfig =
    | { status: "connected"; storeDomain: string; mcpEndpoint: string; agentProfileUrl: string | null }
    | { status: "unconfigured"; reason: "not-configured" | "invalid-domain" };
  export interface CommerceEnv {
    NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN?: string | undefined;
    NEXT_PUBLIC_SITE_ORIGIN?: string | undefined;
  }
  export function parseCommerceConfig(env: CommerceEnv): CommerceConfig;
  export function resolveCommerceConfig(
    env: CommerceEnv,
    storedDomain: string | null,
  ): CommerceConfig;
  ```

- [ ] **Step 1: Write the failing test**

Replace the body of `tests/unit/commerce-config.test.ts`'s `describe("parseCommerceConfig")` with tests for the two states, and add a new block:

```ts
describe("resolveCommerceConfig", () => {
  const ENV = {
    NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: "build-default.myshopify.com",
    NEXT_PUBLIC_SITE_ORIGIN: "https://openroom.example",
  };

  it("uses the build default when nothing is stored", () => {
    expect(resolveCommerceConfig(ENV, null)).toMatchObject({
      status: "connected",
      storeDomain: "build-default.myshopify.com",
    });
  });

  it("prefers the stored domain over the build default", () => {
    expect(resolveCommerceConfig(ENV, "chosen.myshopify.com")).toMatchObject({
      status: "connected",
      storeDomain: "chosen.myshopify.com",
      mcpEndpoint: "https://chosen.myshopify.com/api/ucp/mcp",
    });
  });

  it("normalizes a stored value that was written with a scheme", () => {
    expect(resolveCommerceConfig(ENV, "https://Chosen.myshopify.com/")).toMatchObject({
      storeDomain: "chosen.myshopify.com",
    });
  });

  // One bad paste must not leave the app unusable on that browser.
  it("falls back to the build default when the stored value is unusable", () => {
    expect(resolveCommerceConfig(ENV, "not a domain")).toMatchObject({
      status: "connected",
      storeDomain: "build-default.myshopify.com",
    });
  });

  it("is unconfigured when neither the store nor a stored value is present", () => {
    expect(resolveCommerceConfig({}, null)).toEqual({
      status: "unconfigured",
      reason: "not-configured",
    });
  });

  it("is connected on a stored domain even with no build default", () => {
    expect(resolveCommerceConfig({}, "chosen.myshopify.com")).toMatchObject({
      status: "connected",
      storeDomain: "chosen.myshopify.com",
      agentProfileUrl: null,
    });
  });
});
```

Update the existing `parseCommerceConfig` assertions: `{ provider: "demo", reason: … }` becomes `{ status: "unconfigured", reason: … }`, `{ provider: "shopify", … }` becomes `{ status: "connected", … }`, and every case that passed `NEXT_PUBLIC_COMMERCE_PROVIDER` drops it.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/commerce-config.test.ts`
Expected: FAIL — `resolveCommerceConfig` is not exported.

- [ ] **Step 3: Write the implementation**

In `commerce-types.ts`, replace the `CommerceConfig` union and `CommerceEnv` with the shapes in the Interfaces block above. Delete the `provider: "demo"` variant entirely.

In `commerce-config.ts`:
- delete `providerSchema` and the `NEXT_PUBLIC_COMMERCE_PROVIDER` branch;
- delete the local `storeDomainSchema` and import `parseStoreDomain` from `./store-domain`;
- rewrite the tail:

```ts
function connect(domain: string, env: CommerceEnv): CommerceConfig {
  return {
    status: "connected",
    storeDomain: domain,
    mcpEndpoint: `https://${domain}/api/ucp/mcp`,
    agentProfileUrl: parseAgentProfileUrl(env.NEXT_PUBLIC_SITE_ORIGIN),
  };
}

export function parseCommerceConfig(env: CommerceEnv): CommerceConfig {
  const raw = env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN?.trim() ?? "";
  if (raw === "") return { status: "unconfigured", reason: "not-configured" };
  const parsed = parseStoreDomain(raw);
  if (!parsed.ok) return { status: "unconfigured", reason: "invalid-domain" };
  return connect(parsed.domain, env);
}

/**
 * The runtime choice wins over the build default. A stored value that no
 * longer parses is discarded rather than honoured, so one bad paste cannot
 * leave the app unusable on that browser.
 */
export function resolveCommerceConfig(
  env: CommerceEnv,
  storedDomain: string | null,
): CommerceConfig {
  if (storedDomain !== null) {
    const parsed = parseStoreDomain(storedDomain);
    if (parsed.ok) return connect(parsed.domain, env);
  }
  return parseCommerceConfig(env);
}
```
- drop `NEXT_PUBLIC_COMMERCE_PROVIDER` from `COMMERCE_CONFIG`.

In `shopify-cart.ts:71`, change the guard to `if (commerce.config.status !== "connected") return null;`.

In `cart-approval-sheet.tsx`, replace `configurationNotice` with:

```ts
function configurationNotice(config: CommerceContext["config"]): string | null {
  if (config.status === "connected") return null;
  if (config.reason === "invalid-domain") {
    return "The configured store address is not a bare host such as your-store.myshopify.com.";
  }
  return "No Shopify store is connected yet.";
}
```

and change `storeDomain` to `config.status === "connected" ? config.storeDomain : null`. Leave the button labels alone for now — Task 8 rewrites them.

In `tests/helpers/commerce-fixtures.ts`, rename `DEMO_COMMERCE` to `UNCONFIGURED_COMMERCE` with `config: { status: "unconfigured", reason: "not-configured" }`, and give `SHOPIFY_COMMERCE` the `status: "connected"` shape. Update the importers.

In `playwright.config.ts`, replace the pinned env with the two that remain, both empty — that empty domain is what puts the demo journeys in the unconfigured state:

```ts
        env: {
          NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: "",
          NEXT_PUBLIC_SHOPIFY_VARIANTS: "",
          NEXT_PUBLIC_SITE_ORIGIN: "",
        },
```

In `playwright.commerce.config.ts`, drop the `NEXT_PUBLIC_COMMERCE_PROVIDER` line; the other three stay.

In `.env.example`, delete the `NEXT_PUBLIC_COMMERCE_PROVIDER` block and rewrite the store-domain comment to say that naming a store is what turns Shopify on.

- [ ] **Step 4: Run the unit suite**

Run: `pnpm vitest run && pnpm typecheck`
Expected: PASS. Fix any remaining `provider` references the compiler names.

- [ ] **Step 5: Commit**

```bash
git add src tests playwright.config.ts playwright.commerce.config.ts .env.example
git commit -m "refactor(commerce): a store is connected or it is not"
```

---

### Task 6: The runtime store, and the hook that owns it

**Files:**
- Create: `src/features/commerce/use-commerce-context.ts`
- Modify: `src/features/commerce/commerce-runtime.ts`
- Modify: `src/features/demo/demo-workspace.tsx:40-55`
- Test: `tests/unit/use-commerce-context.test.tsx`

**Interfaces:**
- Consumes: `resolveCommerceConfig` (Task 5), `readStoredStoreDomain` / `writeStoredStoreDomain` (Task 2), `ACTIVE_SHOPIFY_VARIANTS`.
- Produces:
  ```ts
  export interface CommerceController {
    commerce: CommerceContext;
    hydrated: boolean;              // false until the stored value has been read once
    storedDomain: string | null;
    setStoreDomain(domain: string | null): boolean;  // false when the browser refused
  }
  export function useCommerceContext(): CommerceController;
  export const BUILD_COMMERCE: CommerceContext;   // replaces ACTIVE_COMMERCE
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/use-commerce-context.test.tsx`:

```tsx
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useCommerceContext } from "../../src/features/commerce/use-commerce-context";
import { STORE_DOMAIN_KEY } from "../../src/features/commerce/store-storage";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("useCommerceContext", () => {
  it("reports hydrated after the first effect, with no stored value", () => {
    const { result } = renderHook(() => useCommerceContext());
    expect(result.current.hydrated).toBe(true);
    expect(result.current.storedDomain).toBeNull();
  });

  it("adopts a domain already in storage", () => {
    window.localStorage.setItem(STORE_DOMAIN_KEY, "stored.myshopify.com");
    const { result } = renderHook(() => useCommerceContext());
    expect(result.current.commerce.config).toMatchObject({
      status: "connected",
      storeDomain: "stored.myshopify.com",
    });
  });

  it("switches the store and persists it", () => {
    const { result } = renderHook(() => useCommerceContext());
    act(() => {
      expect(result.current.setStoreDomain("chosen.myshopify.com")).toBe(true);
    });
    expect(result.current.commerce.config).toMatchObject({
      storeDomain: "chosen.myshopify.com",
    });
    expect(window.localStorage.getItem(STORE_DOMAIN_KEY)).toBe("chosen.myshopify.com");
  });

  it("clears back to the build default", () => {
    window.localStorage.setItem(STORE_DOMAIN_KEY, "stored.myshopify.com");
    const { result } = renderHook(() => useCommerceContext());
    act(() => {
      result.current.setStoreDomain(null);
    });
    expect(result.current.storedDomain).toBeNull();
    expect(window.localStorage.getItem(STORE_DOMAIN_KEY)).toBeNull();
  });

  it("keeps the variant map from the build", () => {
    const { result } = renderHook(() => useCommerceContext());
    expect(Object.keys(result.current.commerce.variants).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/use-commerce-context.test.tsx`
Expected: FAIL — cannot resolve `use-commerce-context`.

- [ ] **Step 3: Write the implementation**

Rewrite `src/features/commerce/commerce-runtime.ts`:

```ts
import { COMMERCE_CONFIG } from "./commerce-config";
import type { CommerceContext } from "./commerce-types";
import { ACTIVE_SHOPIFY_VARIANTS } from "./shopify-variants";

/**
 * What the build alone knows. The running page may point somewhere else — see
 * `useCommerceContext` — but a server render has no storage to consult, so
 * this is always the first paint.
 */
export const BUILD_COMMERCE: CommerceContext = {
  config: COMMERCE_CONFIG,
  variants: ACTIVE_SHOPIFY_VARIANTS,
};
```

Create `src/features/commerce/use-commerce-context.ts`:

```ts
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { resolveCommerceConfig } from "./commerce-config";
import type { CommerceContext } from "./commerce-types";
import { BUILD_COMMERCE } from "./commerce-runtime";
import { readStoredStoreDomain, writeStoredStoreDomain } from "./store-storage";
import { ACTIVE_SHOPIFY_VARIANTS } from "./shopify-variants";

const BUILD_ENV = {
  NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN,
  NEXT_PUBLIC_SITE_ORIGIN: process.env.NEXT_PUBLIC_SITE_ORIGIN,
};

export interface CommerceController {
  commerce: CommerceContext;
  /** False until the stored value has been read, so the chip can hold its tongue. */
  hydrated: boolean;
  storedDomain: string | null;
  setStoreDomain(domain: string | null): boolean;
}

export function useCommerceContext(): CommerceController {
  const [storedDomain, setStoredDomain] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // The site is a static export, so the first paint is always the build
  // default; storage can only be consulted once we are in the browser.
  useEffect(() => {
    setStoredDomain(readStoredStoreDomain());
    setHydrated(true);
  }, []);

  const setStoreDomain = useCallback((domain: string | null) => {
    const persisted = writeStoredStoreDomain(domain);
    setStoredDomain(domain);
    return persisted;
  }, []);

  const commerce = useMemo<CommerceContext>(
    () =>
      hydrated
        ? {
            config: resolveCommerceConfig(BUILD_ENV, storedDomain),
            variants: ACTIVE_SHOPIFY_VARIANTS,
          }
        : BUILD_COMMERCE,
    [hydrated, storedDomain],
  );

  return { commerce, hydrated, storedDomain, setStoreDomain };
}
```

In `demo-workspace.tsx`, drop the `commerce = ACTIVE_COMMERCE` default. `DemoWorkspaceContent` calls `useCommerceContext()` and uses the prop only when one is passed, so tests can still inject a fixed context:

```tsx
export function DemoWorkspace({ store, commerce, guideHref }: DemoWorkspaceProps = {}) {
  return (
    <SceneStoreProvider store={store}>
      <DemoWorkspaceContent commerce={commerce} guideHref={guideHref} />
    </SceneStoreProvider>
  );
}
```

and inside `DemoWorkspaceContent`, whose prop is now optional and renamed at the
destructuring site so the resolved value keeps the name the JSX below already
uses:

```tsx
function DemoWorkspaceContent({
  commerce: commerceOverride,
  guideHref,
}: {
  /** Injected by the tests; the running app uses the hook. */
  commerce?: CommerceContext | undefined;
  guideHref?: string | undefined;
}) {
  const controller = useCommerceContext();
  const commerce = commerceOverride ?? controller.commerce;
```

Keep `controller` in scope — Task 7 hands it to the chip.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/unit/use-commerce-context.test.tsx && pnpm vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/commerce src/features/demo/demo-workspace.tsx tests/unit/use-commerce-context.test.tsx
git commit -m "feat(commerce): let the running page choose the store"
```

---

### Task 7: The store chip and its popover

**Files:**
- Create: `src/features/demo/store-chip.tsx`
- Modify: `src/features/demo/demo-workspace.module.css` (chip and popover classes)
- Modify: `src/features/demo/workspace-header.tsx:31-60`
- Modify: `src/features/demo/demo-workspace.tsx` (pass the controller into the header)
- Test: `tests/unit/store-chip.test.tsx`

**Interfaces:**
- Consumes: `CommerceController` (Task 6), `parseStoreDomain` / `domainRejectionMessage` (Task 1), `probeStoreCapability` / `ProbeOutcome` (Task 3).
- Produces:
  ```ts
  export interface StoreChipProps {
    controller: CommerceController;
    /** Injected by the tests; defaults to the real probe. */
    probe?: typeof probeStoreCapability;
  }
  export function StoreChip(props: StoreChipProps): JSX.Element;
  export function probeMessage(outcome: ProbeOutcome, domain: string): string;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/store-chip.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StoreChip } from "../../src/features/demo/store-chip";
import type { CommerceController } from "../../src/features/commerce/use-commerce-context";
import type { ProbeOutcome } from "../../src/features/commerce/store-probe";

afterEach(cleanup);

function controllerFor(
  storeDomain: string | null,
  setStoreDomain = vi.fn(() => true),
): CommerceController {
  return {
    commerce: {
      config:
        storeDomain === null
          ? { status: "unconfigured", reason: "not-configured" }
          : {
              status: "connected",
              storeDomain,
              mcpEndpoint: `https://${storeDomain}/api/ucp/mcp`,
              agentProfileUrl: null,
            },
      variants: {},
    },
    hydrated: true,
    storedDomain: storeDomain,
    setStoreDomain,
  };
}

const ok = vi.fn(async (): Promise<ProbeOutcome> => ({ status: "ok", tools: [] }));

describe("StoreChip", () => {
  it("shows the connected store", () => {
    render(<StoreChip controller={controllerFor("openroom-x.myshopify.com")} probe={ok} />);
    expect(screen.getByRole("button", { name: /openroom-x\.myshopify\.com/ })).toBeVisible();
  });

  it("invites a connection when there is no store", () => {
    render(<StoreChip controller={controllerFor(null)} probe={ok} />);
    expect(screen.getByRole("button", { name: "Connect a store" })).toBeVisible();
  });

  it("rejects a malformed address without probing", async () => {
    const setStoreDomain = vi.fn(() => true);
    const probe = vi.fn(async (): Promise<ProbeOutcome> => ({ status: "ok", tools: [] }));
    render(<StoreChip controller={controllerFor(null, setStoreDomain)} probe={probe} />);

    fireEvent.click(screen.getByRole("button", { name: "Connect a store" }));
    fireEvent.change(screen.getByLabelText("Store address"), {
      target: { value: "openroom" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("Add the full address, like openroom.myshopify.com"),
    ).toBeVisible();
    expect(probe).not.toHaveBeenCalled();
    expect(setStoreDomain).not.toHaveBeenCalled();
  });

  it("saves a store that offers the cart tools", async () => {
    const setStoreDomain = vi.fn(() => true);
    render(<StoreChip controller={controllerFor(null, setStoreDomain)} probe={ok} />);

    fireEvent.click(screen.getByRole("button", { name: "Connect a store" }));
    fireEvent.change(screen.getByLabelText("Store address"), {
      target: { value: "https://Chosen.myshopify.com/admin" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(setStoreDomain).toHaveBeenCalledWith("chosen.myshopify.com");
    });
  });

  it("saves with a warning when the cart tools are missing", async () => {
    const setStoreDomain = vi.fn(() => true);
    const probe = vi.fn(async (): Promise<ProbeOutcome> => ({
      status: "missing-cart-tools",
      tools: ["search_shop_policies_and_faqs"],
    }));
    render(<StoreChip controller={controllerFor(null, setStoreDomain)} probe={probe} />);

    fireEvent.click(screen.getByRole("button", { name: "Connect a store" }));
    fireEvent.change(screen.getByLabelText("Store address"), {
      target: { value: "chosen.myshopify.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/does not offer cart tools/)).toBeVisible();
    expect(setStoreDomain).toHaveBeenCalledWith("chosen.myshopify.com");
  });

  it("refuses to save a store it cannot reach", async () => {
    const setStoreDomain = vi.fn(() => true);
    const probe = vi.fn(async (): Promise<ProbeOutcome> => ({ status: "unreachable" }));
    render(<StoreChip controller={controllerFor(null, setStoreDomain)} probe={probe} />);

    fireEvent.click(screen.getByRole("button", { name: "Connect a store" }));
    fireEvent.change(screen.getByLabelText("Store address"), {
      target: { value: "chosen.myshopify.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/Could not reach a Shopify store/)).toBeVisible();
    expect(setStoreDomain).not.toHaveBeenCalled();
  });

  it("says so when the browser will not remember the store", async () => {
    const setStoreDomain = vi.fn(() => false);
    render(<StoreChip controller={controllerFor(null, setStoreDomain)} probe={ok} />);

    fireEvent.click(screen.getByRole("button", { name: "Connect a store" }));
    fireEvent.change(screen.getByLabelText("Store address"), {
      target: { value: "chosen.myshopify.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("This browser will not remember the store"),
    ).toBeVisible();
  });

  it("returns to the sample store", () => {
    const setStoreDomain = vi.fn(() => true);
    render(
      <StoreChip
        controller={controllerFor("chosen.myshopify.com", setStoreDomain)}
        probe={ok}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /chosen\.myshopify\.com/ }));
    fireEvent.click(screen.getByRole("button", { name: "Use the sample store" }));
    expect(setStoreDomain).toHaveBeenCalledWith(null);
  });

  // The spec asks for validation as you type but a message only on blur or
  // Save; judging a half-typed domain is noise.
  it("stays quiet while the address is being typed", () => {
    const probe = vi.fn(async (): Promise<ProbeOutcome> => ({ status: "ok", tools: [] }));
    render(<StoreChip controller={controllerFor(null)} probe={probe} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect a store" }));

    const field = screen.getByLabelText("Store address");
    fireEvent.change(field, { target: { value: "open" } });
    expect(screen.queryByText(/Add the full address/)).toBeNull();
    expect(probe).not.toHaveBeenCalled();

    fireEvent.blur(field);
    expect(screen.getByText("Add the full address, like openroom.myshopify.com")).toBeVisible();
    expect(probe).not.toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    render(<StoreChip controller={controllerFor(null)} probe={ok} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect a store" }));
    expect(screen.getByLabelText("Store address")).toBeVisible();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByLabelText("Store address")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/store-chip.test.tsx`
Expected: FAIL — cannot resolve `store-chip`.

- [ ] **Step 3: Write the implementation**

Create `src/features/demo/store-chip.tsx` with a `<button>` chip and a `role="dialog"` popover. Behaviour, in the order the Save handler runs it:

1. `parseStoreDomain(value)`; on failure render `domainRejectionMessage(rejection)` and **return before any fetch**.
2. Set a pending state that disables Save and reads "Checking…".
3. `await probe(domain)`.
4. Switch on the outcome, using `probeMessage`:

```ts
export function probeMessage(outcome: ProbeOutcome, domain: string): string {
  switch (outcome.status) {
    case "ok":
      return "Connected. This store speaks the cart protocol.";
    case "missing-cart-tools":
      return "This store answers but does not offer cart tools. Checkout links will still work; an agent cannot build the cart.";
    case "unreachable":
      return `Could not reach a Shopify store at ${domain}. Check the address, or that the store is published.`;
    case "not-shopify":
      return "That address answered, but not as a Shopify store.";
  }
}
```

5. `ok` and `missing-cart-tools` call `controller.setStoreDomain(domain)`; the other two do not. When `setStoreDomain` returns false, also render "This browser will not remember the store".
6. "Use the sample store" calls `controller.setStoreDomain(null)` and closes.

Render the chip label as `controller.commerce.config.status === "connected" ? config.storeDomain : "Connect a store"`, and while `!controller.hydrated` render a neutral `Store` label so a stored domain does not arrive as a flash of the wrong one.

Reuse the approval sheet's Escape and focus-trap handling rather than inventing a second convention; lift the trap helper out of `cart-approval-sheet.tsx` if that is cleaner than duplicating it.

Wire it in `workspace-header.tsx` by adding a `storeChip?: ReactNode` prop rendered at the start of `styles.headerStatus`, and pass `<StoreChip controller={controller} />` from `demo-workspace.tsx`. A prop rather than a direct import keeps the header free of commerce imports, matching how it already takes `scene` and `dispatch` rather than reaching for them.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/unit/store-chip.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/demo tests/unit/store-chip.test.tsx
git commit -m "feat(demo): connect a store from the header"
```

---

### Task 8: The approval sheet's three states

**Files:**
- Modify: `src/features/demo/cart-approval-sheet.tsx:108-135, 245-275`
- Modify: `src/features/demo/demo-workspace.module.css`
- Test: `tests/unit/cart-approval-sheet.test.tsx`

**Interfaces:**
- Consumes: `CommerceDraft.productLinks` (Task 4), `CommerceConfig.status` (Task 5).
- Produces: no new exports; the sheet's rendered contract is the deliverable.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/cart-approval-sheet.test.tsx`:

```tsx
describe("CartApprovalSheet without a permalink", () => {
  it("offers the product links instead", () => {
    const draft = agentDraft();
    const unmapped = {
      ...draft,
      commerce: { ...draft.commerce!, checkoutPermalink: null },
    };
    render(
      <CartApprovalSheet commerce={SHOPIFY_COMMERCE} dispatch={vi.fn()} draft={unmapped} />,
    );

    const button = screen.getByRole("button", {
      name: `Open 2 products on ${PLACEHOLDER_STORE_DOMAIN}`,
    });
    fireEvent.click(button);

    // Expanded in place: opening N tabs at once is what popup blockers eat.
    const links = screen.getAllByRole("link", { name: /Oak Frame Table|Rice Paper Floor Lamp/ });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute(
      "href",
      `https://${PLACEHOLDER_STORE_DOMAIN}/products/oak-frame-table`,
    );
  });
});

describe("CartApprovalSheet with no store", () => {
  it("asks for a store instead of offering checkout", () => {
    render(
      <CartApprovalSheet
        commerce={UNCONFIGURED_COMMERCE}
        dispatch={vi.fn()}
        draft={{ ...mappedDraft(), commerce: undefined }}
      />,
    );
    expect(screen.getByRole("button", { name: "Connect a store" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Continue to Shopify/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Approve demo cart/ })).toBeNull();
  });
});
```

Delete the two existing `describe("CartApprovalSheet in demo mode")` blocks that assert `Approve demo cart` and the demo disclosure copy, and rename the remaining demo-mode cases that were really testing list rendering to run under `SHOPIFY_COMMERCE`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/cart-approval-sheet.test.tsx`
Expected: FAIL — no "Open 2 products" or "Connect a store" button.

- [ ] **Step 3: Write the implementation**

In `cart-approval-sheet.tsx`:
- delete the `isShopify ? … : "Approve demo cart"` ternary and the demo half of the disclosure paragraph;
- compute the primary action from three cases:
  - `checkoutUrl !== null` → **Continue to Shopify · {total}**, unchanged handler;
  - store connected, no permalink → **Open {n} products on {storeDomain}**, which toggles a `<ul>` of `<a target="_blank" rel="noreferrer">` built from `commerceDraft.productLinks`, matched to titles by `productId`;
  - unconfigured → **Connect a store**, dispatching a new `DemoAction` of `{ type: "open-store-settings" }` that the workspace turns into opening the chip's popover. Add that action to `demo-types.ts` and handle it in `demoReducer`.
- keep the disclosure paragraph for the connected cases, and replace it with the `configurationNotice` text when unconfigured.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/unit/cart-approval-sheet.test.tsx && pnpm vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/demo tests/unit/cart-approval-sheet.test.tsx
git commit -m "feat(demo): three honest endings for the approval sheet"
```

---

### Task 9: Tool contract

**Files:**
- Modify: `src/webmcp/tool-context.ts:38-44` (`CartApprovalDraft.commerce` becomes required)
- Modify: `src/webmcp/tool-handlers.ts:530-551`
- Modify: `src/webmcp/tool-result.ts:5-12` (new error code)
- Modify: `src/webmcp/core-tool-manifest.ts:66-72`
- Modify: `src/features/commerce/shopify-cart.ts` (`enrichCartDraft`)
- Modify: `tests/evals/webmcp-journeys.json`
- Test: `tests/unit/webmcp-tools.test.ts`, `tests/unit/tool-contracts.test.ts`, `tests/unit/core-tool-manifest.test.ts`

**Interfaces:**
- Consumes: `buildCommerceDraft` (Task 4), `CommerceConfig.status` (Task 5).
- Produces: `ToolErrorCode` gains `"NO_STORE_CONNECTED"`.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/webmcp-tools.test.ts`:

Replace the existing `test("omits commerce in demo mode", …)` at the top of
`describe("add_scene_to_cart commerce block")` — there is no demo mode to omit
for any more — with this, using the same harness the neighbouring cases use
(`createContext(store, catalog, commerce)` returns `{ context, drafts }`, and
`createContext`'s third parameter now defaults to `UNCONFIGURED_COMMERCE`):

```ts
test("refuses to open a draft when no store is connected", async () => {
  const store = createSceneStore();
  const { context, drafts } = createContext(store, DEMO_PRODUCTS, UNCONFIGURED_COMMERCE);
  const tools = createCoreTools(context);

  // Put one product-backed object in the room, so the refusal is about the
  // store rather than about an empty cart.
  await execute(tools, "replace_object", {
    objectId: "table_01",
    productId: "oak-frame-table",
    expectedRevision: store.getState().scene.revision,
    expectedStateVersion: store.getState().stateVersion,
  });

  const result = await execute(tools, "add_scene_to_cart", {
    expectedRevision: store.getState().scene.revision,
    expectedStateVersion: store.getState().stateVersion,
  });

  expect(result.structuredContent.ok).toBe(false);
  expect(errorCode(result)).toBe("NO_STORE_CONNECTED");
  if (result.structuredContent.ok) return;
  expect(result.structuredContent.error.retryable).toBe(true);
  // Nothing to act on means nothing opens.
  expect(drafts).toHaveLength(0);
});
```

Rename the `DEMO_COMMERCE` import in this file to `UNCONFIGURED_COMMERCE`
(Task 5 renamed the fixture) and update `createContext`'s default parameter at
`tests/unit/webmcp-tools.test.ts:39`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/webmcp-tools.test.ts`
Expected: FAIL — a draft is returned instead of an error.

- [ ] **Step 3: Write the implementation**

- `tool-result.ts`: add `"NO_STORE_CONNECTED"` to `ToolErrorCode`.
- `tool-handlers.ts`: after the `NO_CART_ITEMS` guard, before `enrichCartDraft`:

```ts
    if (context.commerce.config.status !== "connected") {
      return toolError(
        "add_scene_to_cart",
        snapshot.scene.revision,
        snapshot.stateVersion,
        "NO_STORE_CONNECTED",
        "No Shopify store is connected. Ask the person to connect one from the store chip in the header.",
        true,
      );
    }
```
  Add the same message to the `commandFailure` message table if the code is reachable there.
- `tool-context.ts`: `commerce: CommerceDraft;` — no longer optional.
- `shopify-cart.ts`: `enrichCartDraft` now always returns `{ ...draft, commerce: block }`; keep its `null` guard only as an internal invariant check with a comment saying the handler filters unconfigured stores out first.
- `core-tool-manifest.ts`: rewrite the `add_scene_to_cart` description to name `productLinks` and the `NO_STORE_CONNECTED` failure alongside the existing text.
- `tests/evals/webmcp-journeys.json`: edit the `cart-approval-shopify-lines` entry's assertions to mention `productLinks`, and add one journey:

```json
  {
    "id": "cart-without-a-store",
    "prompt": "Add the product-backed scene objects to the cart",
    "expectedTools": ["add_scene_to_cart"],
    "assertions": [
      "With no store connected, add_scene_to_cart fails with NO_STORE_CONNECTED and opens no dialog",
      "The error is retryable and names connecting a store as the fix",
      "No external request is made"
    ]
  },
```
  Edit the file as text, not by re-serializing it — `json.dumps` reflows every array in it. Then bump the count in `tests/unit/tool-contracts.test.ts` and add the new id to its `arrayContaining` list.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webmcp src/features/commerce tests
git commit -m "feat(webmcp): fail loudly when no store is connected"
```

---

### Task 10: Browser journeys and the documents that describe the rules

**Files:**
- Modify: `tests/e2e/demo-workspace.spec.ts:186-196`
- Modify: `tests/e2e/webmcp-core.spec.ts:270-286`
- Modify: `tests/e2e/commerce/shopify-checkout.spec.ts` (add a probe-fence assertion)
- Modify: `AGENTS.md`
- Modify: `README.md`, `examples/shopify/README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing importable.

- [ ] **Step 1: Move the demo journeys to the unconfigured state**

`playwright.config.ts` now pins an empty store domain, so both journeys land unconfigured. In `demo-workspace.spec.ts`, the assertion on the approval button becomes:

```ts
  await expect(
    dialog.getByRole("button", { name: "Connect a store" }),
  ).toBeInViewport();
```

In `webmcp-core.spec.ts`, the disclosure assertion becomes:

```ts
  await expect(dialog.getByText("No Shopify store is connected yet.")).toBeVisible();
```

Leave `expect(await page.evaluate(() => window.__webMcpFetchCount)).toBe(0)` and the `externalRequestsDuringCart` assertion exactly as they are. They are the fence: the probe lives outside these flows, and a regression that starts probing on load fails here.

- [ ] **Step 2: Run the demo journeys**

Stop any `next dev` first.
Run: `pnpm test:e2e`
Expected: 11 passed.

- [ ] **Step 3: Add the probe fence to the commerce journey**

In `tests/e2e/commerce/shopify-checkout.spec.ts`, in the `add_scene_to_cart` test, assert that no request reached `/api/ucp/mcp` during the cart flow — the spec's "nowhere else" clause, held by a test rather than by intention:

```ts
  const probeRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/ucp/mcp")) probeRequests.push(request.url());
  });
  // …existing journey…
  expect(probeRequests).toEqual([]);
```

- [ ] **Step 4: Run the commerce journeys**

Run: `pnpm test:e2e:commerce`
Expected: 2 passed.

- [ ] **Step 5: Rewrite the rules the code no longer follows**

In `AGENTS.md`, replace the commerce paragraph's "`demo` is the default" clause. The replacement states the narrower rule and the fence:

> Commerce stays token-free and server-free: a build either names a store in `NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN` or the app is unconfigured, Shopify works through cart permalinks, per-product handle links, and the store's UCP MCP endpoint, and no access token or server cart route may be added without a new approved spec. OpenRoom issues exactly one external request — an unauthenticated `tools/list` to `/api/ucp/mcp`, only when a person presses Save in the store popover. Page load, editing, and `add_scene_to_cart` still issue none, and the E2E request assertions hold that line.

Update the `add_scene_to_cart` file list in the same paragraph to include `store-domain.ts`, `store-probe.ts`, and `store-storage.ts`.

In `README.md` and `examples/shopify/README.md`, replace any description of demo mode with the connected/unconfigured pair, and describe the store chip.

- [ ] **Step 6: Full verification**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm test:e2e && pnpm test:e2e:commerce`
Expected: all pass, `pnpm lint` with 0 errors.

- [ ] **Step 7: Commit**

```bash
git add tests AGENTS.md README.md examples/shopify/README.md
git commit -m "docs: one store, one request, and the tests that hold both"
```

---

## Spec coverage

| Spec section | Task |
| --- | --- |
| §1 configuration model, `resolveCommerceConfig`, provider removal | 5 |
| §1 persistence, hostile `localStorage`, hydration flash | 2, 6 |
| §1 wiring, `useCommerceContext` | 6 |
| §2 normalization, acceptance, rejection messages | 1 |
| §2 capability probe, outcomes table, timeout | 3, 7 |
| §3 store chip and popover | 7 |
| §4 `productLinks`, three-state primary action | 4, 8 |
| §5 tool contract, `NO_STORE_CONNECTED`, evals, `AGENTS.md` | 9, 10 |
| §6 frontend-only, the one request and its fence | 3, 10 |
| §7 testing | every task; E2E in 10 |
