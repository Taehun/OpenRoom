# Nook Local MCP Companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Claude Desktop and Claude Code list and execute Nook's exact WebMCP Core 6 against one explicitly paired live browser tab, while ChatGPT Work and Codex continue using native `document.modelContext` registration.

**Architecture:** One serializable Core 6 manifest feeds both adapters. A localhost-only Node companion serves MCP over stdio and a separately authenticated page relay over `127.0.0.1`; it stores no Scene state. The paired page long-polls for calls and executes the same `createCoreTools(context)` descriptors used by native WebMCP, then returns the unchanged structured `ToolResult`.

**Tech Stack:** Node.js 24.13.1, TypeScript 5 via `tsx`, official MCP TypeScript SDK v2 server/client packages, Next.js 16.3.3, React 19.2.8, Zod 4, Web Crypto, loopback HTTP, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-01-nook-photo-compositor-design.md`

## Global Constraints

- Execute this plan on top of the completed photo-compositor plan. The pairing status UI extends its prompt-guidance card; do not reintroduce 3D or the fake in-page agent action.
- Before editing React or client/server boundary code, read the installed Next 16.3.3 guides named in Task 1.
- Verify MCP API imports against the current official v2 documentation before installing or writing SDK code: `https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio.html`, `https://ts.sdk.modelcontextprotocol.io/v2/servers/tools.html`, and `https://ts.sdk.modelcontextprotocol.io/v2/advanced/schema-libraries.html`.
- Use `@modelcontextprotocol/server` as the only new runtime dependency. `@modelcontextprotocol/client` and `tsx` are development-only dependencies. Do not upgrade unrelated packages.
- Keep one implementation of Core 6 behavior: native WebMCP and the page relay both execute descriptors returned by `createCoreTools(context)`.
- Keep one serializable source for tool name, description, input JSON Schema, and annotations. Zod remains the browser's strict runtime validator.
- Bind HTTP only to `127.0.0.1`; never listen on `0.0.0.0`, `::`, or a LAN interface.
- Allow exactly `http://localhost:3000` and `http://127.0.0.1:3000` by default. Add deployed origins only from exact, parsed `NOOK_ALLOWED_ORIGINS` entries.
- Require a six-digit, ten-minute, single-use pair code, exact origin, manifest hash, and page nonce before issuing a random in-memory bearer token.
- Permit one paired page, at most eight pending calls, 64 KiB request bodies, 30-second calls, and a 45-second authenticated-poll heartbeat. Do not retry mutations after a disconnect or timeout.
- Send MCP protocol data only to stdout. Send pair code, port, status, and errors only to stderr.
- Forward only Core 6. Do not expose filesystem, shell, network, arbitrary JavaScript, generic execute, batch mutation, Shopify, Tripo, R2, or D1.
- Keep cart requests approval-only in the paired page and assert zero external cart requests.
- Do not modify the user's global Claude Desktop or Claude Code configuration; document copyable examples only.
- Leave the branch unmerged and unpushed after implementation.

## File Map

Create:

- `src/webmcp/core-tool-manifest.ts` — ordered serializable Core 6 descriptors and portable hash.
- `src/local-mcp/relay-protocol.ts` — shared Zod request/result contracts and security constants.
- `src/local-mcp/page-relay-client.ts` — authenticated pair/poll/result HTTP client.
- `src/local-mcp/use-local-mcp-relay.ts` — React lifecycle around live Core 6 execution.
- `src/features/demo/local-agent-status.tsx` — manual Claude pairing and status UI.
- `scripts/nook-mcp/session-registry.ts` — in-memory pairing/session/pending-call state machine.
- `scripts/nook-mcp/relay-http.ts` — loopback HTTP server, CORS/PNA, size and auth enforcement.
- `scripts/nook-mcp/mcp-server.ts` — official SDK Core 6 registrations forwarding to the registry.
- `scripts/nook-mcp/server.ts` — process composition, stderr diagnostics, and shutdown.
- `tests/unit/core-tool-manifest.test.ts`
- `tests/unit/relay-protocol.test.ts`
- `tests/unit/session-registry.test.ts`
- `tests/unit/relay-http.test.ts`
- `tests/unit/page-relay-client.test.ts`
- `tests/unit/use-local-mcp-relay.test.tsx`
- `tests/integration/local-mcp-companion.test.ts`
- `docs/local-mcp.md`

Modify:

