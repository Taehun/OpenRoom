// @vitest-environment node
import net from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_ALLOWED_ORIGINS,
  HEARTBEAT_TIMEOUT_MS,
  MAX_BODY_BYTES,
  PAIR_CODE_TTL_MS,
  PairResponseSchema,
  RelayErrorSchema,
  RelayToolCallSchema,
} from "../../src/local-mcp/relay-protocol";
import { SessionRegistry } from "../../scripts/openinterior-mcp/session-registry";
import {
  LONG_POLL_TIMEOUT_MS,
  MAX_PAIR_ATTEMPTS,
  allowedOriginsFromEnv,
  startRelayHttpServer,
  type RelayHttpServer,
} from "../../scripts/openinterior-mcp/relay-http";
import type { ToolResult } from "../../src/webmcp/tool-result";

const MANIFEST_HASH = "0123456789abcdef".repeat(4);
const ORIGIN = "http://localhost:3000";
const SECOND_ORIGIN = "http://127.0.0.1:3000";
const EVIL_ORIGIN = "https://evil.example";
const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([ORIGIN, SECOND_ORIGIN]);
const PAGE_NONCE = "p".repeat(32);
/** Short enough to keep the suite fast; the production deadline is 25 seconds. */
const TEST_LONG_POLL_MS = 60;

let clock = 1_700_000_000_000;
let diagnostics: string[] = [];
let registry: SessionRegistry;
let relay: RelayHttpServer;
let relays: RelayHttpServer[] = [];
let teardown: Array<() => void> = [];

interface Probe {
  status: number;
  headers: Headers;
  text: string;
  body: unknown;
}

function seededRandomBytes(seed = 11): (length: number) => Uint8Array {
  let state = seed;
  return (length: number) => {
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      bytes[index] = state % 256;
    }
    return bytes;
  };
}

function sceneResult(text: string): ToolResult<unknown> {
  return {
    content: [{ type: "text", text }],
    structuredContent: { ok: true, tool: "get_scene", sceneRevision: 1, stateVersion: 1, data: { text } },
  };
}

async function call(path: string, init: RequestInit = {}): Promise<Probe> {
  const response = await fetch(`http://127.0.0.1:${relay.port}${path}`, init);
  const text = await response.text();
  let body: unknown;
  try {
    body = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  return { status: response.status, headers: response.headers, text, body };
}

function pairBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { code: "000000", origin: ORIGIN, manifestHash: MANIFEST_HASH, pageNonce: PAGE_NONCE, ...overrides };
}