- `src/webmcp/tool-handlers.ts` — consume the shared manifest without changing handler semantics.
- `src/features/demo/room-canvas.tsx` — mount pairing status in the prompt-guidance card.
- `src/features/demo/demo-workspace.tsx` — provide the same `ToolContext` to the relay hook.
- `src/features/demo/demo-workspace.module.css`
- `tests/unit/register-tools.test.tsx`
- `tests/unit/tool-contracts.test.ts`
- `tests/unit/demo-workspace.test.tsx`
- `tests/e2e/webmcp-core.spec.ts`
- `vitest.config.ts` — include Node integration tests only if an explicit CLI include is insufficient.
- `package.json`
- `pnpm-lock.yaml`
- `README.md`
- `docs/NEXT_SESSION.md`

---

### Task 1: One Serializable Core 6 Manifest for Both Adapters

**Files:**

- Create: `src/webmcp/core-tool-manifest.ts`
- Create: `tests/unit/core-tool-manifest.test.ts`
- Modify: `src/webmcp/tool-handlers.ts`
- Modify: `tests/unit/tool-contracts.test.ts`
- Modify: `tests/unit/register-tools.test.tsx`

**Interfaces:**

- Consumes: existing `CORE_TOOL_NAMES`, six JSON Schema constants, exact tool descriptions, annotations, Zod schemas, and handler bodies.
- Produces: ordered `CORE_TOOL_MANIFEST`, `CoreToolManifestEntry`, `canonicalManifestJson()`, and async `getCoreToolManifestHash()` consumed by browser registration, page pairing, and the stdio server.

- [ ] **Step 1: Read the installed framework guides and current SDK pages**

Run:

```bash
sed -n '1,240p' node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md
sed -n '1,220p' node_modules/next/dist/docs/01-app/02-guides/server-and-client-boundary.md
sed -n '1,220p' node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md
```

Open the three official MCP v2 URLs from Global Constraints and confirm the current package names and these APIs before coding:

```ts
import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
```

If official v2 exports differ, use the documented v2 imports and record that exact adjustment in the plan execution notes; do not fall back to a legacy monolithic SDK from memory.

- [ ] **Step 2: Write failing manifest parity tests**

Create `tests/unit/core-tool-manifest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createCoreTools } from "../../src/webmcp/tool-handlers";
import {
  CORE_TOOL_MANIFEST,
  canonicalManifestJson,
  getCoreToolManifestHash,
} from "../../src/webmcp/core-tool-manifest";
import { CORE_TOOL_NAMES } from "../../src/webmcp/tool-contracts";

describe("Core 6 manifest", () => {
  it("is exact, ordered, serializable, and stable", async () => {
    expect(CORE_TOOL_MANIFEST.map(({ name }) => name)).toEqual(CORE_TOOL_NAMES);
    expect(JSON.parse(JSON.stringify(CORE_TOOL_MANIFEST))).toEqual(CORE_TOOL_MANIFEST);
    expect(canonicalManifestJson()).toBe(canonicalManifestJson());
    expect(await getCoreToolManifestHash()).toMatch(/^[a-f0-9]{64}$/);
  });

  it("matches every browser descriptor field", () => {
    const tools = createCoreTools(fakeToolContext());
    for (const [index, tool] of tools.entries()) {
      const entry = CORE_TOOL_MANIFEST[index];
      expect(tool).toMatchObject({
        name: entry.name,
        description: entry.description,
        inputSchema: entry.inputSchema,
        annotations: entry.annotations,
      });
    }
  });
});
```

Extend contract tests to prove representative inputs are accepted/rejected by both the existing Zod schema and manifest JSON Schema. Preserve strict nested `additionalProperties: false` and maximums.

- [ ] **Step 3: Run the targeted tests and record RED**

Run:

```bash
pnpm exec vitest run tests/unit/core-tool-manifest.test.ts tests/unit/tool-contracts.test.ts tests/unit/register-tools.test.tsx
```

Expected: FAIL because the shared manifest does not exist and browser descriptor metadata is still inline.

- [ ] **Step 4: Implement canonical manifest serialization and hashing**

Define the manifest entry shape:

```ts
export interface CoreToolManifestEntry {
  name: CoreToolName;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
  annotations: {
    readOnlyHint: boolean;
    untrustedContentHint: boolean;
  };
}

export const CORE_TOOL_MANIFEST = [
  {
    name: "get_scene",
    description: "Return the current validated Scene.",
    inputSchema: GET_SCENE_JSON_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
  },
  {
    name: "get_selection",
    description: "Return the currently selected Scene object.",
    inputSchema: GET_SELECTION_JSON_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
  },
  {
    name: "search_products",
    description: "Search the local product catalog in deterministic order.",
    inputSchema: SEARCH_PRODUCTS_JSON_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
  },
  {
    name: "replace_object",
    description: "Replace an explicit or selected Scene object with a catalog product.",
    inputSchema: REPLACE_OBJECT_JSON_SCHEMA,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
  },
  {
    name: "move_object",
    description: "Move an explicit or selected Scene object.",
    inputSchema: MOVE_OBJECT_JSON_SCHEMA,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
  },
  {
    name: "add_scene_to_cart",
    description: "Open a local approval draft for product-backed Scene objects.",
    inputSchema: ADD_SCENE_TO_CART_JSON_SCHEMA,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
  },
] as const satisfies readonly CoreToolManifestEntry[];
```

Implement recursive key sorting for `canonicalManifestJson()` so hash equality is independent of object insertion order. Hash the canonical UTF-8 byte array with `globalThis.crypto.subtle.digest("SHA-256", canonicalBytes)` and encode lowercase hex. Do not hard-code a digest that can drift from the schemas.

- [ ] **Step 5: Refactor handler construction without changing behavior**

Move each current inline `execute` body without edits into a named local
function, then build an exact-name handler map:

```ts
type ToolExecutor = ModelContextTool["execute"];
const executors: Record<CoreToolName, ToolExecutor> = {
  get_scene: executeGetScene,
  get_selection: executeGetSelection,
  search_products: executeSearchProducts,
  replace_object: executeReplaceObject,
  move_object: executeMoveObject,
  add_scene_to_cart: executeAddSceneToCart,
};

return CORE_TOOL_MANIFEST.map((entry) => ({
  ...entry,
  execute: executors[entry.name],
}));
```

Keep executors inside `createCoreTools(context)` if they close over context. Do not change validation order, abort checks, error envelope, mutation count, or cart side effects.

- [ ] **Step 6: Verify GREEN and commit**

Run:

```bash
pnpm exec vitest run tests/unit/core-tool-manifest.test.ts tests/unit/tool-contracts.test.ts tests/unit/webmcp-tools.test.ts tests/unit/register-tools.test.tsx
pnpm run typecheck
git diff --check
```

Expected: all Core 6 behavior and registration cleanup remain green.

Commit:

```bash
git add src/webmcp/core-tool-manifest.ts src/webmcp/tool-handlers.ts tests/unit/core-tool-manifest.test.ts tests/unit/tool-contracts.test.ts tests/unit/register-tools.test.tsx
git commit -m "refactor(webmcp): share serializable Core 6 manifest"
```

---

### Task 2: Relay Protocol and In-Memory Session State Machine

**Files:**

- Create: `src/local-mcp/relay-protocol.ts`
- Create: `scripts/nook-mcp/session-registry.ts`
- Create: `tests/unit/relay-protocol.test.ts`
- Create: `tests/unit/session-registry.test.ts`

**Interfaces:**

- Consumes: `CoreToolName`, `ToolResult<unknown>`, exact allowed-origin strings, injected clock/random functions, and AbortSignals from MCP calls.
- Produces: strict relay Zod schemas, security constants, `SessionRegistry`, one-time pair issuance, authenticated polling, pending-call resolution, expiry, and disconnect behavior.

- [ ] **Step 1: Write failing strict protocol tests**

Create `relay-protocol.test.ts` for exact constants and strict bodies:

```ts
expect(PAIR_CODE_TTL_MS).toBe(10 * 60_000);
expect(MAX_BODY_BYTES).toBe(64 * 1024);
expect(MAX_PENDING_CALLS).toBe(8);
expect(CALL_TIMEOUT_MS).toBe(30_000);
expect(HEARTBEAT_TIMEOUT_MS).toBe(45_000);
expect(PairRequestSchema.safeParse({
  code: "123456",
  origin: "http://localhost:3000",
  manifestHash: "a".repeat(64),
  pageNonce: "n".repeat(32),
  extra: true,
}).success).toBe(false);
```

Schemas must cover:

```ts
PairRequest       { code, origin, manifestHash, pageNonce }
PairResponse      { sessionToken, expiresAt }
RelayToolCall     { requestId, toolName, input }
RelayToolResult   { requestId, result }
RelayError        { code, message, retryable }
```