async function postPair(
  body: unknown,
  headers: Record<string, string> = { "content-type": "application/json", origin: ORIGIN },
): Promise<Probe> {
  return call("/v1/pair", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function authHeaders(token: string, origin = ORIGIN): Record<string, string> {
  return { authorization: `Bearer ${token}`, origin };
}

async function pairPage(): Promise<{ code: string; token: string }> {
  const issued = relay.issuePairCode();
  const response = await postPair(pairBody({ code: issued.code }));
  expect(response.status).toBe(200);
  return { code: issued.code, token: PairResponseSchema.parse(response.body).sessionToken };
}

/** Forwards a call and guarantees the 30 second registry timer is cleared. */
function forward(): Promise<ToolResult<unknown>> {
  const controller = new AbortController();
  const settled = registry.forwardToolCall("get_scene", { probe: true }, controller.signal);
  settled.catch(() => {});
  teardown.push(() => controller.abort());
  return settled;
}

/**
 * Uploads a chunked body with no `Content-Length`, so the size ceiling can only
 * be enforced while streaming. Stops writing the moment the server answers, and
 * reports whether the upload was cut short.
 */
async function postChunkedBody(chunkCount: number, chunkBytes: number): Promise<{
  raw: string;
  bytesWritten: number;
  bytesIntended: number;
  serverClosed: boolean;
}> {
  const socket = net.connect(relay.port, "127.0.0.1");
  socket.on("error", () => {});

  const received: Buffer[] = [];
  let closed = false;
  socket.on("data", (chunk: Buffer) => received.push(chunk));
  socket.on("close", () => {
    closed = true;
  });

  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

  socket.write(
    [
      "POST /v1/pair HTTP/1.1",
      `Host: 127.0.0.1:${relay.port}`,
      `Origin: ${ORIGIN}`,
      "Content-Type: application/json",
      "Transfer-Encoding: chunked",
      "",
      "",
    ].join("\r\n"),
  );

  const payload = "a".repeat(chunkBytes);
  let bytesWritten = 0;
  for (let index = 0; index < chunkCount; index += 1) {
    if (closed || socket.destroyed || received.length > 0) break;
    socket.write(`${chunkBytes.toString(16)}\r\n${payload}\r\n`);
    bytesWritten += chunkBytes;
    await new Promise((resolve) => setImmediate(resolve));
  }

  const responseBy = Date.now() + 2_000;
  while (received.length === 0 && !closed && Date.now() < responseBy) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  // The server should now cut the connection rather than drain what is left.
  const closeBy = Date.now() + 2_000;
  while (!closed && Date.now() < closeBy) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const serverClosed = closed;
  socket.destroy();

  return {
    raw: Buffer.concat(received).toString("utf8"),
    bytesWritten,
    bytesIntended: chunkCount * chunkBytes,
    serverClosed,
  };
}

/** Every response, success or failure, carries the same hardening headers. */
function expectHardened(probe: Probe): void {
  expect(probe.headers.get("cache-control")).toBe("no-store");
  expect(probe.headers.get("x-content-type-options")).toBe("nosniff");
}

/** All pair failures are one indistinguishable 403 that leaks nothing. */
function expectPairRejected(probe: Probe, secrets: string[] = []): void {
  expect(probe.status).toBe(403);
  expect(RelayErrorSchema.parse(probe.body)).toEqual({
    code: "PAIR_REJECTED",
    message: "PAIR_REJECTED",
    retryable: false,
  });
  expect(Object.keys(probe.body as object).sort()).toEqual(["code", "message", "retryable"]);
  for (const secret of secrets) expect(probe.text).not.toContain(secret);
  expect(probe.text).not.toContain(MANIFEST_HASH);
  expect(probe.text).not.toMatch(/\n\s+at /);
  expectHardened(probe);
}

/**
 * Each relay gets its own registry because `close()` is terminal: it shuts the
 * registry down, so a test that needs a second server needs a second registry.
 */
async function startRelay(longPollMs = TEST_LONG_POLL_MS): Promise<RelayHttpServer> {
  registry = new SessionRegistry({
    manifestHash: MANIFEST_HASH,
    allowedOrigins: ALLOWED_ORIGINS,
    now: () => clock,
    randomBytes: seededRandomBytes(),
    onDiagnostic: (message) => diagnostics.push(message),
  });
  relay = await startRelayHttpServer({
    registry,
    port: 0,
    allowedOrigins: ALLOWED_ORIGINS,
    longPollMs,
    onDiagnostic: (message) => diagnostics.push(message),
  });
  relays.push(relay);
  return relay;
}

/** Opens a poll and hangs up on it, the way a closed tab or a killed page does. */
async function abandonPoll(token: string): Promise<void> {
  const hangUp = new AbortController();
  const abandoned = fetch(`http://127.0.0.1:${relay.port}/v1/calls`, {
    method: "GET",
    headers: authHeaders(token),
    signal: hangUp.signal,
  }).catch(() => undefined);

  await new Promise((resolve) => setTimeout(resolve, 30));
  hangUp.abort();
  await abandoned;
  // Let the server observe the socket closing before the test asserts on it.
  await new Promise((resolve) => setTimeout(resolve, 30));
}

beforeEach(async () => {
  clock = 1_700_000_000_000;
  diagnostics = [];
  teardown = [];
  relays = [];
  await startRelay();
});

afterEach(async () => {
  for (const abort of teardown) abort();
  teardown = [];
  for (const started of relays) await started.close();
  relays = [];
});

describe("startRelayHttpServer binding", () => {
  it("listens on the loopback interface only", () => {
    expect(relay.address).toBe("127.0.0.1");
    expect(relay.port).toBeGreaterThan(0);
  });

  it("refuses connections once closed", async () => {
    const { port } = relay;
    await relay.close();
    await expect(fetch(`http://127.0.0.1:${port}/v1/calls`)).rejects.toThrow();
    // The afterEach close must stay idempotent.
    await relay.close();
  });

  it("shuts the registry down so nothing can pair afterwards", async () => {
    await relay.close();

    expect(diagnostics).toContain("relay shut down");
    expect(() => registry.issuePairCode()).toThrow("SESSION_DISCONNECTED");
  });

  it("keeps the long poll deadline below the heartbeat timeout", () => {
    expect(LONG_POLL_TIMEOUT_MS).toBe(25_000);
    expect(LONG_POLL_TIMEOUT_MS).toBeLessThan(HEARTBEAT_TIMEOUT_MS);
  });
});

describe("origin enforcement", () => {
  it("pairs a page from an exactly allowed origin", async () => {
    const issued = relay.issuePairCode();
    const response = await postPair(pairBody({ code: issued.code }));

    expect(response.status).toBe(200);
    const parsed = PairResponseSchema.parse(response.body);
    expect(parsed.expiresAt).toBe(clock + HEARTBEAT_TIMEOUT_MS);
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(response.headers.get("vary")).toBe("Origin");
    expectHardened(response);
  });

  it("rejects a pair attempt from a disallowed origin without permissive CORS", async () => {
    const issued = relay.issuePairCode();
    const response = await postPair(pairBody({ code: issued.code, origin: EVIL_ORIGIN }), {
      "content-type": "application/json",
      origin: EVIL_ORIGIN,
    });

    expectPairRejected(response, [issued.code]);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-private-network")).toBeNull();
  });

  it("rejects a pair body whose origin disagrees with the Origin header", async () => {
    const issued = relay.issuePairCode();
    const response = await postPair(pairBody({ code: issued.code, origin: SECOND_ORIGIN }), {
      "content-type": "application/json",
      origin: ORIGIN,
    });

    expectPairRejected(response, [issued.code]);
  });

  it("rejects a request that carries no Origin header at all", async () => {
    const response = await call("/v1/calls", { method: "GET" });

    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expectHardened(response);
  });

  it("never reflects an origin that only prefixes an allowed one", async () => {
    const response = await call("/v1/calls", {
      method: "GET",
      headers: { origin: `${ORIGIN}.evil.example` },
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("pair rejection is indistinguishable", () => {
  it("answers a wrong code, wrong hash and expired code identically", async () => {
    const issued = relay.issuePairCode();

    const wrongCode = await postPair(pairBody({ code: issued.code === "111111" ? "222222" : "111111" }));
    const wrongHash = await postPair(pairBody({ code: issued.code, manifestHash: "0".repeat(64) }));

    relay.issuePairCode();
    clock += PAIR_CODE_TTL_MS + 1;
    const expired = await postPair(pairBody({ code: issued.code }));

    expectPairRejected(wrongCode, [issued.code]);
    expectPairRejected(wrongHash, [issued.code]);
    expectPairRejected(expired, [issued.code]);
    expect(wrongCode.text).toBe(wrongHash.text);
    expect(wrongCode.text).toBe(expired.text);
    expect(wrongCode.status).toBe(expired.status);
  });

  it("rejects a body that does not match the strict pair schema", async () => {
    const issued = relay.issuePairCode();
    const response = await postPair(pairBody({ code: issued.code, extra: "field" }));

    expectPairRejected(response, [issued.code]);
  });
});

describe("pair attempt throttling", () => {
  it("invalidates the code after five failures and reports it once", async () => {
    const issued = relay.issuePairCode();
    const wrong = issued.code === "111111" ? "222222" : "111111";

    for (let attempt = 0; attempt < MAX_PAIR_ATTEMPTS; attempt += 1) {
      expectPairRejected(await postPair(pairBody({ code: wrong })), [issued.code]);
    }

    const afterLockout = await postPair(pairBody({ code: issued.code }));
    expectPairRejected(afterLockout, [issued.code]);

    const lockouts = diagnostics.filter((line) => line.includes("pair code invalidated"));
    expect(lockouts).toHaveLength(1);
    expect(lockouts[0]).not.toContain(issued.code);
  });

  it("allows the correct code while attempts remain", async () => {
    const issued = relay.issuePairCode();
    const wrong = issued.code === "111111" ? "222222" : "111111";

    for (let attempt = 0; attempt < MAX_PAIR_ATTEMPTS - 1; attempt += 1) {
      expectPairRejected(await postPair(pairBody({ code: wrong })), [issued.code]);
    }

    const response = await postPair(pairBody({ code: issued.code }));
    expect(response.status).toBe(200);
  });

  it("resets the counter for a code minted straight from the registry", async () => {
    const first = relay.issuePairCode();
    const wrong = first.code === "111111" ? "222222" : "111111";
    for (let attempt = 0; attempt < MAX_PAIR_ATTEMPTS; attempt += 1) {
      await postPair(pairBody({ code: wrong }));
    }
    expectPairRejected(await postPair(pairBody({ code: first.code })), [first.code]);

    // Task 4 may mint through the registry; the relay must notice the new code
    // rather than staying locked out forever.
    const second = registry.issuePairCode();
    const response = await postPair(pairBody({ code: second.code }));

    expect(response.status).toBe(200);
  });

  it("reports every refused attempt while the code is retired", async () => {
    const issued = relay.issuePairCode();
    const wrong = issued.code === "111111" ? "222222" : "111111";
    for (let attempt = 0; attempt < MAX_PAIR_ATTEMPTS; attempt += 1) {
      await postPair(pairBody({ code: wrong }));
    }
    diagnostics = [];

    await postPair(pairBody({ code: issued.code }));
    await postPair(pairBody({ code: wrong }));

    const refusals = diagnostics.filter((line) => line.includes("pair attempt refused"));
    expect(refusals).toHaveLength(2);
    for (const line of refusals) expect(line).not.toContain(issued.code);
  });

  it("exposes a monotonic pair code version on the registry", () => {
    const before = registry.pairCodeVersion();
    registry.issuePairCode();
    expect(registry.pairCodeVersion()).toBe(before + 1);
    relay.issuePairCode();
    expect(registry.pairCodeVersion()).toBe(before + 2);
  });

  it("resets the counter when a fresh code is issued", async () => {
    const first = relay.issuePairCode();
    const wrong = first.code === "111111" ? "222222" : "111111";
    for (let attempt = 0; attempt < MAX_PAIR_ATTEMPTS; attempt += 1) {
      await postPair(pairBody({ code: wrong }));
    }
    expectPairRejected(await postPair(pairBody({ code: first.code })), [first.code]);

    const second = relay.issuePairCode();
    const response = await postPair(pairBody({ code: second.code }));

    expect(response.status).toBe(200);
    expect(MAX_PAIR_ATTEMPTS).toBe(5);
  });
});

describe("request hygiene", () => {
  it("answers 413 for a body one byte over the ceiling", async () => {
    const response = await postPair("x".repeat(MAX_BODY_BYTES + 1));

    expect(response.status).toBe(413);
    expect(RelayErrorSchema.parse(response.body)).toEqual({
      code: "BAD_REQUEST",
      message: "BAD_REQUEST",
      retryable: false,
    });
    expectHardened(response);
  });

  it("stops reading and answers 413 for a chunked body with no Content-Length", async () => {
    // Eight times the ceiling, so the server must cut the upload off rather than
    // buffer it; `fetch` would set Content-Length and never reach this branch.
    const probe = await postChunkedBody(32, 16 * 1024);

    expect(probe.raw).toContain("HTTP/1.1 413");
    expect(probe.raw).toContain("BAD_REQUEST");
    // The response arrived before the body finished, and the server then tore
    // the connection down instead of consuming the remaining chunks.
    expect(probe.bytesWritten).toBeLessThan(probe.bytesIntended);
    expect(probe.serverClosed).toBe(true);
    expect(probe.raw).not.toContain("200 OK");
  });

  it("accepts a body at exactly the ceiling and still rejects it as a pair", async () => {
    const issued = relay.issuePairCode();
    const filler = "a".repeat(MAX_BODY_BYTES - JSON.stringify(pairBody({ code: issued.code, pad: "" })).length);
    const response = await postPair(pairBody({ code: issued.code, pad: filler }));

    expect(response.status).toBe(403);
  });

  it("answers 415 for a non-JSON content type", async () => {
    const response = await call("/v1/pair", {
      method: "POST",
      headers: { "content-type": "text/plain", origin: ORIGIN },
      body: "code=000000",
    });

    expect(response.status).toBe(415);
    expect(RelayErrorSchema.parse(response.body).code).toBe("BAD_REQUEST");
    expectHardened(response);
  });

  it("accepts application/json with a charset parameter", async () => {
    const issued = relay.issuePairCode();
    const response = await postPair(pairBody({ code: issued.code }), {
      "content-type": "application/json; charset=utf-8",
      origin: ORIGIN,
    });

    expect(response.status).toBe(200);
  });

  it("answers 400 for malformed JSON", async () => {
    const response = await postPair("{not json");

    expect(response.status).toBe(400);
    expect(RelayErrorSchema.parse(response.body).code).toBe("BAD_REQUEST");
  });

  it("answers 405 with an Allow header for an unsupported method", async () => {
    const response = await call("/v1/pair", { method: "PUT", headers: { origin: ORIGIN } });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST, OPTIONS");
    expect(RelayErrorSchema.parse(response.body).code).toBe("BAD_REQUEST");
    expectHardened(response);
  });

  it("answers 404 for an unknown path", async () => {
    const response = await call("/v1/nope", { method: "GET", headers: { origin: ORIGIN } });

    expect(response.status).toBe(404);
    expect(RelayErrorSchema.parse(response.body).code).toBe("BAD_REQUEST");
    expectHardened(response);
  });

  it("ignores a query string when routing", async () => {
    const { token } = await pairPage();
    const response = await call("/v1/calls?wait=0", { method: "GET", headers: authHeaders(token) });

    expect(response.status).toBe(204);
  });
});

describe("bearer authentication", () => {
  it("rejects a missing Authorization header", async () => {
    const response = await call("/v1/calls", { method: "GET", headers: { origin: ORIGIN } });

    expect(response.status).toBe(401);
    expect(RelayErrorSchema.parse(response.body)).toEqual({
      code: "UNAUTHORIZED",
      message: "UNAUTHORIZED",
      retryable: false,
    });
    expectHardened(response);
  });

  it("rejects a wrong bearer token of the same length", async () => {
    const { token } = await pairPage();
    const forged = `${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`;
    expect(forged).not.toBe(token);

    const response = await call("/v1/calls", { method: "GET", headers: authHeaders(forged) });

    expect(response.status).toBe(401);
  });

  it("rejects a token of the wrong length without leaking the difference", async () => {
    await pairPage();
    const response = await call("/v1/calls", { method: "GET", headers: authHeaders("short") });

    expect(response.status).toBe(401);
  });

  it("rejects a non-Bearer scheme", async () => {
    const { token } = await pairPage();
    const response = await call("/v1/calls", {
      method: "GET",
      headers: { authorization: `Basic ${token}`, origin: ORIGIN },
    });

    expect(response.status).toBe(401);
  });

  it("never accepts a token from the query string", async () => {
    const { token } = await pairPage();
    const response = await call(`/v1/calls?token=${token}&access_token=${token}`, {
      method: "GET",
      headers: { origin: ORIGIN },
    });

    expect(response.status).toBe(401);
  });

  it("never accepts a token from a cookie", async () => {
    const { token } = await pairPage();
    const response = await call("/v1/calls", {
      method: "GET",
      headers: { origin: ORIGIN, cookie: `sessionToken=${token}` },
    });

    expect(response.status).toBe(401);
    expect(response.text).not.toContain(token);
  });

  it("never echoes the active token in an error body", async () => {
    const { token } = await pairPage();
    const response = await call("/v1/session", { method: "DELETE", headers: authHeaders("wrong-token") });

    expect(response.status).toBe(401);
    expect(response.text).not.toContain(token);
    expect(response.text).not.toMatch(/\n\s+at /);
  });
});

describe("GET /v1/calls long poll", () => {
  it("returns 204 once the server side deadline elapses", async () => {
    const { token } = await pairPage();
    const started = Date.now();
    const response = await call("/v1/calls", { method: "GET", headers: authHeaders(token) });

    expect(response.status).toBe(204);
    expect(response.text).toBe("");
    expect(Date.now() - started).toBeGreaterThanOrEqual(TEST_LONG_POLL_MS - 20);
    expectHardened(response);
  });

  it("delivers a queued call as a strict RelayToolCall", async () => {
    const { token } = await pairPage();
    const pending = forward();
    const response = await call("/v1/calls", { method: "GET", headers: authHeaders(token) });

    expect(response.status).toBe(200);
    const parsed = RelayToolCallSchema.parse(response.body);
    expect(parsed.toolName).toBe("get_scene");
    expect(parsed.input).toEqual({ probe: true });
    expect(response.headers.get("content-type")).toBe("application/json");
    void pending;
  });

  it("delivers a call that arrives while the poll is waiting", async () => {
    const { token } = await pairPage();
    const polling = call("/v1/calls", { method: "GET", headers: authHeaders(token) });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const pending = forward();

    const response = await polling;
    expect(response.status).toBe(200);
    expect(RelayToolCallSchema.parse(response.body).toolName).toBe("get_scene");
    void pending;
  });

  it("refreshes the heartbeat even when the poll ends in 204", async () => {
    const { token } = await pairPage();

    clock += HEARTBEAT_TIMEOUT_MS - 5_000;
    expect((await call("/v1/calls", { method: "GET", headers: authHeaders(token) })).status).toBe(204);

    clock += HEARTBEAT_TIMEOUT_MS - 5_000;
    expect((await call("/v1/calls", { method: "GET", headers: authHeaders(token) })).status).toBe(204);
  });

  it("releases the held poll when the client hangs up", async () => {
    await relay.close();
    // Long enough that only the hang-up, never the deadline, can free the poll.
    await startRelay(2_000);
    const { token } = await pairPage();
    await abandonPoll(token);

    // A waiter left registered would swallow this call and the next poll would
    // wait out the full deadline and answer 204.
    const pending = forward();
    const response = await call("/v1/calls", { method: "GET", headers: authHeaders(token) });

    expect(response.status).toBe(200);
    expect(RelayToolCallSchema.parse(response.body).toolName).toBe("get_scene");
    void pending;
  });

  it("lets the heartbeat expire a session whose poll was abandoned", async () => {
    await relay.close();
    await startRelay(2_000);
    const { token } = await pairPage();
    await abandonPoll(token);

    // A held poll counts as liveness, so an unreleased waiter would keep this
    // session alive forever instead of letting the heartbeat reap it.
    clock += HEARTBEAT_TIMEOUT_MS + 1;
    const response = await call("/v1/calls", { method: "GET", headers: authHeaders(token) });

    expect(response.status).toBe(401);
  });

  it("ends an in-flight long poll when the server closes", async () => {
    const { token } = await pairPage();
    const polling = call("/v1/calls", {
      method: "GET",
      headers: authHeaders(token),
    }).catch(() => "aborted" as const);

    await new Promise((resolve) => setTimeout(resolve, 10));
    await relay.close();

    const result = await polling;
    if (result !== "aborted") expect(result.status).toBe(204);
  });
});

describe("POST /v1/results/:requestId", () => {
  it("settles the forwarded call and answers 204", async () => {
    const { token } = await pairPage();
    const pending = forward();
    const delivered = await call("/v1/calls", { method: "GET", headers: authHeaders(token) });
    const { requestId } = RelayToolCallSchema.parse(delivered.body);

    const response = await call(`/v1/results/${requestId}`, {
      method: "POST",
      headers: { ...authHeaders(token), "content-type": "application/json" },
      body: JSON.stringify({ requestId, result: sceneResult("done") }),
    });

    expect(response.status).toBe(204);
    await expect(pending).resolves.toEqual(sceneResult("done"));
  });

  it("rejects a body whose requestId disagrees with the path", async () => {
    const { token } = await pairPage();
    const pending = forward();
    const delivered = await call("/v1/calls", { method: "GET", headers: authHeaders(token) });
    const { requestId } = RelayToolCallSchema.parse(delivered.body);

    const response = await call(`/v1/results/${requestId}`, {
      method: "POST",
      headers: { ...authHeaders(token), "content-type": "application/json" },
      body: JSON.stringify({ requestId: "b".repeat(32), result: sceneResult("done") }),
    });

    expect(response.status).toBe(400);
    expect(RelayErrorSchema.parse(response.body).code).toBe("BAD_REQUEST");
    void pending;
  });

  it("rejects an unknown requestId as UNAUTHORIZED", async () => {
    const { token } = await pairPage();
    const requestId = "c".repeat(32);
    const response = await call(`/v1/results/${requestId}`, {
      method: "POST",
      headers: { ...authHeaders(token), "content-type": "application/json" },
      body: JSON.stringify({ requestId, result: sceneResult("done") }),
    });

    expect(response.status).toBe(401);
  });

  it("requires a bearer token", async () => {
    await pairPage();
    const requestId = "d".repeat(32);
    const response = await call(`/v1/results/${requestId}`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ requestId, result: sceneResult("done") }),
    });

    expect(response.status).toBe(401);
  });
});

describe("DELETE /v1/session", () => {
  it("disconnects the paired page", async () => {
    const { token } = await pairPage();

    const response = await call("/v1/session", { method: "DELETE", headers: authHeaders(token) });
    expect(response.status).toBe(204);

    const after = await call("/v1/calls", { method: "GET", headers: authHeaders(token) });
    expect(after.status).toBe(401);
  });
});

describe("CORS and private network preflights", () => {
  it("answers a valid preflight with exact, minimal headers", async () => {
    const response = await call("/v1/calls", {
      method: "OPTIONS",
      headers: {
        origin: ORIGIN,
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(response.headers.get("vary")).toBe("Origin");
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
    expect(response.headers.get("access-control-allow-headers")).toBe("Authorization");
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    expect(response.headers.get("access-control-allow-private-network")).toBeNull();
    expectHardened(response);
  });

  it("grants private network access only when the preflight asks for it", async () => {
    const granted = await call("/v1/calls", {
      method: "OPTIONS",
      headers: {
        origin: SECOND_ORIGIN,
        "access-control-request-method": "GET",
        "access-control-request-private-network": "true",
      },
    });

    expect(granted.status).toBe(204);
    expect(granted.headers.get("access-control-allow-private-network")).toBe("true");
    expect(granted.headers.get("access-control-allow-origin")).toBe(SECOND_ORIGIN);
  });

  it("ignores a private network request header that is not exactly true", async () => {
    const response = await call("/v1/calls", {
      method: "OPTIONS",
      headers: {
        origin: ORIGIN,
        "access-control-request-method": "GET",
        "access-control-request-private-network": "yes",
      },
    });

    expect(response.headers.get("access-control-allow-private-network")).toBeNull();
  });

  it("refuses a preflight from a disallowed origin with no permissive headers", async () => {
    const response = await call("/v1/pair", {
      method: "OPTIONS",
      headers: {
        origin: EVIL_ORIGIN,
        "access-control-request-method": "POST",
        "access-control-request-private-network": "true",
      },
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-methods")).toBeNull();
    expect(response.headers.get("access-control-allow-headers")).toBeNull();
    expect(response.headers.get("access-control-allow-private-network")).toBeNull();
    expectHardened(response);
  });
});

describe("allowedOriginsFromEnv", () => {
  it("returns the built-in development origins when unset", () => {
    const origins = allowedOriginsFromEnv(undefined);

    for (const origin of DEFAULT_ALLOWED_ORIGINS) expect(origins.has(origin)).toBe(true);
    expect(origins.size).toBe(DEFAULT_ALLOWED_ORIGINS.size);
    expect(allowedOriginsFromEnv("   ").size).toBe(DEFAULT_ALLOWED_ORIGINS.size);
  });

  it("adds exact extra origins", () => {
    const origins = allowedOriginsFromEnv("https://studio.example, http://localhost:4321");

    expect(origins.has("https://studio.example")).toBe(true);
    expect(origins.has("http://localhost:4321")).toBe(true);
    expect(origins.has("http://localhost:3000")).toBe(true);
  });

  it.each([
    ["*", "wildcard"],
    ["https://*.example", "wildcard host"],
    ["http://a.example/", "trailing slash"],
    ["http://a.example/path", "path"],
    ["http://user:pass@a.example", "credentials"],
    ["http://a.example?x=1", "query"],
    ["http://a.example#frag", "fragment"],
    ["null", "opaque origin"],
    ["not a url", "garbage"],
    ["file:///tmp", "non-http scheme"],
    ["https://a.example,", "empty trailing entry"],
  ])("rejects %s (%s)", (value) => {
    expect(() => allowedOriginsFromEnv(value)).toThrow(/Invalid OPENINTERIOR_ALLOWED_ORIGINS entry/);
  });

  it("never mentions nook in the error message", () => {
    let message = "";
    try {
      allowedOriginsFromEnv("*");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("OPENINTERIOR_ALLOWED_ORIGINS");
    expect(message.toLowerCase()).not.toContain("nook");
  });
});