Bound string lengths; require six ASCII digits, a 64-character lowercase SHA-256 hex hash, a 32..128 character nonce/token, and a request ID of 16..128 safe URL characters.

- [ ] **Step 2: Write failing registry state-machine tests**

Use fake time and deterministic token factories. Assert:

```ts
const issued = registry.issuePairCode();
expect(issued.code).toMatch(/^\d{6}$/);

const paired = registry.pair({
  code: issued.code,
  origin: "http://localhost:3000",
  manifestHash,
  pageNonce: "p".repeat(32),
});
expect(() => registry.pair({
  code: issued.code,
  origin: "http://localhost:3000",
  manifestHash,
  pageNonce: "q".repeat(32),
})).toThrowError("PAIR_REJECTED");
```

Also assert expired codes fail indistinguishably, origin/hash mismatches fail, a new successful pair invalidates the prior token and pending calls, ninth concurrent call is rejected, a 30-second call aborts and is never retried, a valid poll refreshes heartbeat, 45 seconds without a valid poll disconnects, wrong tokens cannot poll/resolve, result IDs can resolve once only, and explicit disconnect rejects all pending promises.

- [ ] **Step 3: Run targeted tests and record RED**

Run:

```bash
pnpm exec vitest run tests/unit/relay-protocol.test.ts tests/unit/session-registry.test.ts
```

Expected: FAIL because the protocol and registry do not exist.

- [ ] **Step 4: Implement shared protocol constants and schemas**

Create exact exported constants:

```ts
export const DEFAULT_RELAY_PORT = 43_110;
export const PAIR_CODE_TTL_MS = 10 * 60_000;
export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_PENDING_CALLS = 8;
export const CALL_TIMEOUT_MS = 30_000;
export const HEARTBEAT_TIMEOUT_MS = 45_000;
export const DEFAULT_ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
```

Use `.strict()` on every Zod object. `input` and `result` may be `z.unknown()` only inside an already authenticated envelope; tool input is validated again by the browser's existing Core 6 Zod schema.

- [ ] **Step 5: Implement `SessionRegistry` with injected nondeterminism**

Use this public surface:

```ts
export interface SessionRegistryOptions {
  manifestHash: string;
  allowedOrigins: ReadonlySet<string>;
  now?: () => number;
  randomBytes?: (length: number) => Uint8Array;
  onDiagnostic?: (message: string) => void;
}

export class SessionRegistry {
  issuePairCode(): { code: string; expiresAt: number };
  pair(input: PairRequest): PairResponse;
  poll(sessionToken: string, signal: AbortSignal): Promise<RelayToolCall | null>;
  forwardToolCall(toolName: CoreToolName, input: unknown, signal: AbortSignal): Promise<ToolResult<unknown>>;
  resolve(sessionToken: string, message: RelayToolResult): void;
  disconnect(sessionToken: string): void;
  sweepExpired(): void;
}
```

Queue only request ID, exact Core 6 name, input, resolver, and timeout handle. Store no Scene, selection, catalog, cart, photograph, or completed result. Abort on caller signal, timeout, session replacement, heartbeat expiry, or process shutdown. A timeout rejects with a typed relay error; it never queues another request.

- [ ] **Step 6: Verify GREEN and commit**

Run:

```bash
pnpm exec vitest run tests/unit/relay-protocol.test.ts tests/unit/session-registry.test.ts
pnpm run typecheck
git diff --check
```

Expected: all security-boundary state tests pass deterministically.

Commit:

```bash
git add src/local-mcp/relay-protocol.ts scripts/nook-mcp/session-registry.ts tests/unit/relay-protocol.test.ts tests/unit/session-registry.test.ts
git commit -m "feat(mcp): define secure local relay sessions"
```

---

### Task 3: Loopback HTTP Relay with Origin, PNA, Size, and Auth Enforcement

**Files:**

- Create: `scripts/nook-mcp/relay-http.ts`
- Create: `tests/unit/relay-http.test.ts`

**Interfaces:**

- Consumes: `SessionRegistry`, configured port/origins, authenticated bearer token, strict relay schemas.
- Produces: an HTTP server bound to `127.0.0.1` with `/v1/pair`, `/v1/calls`, `/v1/results/:requestId`, `/v1/session`, and valid CORS/PNA preflights.

- [ ] **Step 1: Write failing endpoint/security tests in Node environment**

Start the server on port `0` in each test and call its returned loopback address. Include `// @vitest-environment node` at the test file top. Cover:

```ts
expect(server.address().address).toBe("127.0.0.1");

await expectResponse(pair({ origin: "https://evil.example" }), 403);
await expectResponse(pair({ manifestHash: "0".repeat(64) }), 403);
await expectResponse(rawBody(MAX_BODY_BYTES + 1), 413);
await expectResponse(poll({ token: "wrong" }), 401);
await expectResponse(resolve({ contentType: "text/plain" }), 415);
await expectResponse(method("PUT", "/v1/pair"), 405);
```

Assert valid preflight echoes the exact allowed Origin, includes `Vary: Origin`, allows only required methods/headers, and includes `Access-Control-Allow-Private-Network: true` only when the request asks for private-network access. Disallowed origin preflights return 403 without permissive CORS headers. Assert response bodies never contain pair code, active token, manifest contents, or stack traces.

- [ ] **Step 2: Run the HTTP test and record RED**

Run:

```bash
pnpm exec vitest run tests/unit/relay-http.test.ts
```

Expected: FAIL because the HTTP relay does not exist.

- [ ] **Step 3: Implement exact origin parsing**

Parse allowed origins at process startup:

```ts
export function allowedOriginsFromEnv(value: string | undefined): ReadonlySet<string> {
  const origins = new Set(DEFAULT_ALLOWED_ORIGINS);
  for (const candidate of value?.split(",") ?? []) {
    const url = new URL(candidate.trim());
    if (url.origin !== candidate.trim() || url.username || url.password || url.pathname !== "/") {
      throw new Error(`Invalid NOOK_ALLOWED_ORIGINS entry: ${candidate}`);
    }
    origins.add(url.origin);
  }
  return origins;
}
```

Reject empty entries, wildcard origins, opaque origins, fragments, queries, credentials, and path-bearing URLs. Never reflect an origin until exact-set membership is confirmed.

- [ ] **Step 4: Implement body reader and authentication helpers**

Read at most `MAX_BODY_BYTES + 1`, stop and destroy the request body when over limit, accept only `application/json`, and parse once. Authenticate `Authorization: Bearer <token>` with constant-time byte comparison when lengths match. Never accept tokens in query strings or cookies.

- [ ] **Step 5: Implement the route table**

Use only these routes:

```text
OPTIONS /v1/*                 validate exact Origin and PNA preflight
POST    /v1/pair              PairRequest; compare Origin header to body origin
GET     /v1/calls             bearer auth; long-poll next call or 204
POST    /v1/results/:id       bearer auth; RelayToolResult ID must match path
DELETE  /v1/session           bearer auth; disconnect current page
```

All page requests require an allowed `Origin`; all except `/v1/pair` require bearer auth. Apply `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and exact CORS headers. Return small normalized JSON errors. A successful authenticated `/v1/calls` request refreshes heartbeat even when it ends with 204.

- [ ] **Step 6: Bind only to loopback and expose graceful close**

Export:

```ts
export async function startRelayHttpServer(options: {
  registry: SessionRegistry;
  port: number;
  allowedOrigins: ReadonlySet<string>;
}): Promise<{ port: number; close(): Promise<void> }>;
```

Call `server.listen(port, "127.0.0.1")` with no alternative host. `close()` must stop accepting requests, end long polls, and wait for server close.

- [ ] **Step 7: Verify GREEN and commit**

Run:

```bash
pnpm exec vitest run tests/unit/relay-http.test.ts tests/unit/session-registry.test.ts
pnpm run typecheck
pnpm run lint
git diff --check
```

Expected: all HTTP boundary tests pass and the listening address is loopback.

Commit:

```bash
git add scripts/nook-mcp/relay-http.ts tests/unit/relay-http.test.ts
git commit -m "feat(mcp): serve authenticated loopback relay"
```

---

### Task 4: Paired Page Relay and Manual Connection UI

**Files:**

- Create: `src/local-mcp/page-relay-client.ts`
- Create: `src/local-mcp/use-local-mcp-relay.ts`
- Create: `src/features/demo/local-agent-status.tsx`
- Create: `tests/unit/page-relay-client.test.ts`
- Create: `tests/unit/use-local-mcp-relay.test.tsx`
- Modify: `src/features/demo/room-canvas.tsx`
- Modify: `src/features/demo/demo-workspace.tsx`
- Modify: `src/features/demo/demo-workspace.module.css`
- Modify: `tests/unit/demo-workspace.test.tsx`

**Interfaces:**

- Consumes: manual six-digit code, relay URL, current page origin, manifest hash, same `ToolContext`, and `createCoreTools(context)`.
- Produces: connection state, authenticated long polling, exact descriptor execution with per-call AbortSignal, result posting, unload cleanup, and accessible status/pair controls.

- [ ] **Step 1: Write failing page-client tests**

Mock `fetch`, fake timers, and `crypto.getRandomValues`. Assert:

- Pair request uses `http://127.0.0.1:43110/v1/pair`, exact `window.location.origin`, manifest hash, and 32+ character page nonce.
- Token remains only in the client instance; it is not written to `localStorage`, `sessionStorage`, URL, DOM, logs, or React diagnostics.
- Poll sends bearer authorization and `cache: "no-store"`.
- A call for a name outside Core 6 posts `UNKNOWN_TOOL` without execution.
- Unmount/unload aborts poll, aborts an active descriptor, sends one best-effort authenticated `DELETE /v1/session`, and starts no replacement poll.
- Timeout/401/disconnect changes status and never retries a mutation request ID.

- [ ] **Step 2: Write failing relay-hook behavior tests**

Create a real Scene store and a `ToolContext`, then feed synthetic calls through a fake `PageRelayClient`:

```ts
await relay.deliver({ requestId: "req-1", toolName: "get_scene", input: {} });
expect(relay.results[0].result.structuredContent.ok).toBe(true);

await relay.deliver({
  requestId: "req-2",
  toolName: "move_object",
  input: { objectId: "lamp_01", position: { x: 0, z: 0 }, expectedRevision: 1, expectedStateVersion: 1 },
});
expect(store.getState().scene.revision).toBe(2);
expect(relay.results).toHaveLength(2);
```

Also assert duplicate request ID is not executed twice, stale move remains a structured revision conflict, locked replacement does not mutate, and `add_scene_to_cart` calls only `openCartApproval`.

- [ ] **Step 3: Run page tests and record RED**

Run:

```bash
pnpm exec vitest run tests/unit/page-relay-client.test.ts tests/unit/use-local-mcp-relay.test.tsx tests/unit/demo-workspace.test.tsx
```

Expected: FAIL because the page relay and status UI do not exist.

- [ ] **Step 4: Implement `PageRelayClient`**

Expose a small transport class:

```ts
export interface PageRelayClientOptions {
  baseUrl?: string;
  origin: string;
  fetchImpl?: typeof fetch;
  onCall(call: RelayToolCall, signal: AbortSignal): Promise<ToolResult<unknown>>;
  onStatus(status: LocalMcpStatus): void;
}

export class PageRelayClient {
  pair(code: string, manifestHash: string): Promise<void>;
  disconnect(): Promise<void>;
}
```

Default URL is `http://127.0.0.1:43110`; allow a non-default port from a visible advanced input, never from query parameters. Keep token and completed request IDs in memory. For each delivered call, create one AbortController, execute once, post one result, and then poll again. Reads may resume polling after a transport reconnect only after the user pairs again; never automatically replay a received mutation.

- [ ] **Step 5: Implement `useLocalMcpRelay(context)`**

Create the descriptor map once from the same factory:

```ts
const descriptors = useMemo(
  () => new Map(createCoreTools(context).map((tool) => [tool.name, tool])),
  [context],
);
```

The call handler looks up the exact name, calls `descriptor.execute(call.input, { signal })`, and returns its unchanged `ToolResult`. Compute manifest hash before pairing. On hook cleanup, call `disconnect()` and suppress intentional abort errors. Expose `{ status, pair, disconnect, relayPort, setRelayPort }` to the UI.

- [ ] **Step 6: Add the accessible pairing UI**

Mount `LocalAgentStatus` inside the photo plan's prompt-guidance card. Required copy and controls:

```text
ChatGPT / Codex: WebMCP available | unavailable
Claude: Not connected | Pairing… | Connected | Connection lost
Pairing code: [ six-digit input ] [ Connect Claude ]
```

The code input uses `inputMode="numeric"`, `pattern="[0-9]{6}"`, `maxLength={6}`, and an explicit label. Disable connect unless exactly six digits. Never render the session token. Provide a disconnect button only while connected and a concise note: “Start `pnpm mcp:nook`, then enter the code printed in that terminal.”

- [ ] **Step 7: Verify GREEN and commit**

Run:

```bash
pnpm exec vitest run tests/unit/page-relay-client.test.ts tests/unit/use-local-mcp-relay.test.tsx tests/unit/demo-workspace.test.tsx tests/unit/register-tools.test.tsx
pnpm run typecheck
pnpm run lint
git diff --check
```

Expected: page relay uses the real Core 6 factory, cleanup aborts active work, and the human UI remains usable without either adapter.

Commit:

```bash
git add src/local-mcp/page-relay-client.ts src/local-mcp/use-local-mcp-relay.ts src/features/demo/local-agent-status.tsx src/features/demo/room-canvas.tsx src/features/demo/demo-workspace.tsx src/features/demo/demo-workspace.module.css tests/unit/page-relay-client.test.ts tests/unit/use-local-mcp-relay.test.tsx tests/unit/demo-workspace.test.tsx
git commit -m "feat(mcp): pair live page with local relay"
```

---

### Task 5: Official MCP stdio Server, Real Client Integration, and Setup Docs

**Files:**

- Create: `scripts/nook-mcp/mcp-server.ts`
- Create: `scripts/nook-mcp/server.ts`
- Create: `tests/integration/local-mcp-companion.test.ts`
- Create: `docs/local-mcp.md`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `vitest.config.ts`
- Modify: `README.md`
- Modify: `docs/NEXT_SESSION.md`
- Modify: `tests/e2e/webmcp-core.spec.ts`

**Interfaces:**

- Consumes: official MCP SDK v2, shared manifest, `SessionRegistry`, loopback HTTP server, fake paired page in tests.
- Produces: `pnpm mcp:nook`, exact Core 6 `tools/list`, forwarded `tools/call`, real stdio integration evidence, graceful shutdown, and copyable Claude setup instructions.

- [ ] **Step 1: Install only the approved dependencies**

After confirming current official v2 package names, run:

```bash
pnpm add @modelcontextprotocol/server@^2
pnpm add -D @modelcontextprotocol/client@^2 tsx
```

Inspect the lockfile diff. Expected: those packages and their transitive requirements only; no unrelated direct dependency version changes.

- [ ] **Step 2: Add the companion script and failing real-client test**

Add:

```json
{
  "scripts": {
    "mcp:nook": "tsx scripts/nook-mcp/server.ts"
  }
}
```

Create `tests/integration/local-mcp-companion.test.ts` with `// @vitest-environment node`. Spawn the server through the official client transport, capture stderr to obtain the test pair code/port, and keep stdout exclusively owned by the MCP transport:

```ts
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const transport = new StdioClientTransport({
  command: "pnpm",
  args: ["--silent", "mcp:nook"],
  env: { ...process.env, NOOK_MCP_PORT: "0", NOOK_ALLOWED_ORIGINS: testOrigin },
  stderr: "pipe",
});
const client = new Client({ name: "nook-integration-test", version: "1.0.0" });
await client.connect(transport);
expect((await client.listTools()).tools.map(({ name }) => name)).toEqual(CORE_TOOL_NAMES);
```

Pair a fake page over actual HTTP, long-poll, answer `get_scene` with a structured ToolResult, then assert `client.callTool()` receives it unchanged. Test one `move_object` request ID, unpaired call failure, page disconnect, and clean process close. Do not use a mocked MCP server in this integration test.

- [ ] **Step 3: Run the integration test and record RED**

Run:

```bash
pnpm exec vitest run tests/integration/local-mcp-companion.test.ts
```

Expected: FAIL because the stdio server and process entry point do not exist.

- [ ] **Step 4: Register Core 6 with the official SDK**

Implement a factory; adapt import spelling only if the official v2 docs verified in Task 1 require it:

```ts
import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";

export function createNookMcpServer(registry: SessionRegistry): McpServer {
  const server = new McpServer({ name: "nook", version: "0.1.0" });
  for (const entry of CORE_TOOL_MANIFEST) {
    server.registerTool(
      entry.name,
      {
        description: entry.description,
        inputSchema: fromJsonSchema(entry.inputSchema),
        annotations: entry.annotations,
      },
      async (input, { signal }) => registry.forwardToolCall(entry.name, input, signal),
    );
  }
  return server;
}
```

Do not add resources, prompts, sampling, elicitation, roots, or generic tools. Before pairing, the handler returns an MCP tool error with concise `PAGE_UNAVAILABLE` text. After pairing, it returns the page's exact `content`, `structuredContent`, and `isError` fields.

- [ ] **Step 5: Compose process startup and shutdown**

`server.ts` must:

1. parse `NOOK_MCP_PORT` as `0` or an integer in `1024..65535` (default 43110),
2. parse exact allowed origins,
3. compute manifest hash,
4. create registry and issue one pair code,
5. start HTTP relay on `127.0.0.1`,
6. print port/code/expiry to `console.error`,
7. start stdio using the official v2 `serveStdio` API,
8. handle `SIGINT`/`SIGTERM` by aborting pending calls and closing HTTP exactly once.

The stdio startup must be equivalent to the verified official form:

```ts
import { serveStdio } from "@modelcontextprotocol/server/stdio";
void serveStdio(() => createNookMcpServer(registry));
```

Never call `console.log`, `process.stdout.write`, or a logger targeting stdout anywhere in `scripts/nook-mcp`.

- [ ] **Step 6: Finish the real-client security assertions**

The integration test must assert:

- `tools/list` is exact Core 6 with matching schemas/annotations;
- calls before pairing return `PAGE_UNAVAILABLE` and do not hang;
- wrong origin, code, and manifest hash cannot pair;
- paired `get_scene` round-trips structured content unchanged;
- one `move_object` MCP call creates one HTTP request ID and one page execution;
- disconnect causes the next call to fail and does not replay the mutation;
- no server stdout bytes exist outside MCP framing (the official client can complete multiple calls without parse noise);
- server exits cleanly when the transport closes.

- [ ] **Step 7: Document Claude Desktop and Claude Code setup**

Create `docs/local-mcp.md` with prerequisites, lifecycle, security boundary, troubleshooting, and both configurations. Use the repository's absolute path in the example and tell users to adapt it when cloned elsewhere.

Claude Desktop example:

```json
{
  "mcpServers": {
    "nook": {
      "command": "pnpm",
      "args": [
        "--silent",
        "--dir",
        "/Users/taehun/Projects/WebMCP",
        "mcp:nook"
      ]
    }
  }
}
```

Claude Code example:

```bash
claude mcp add --transport stdio nook -- pnpm --silent --dir /Users/taehun/Projects/WebMCP mcp:nook
```

Document the manual flow: start/open Nook at an allowed origin, start or let Claude start the companion, copy the stderr pair code into Nook, confirm `Connected`, then ask Claude to call `get_scene`. Explain that the transport and Scene execution are local but model traffic follows the user's Claude product. Document `NOOK_MCP_PORT` and exact comma-separated `NOOK_ALLOWED_ORIGINS`, with no wildcard example.

- [ ] **Step 8: Update project docs and native parity E2E**

Update `README.md` and `docs/NEXT_SESSION.md` with:

- compatibility matrix for ChatGPT Work/Codex native WebMCP and Claude Desktop/Code local MCP,
- one shared manifest and one live browser Scene,
- approval-only cart semantics,
- exact start/test commands,
- no claim of native Claude Chrome WebMCP support,
- official source links from the approved spec.

Keep the existing native E2E and add a manifest parity assertion; do not replace native coverage with companion coverage.

- [ ] **Step 9: Run the full verification matrix**

Run in this order and stop on the first failure:

```bash
pnpm test
pnpm exec vitest run tests/integration/local-mcp-companion.test.ts
pnpm run test:e2e
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run build:next
git diff --check
git status --short
```

Expected:

- unit, companion integration, and Chromium E2E pass,
- native Core 6 registration and cleanup remain green,
- actual MCP client lists and calls exact Core 6,
- vinext and Next webpack builds succeed,
- only intended Task 5 files remain uncommitted.

- [ ] **Step 10: Commit the verified companion**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts scripts/nook-mcp/mcp-server.ts scripts/nook-mcp/server.ts tests/integration/local-mcp-companion.test.ts tests/e2e/webmcp-core.spec.ts docs/local-mcp.md README.md docs/NEXT_SESSION.md
git diff --cached --check
git commit -m "feat(mcp): expose Core 6 through local companion"
```

- [ ] **Step 11: Final branch and process audit**

Run:

```bash
git status --short
git log --oneline --decorate -5
git diff main...HEAD --stat
ps -ax -o pid=,command= | rg "scripts/nook-mcp/server.ts" || true
```

Expected: clean worktree, five reviewable companion commits, no stray companion process, and no merge or push.
