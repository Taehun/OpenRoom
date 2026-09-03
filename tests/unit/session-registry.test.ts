// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CALL_TIMEOUT_MS,
  HEARTBEAT_TIMEOUT_MS,
  MAX_PENDING_CALLS,
  PAIR_CODE_TTL_MS,
  PairResponseSchema,
  RelayError,
  RelayToolCallSchema,
} from "../../src/local-mcp/relay-protocol";
import {
  EXPIRY_SWEEP_INTERVAL_MS,
  REPAIRABLE_SESSION_CLOSURES,
  SESSION_CLOSED_BY_PAGE,
  SESSION_CLOSED_HEARTBEAT_EXPIRED,
  SessionRegistry,
  startExpirySweep,
} from "../../scripts/openinterior-mcp/session-registry";
import type { ToolResult } from "../../src/webmcp/tool-result";

const MANIFEST_HASH = "0123456789abcdef".repeat(4);
const ORIGIN = "http://localhost:3000";
const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([ORIGIN, "http://127.0.0.1:3000"]);
const PAGE_NONCE = "p".repeat(32);

function seededRandomBytes(seed = 7): (length: number) => Uint8Array {
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

let clock = 1_700_000_000_000;
let diagnostics: string[] = [];
let registry: SessionRegistry;

function advance(ms: number): void {
  clock += ms;
  vi.advanceTimersByTime(ms);
}

function createRegistry(): SessionRegistry {
  return new SessionRegistry({
    manifestHash: MANIFEST_HASH,
    allowedOrigins: ALLOWED_ORIGINS,
    now: () => clock,
    randomBytes: seededRandomBytes(),
    onDiagnostic: (message) => diagnostics.push(message),
  });
}

function pairPage(): { code: string; token: string } {
  const issued = registry.issuePairCode();
  const paired = registry.pair({
    code: issued.code,
    origin: ORIGIN,
    manifestHash: MANIFEST_HASH,
    pageNonce: PAGE_NONCE,
  });
  return { code: issued.code, token: paired.sessionToken };
}

/** Long polls once and lets the caller's request time out, mirroring the HTTP layer. */
function drainPoll(token: string) {
  const controller = new AbortController();
  const promise = registry.poll(token, controller.signal);
  controller.abort();
  return promise;
}

function forward(toolName: Parameters<SessionRegistry["forwardToolCall"]>[0], input: unknown = {}) {
  const controller = new AbortController();
  const promise = registry.forwardToolCall(toolName, input, controller.signal);
  return { controller, promise };
}

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1_700_000_000_000;
  diagnostics = [];
  registry = createRegistry();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("pair code issuance", () => {
  it("issues six digit codes with a ten minute expiry", () => {
    const issued = registry.issuePairCode();
    expect(issued.code).toMatch(/^\d{6}$/);
    expect(issued.expiresAt).toBe(clock + PAIR_CODE_TTL_MS);
    expect(registry.issuePairCode().code).not.toBe(issued.code);
  });

  it("returns a schema valid pair response and burns the code after one use", () => {
    const issued = registry.issuePairCode();
    const paired = registry.pair({
      code: issued.code,
      origin: ORIGIN,
      manifestHash: MANIFEST_HASH,
      pageNonce: PAGE_NONCE,
    });
    expect(PairResponseSchema.safeParse(paired).success).toBe(true);
    expect(paired.expiresAt).toBe(clock + HEARTBEAT_TIMEOUT_MS);
    expect(() =>
      registry.pair({
        code: issued.code,
        origin: ORIGIN,
        manifestHash: MANIFEST_HASH,
        pageNonce: "q".repeat(32),
      }),
    ).toThrowError("PAIR_REJECTED");
  });
});

describe("pairing rejections", () => {
  it("fails expired, wrong code, wrong origin, and wrong hash attempts indistinguishably", () => {
    const capture = (attempt: () => unknown): RelayError => {
      try {
        attempt();
      } catch (error) {
        return error as RelayError;
      }
      throw new Error("expected the pair attempt to fail");
    };

    const wrongCode = capture(() => {
      registry.issuePairCode();
      return registry.pair({
        code: "000000",
        origin: ORIGIN,
        manifestHash: MANIFEST_HASH,
        pageNonce: PAGE_NONCE,
      });
    });
    const wrongOrigin = capture(() => {
      const issued = registry.issuePairCode();
      return registry.pair({
        code: issued.code,
        origin: "http://localhost:3001",
        manifestHash: MANIFEST_HASH,
        pageNonce: PAGE_NONCE,
      });
    });
    const wrongHash = capture(() => {
      const issued = registry.issuePairCode();
      return registry.pair({
        code: issued.code,
        origin: ORIGIN,
        manifestHash: "b".repeat(64),
        pageNonce: PAGE_NONCE,
      });
    });
    const expired = capture(() => {
      const issued = registry.issuePairCode();
      advance(PAIR_CODE_TTL_MS);
      return registry.pair({
        code: issued.code,
        origin: ORIGIN,
        manifestHash: MANIFEST_HASH,
        pageNonce: PAGE_NONCE,
      });
    });
    const malformed = capture(() =>
      registry.pair({
        code: "12345",
        origin: ORIGIN,
        manifestHash: MANIFEST_HASH,
        pageNonce: PAGE_NONCE,
      }),
    );

    for (const error of [wrongCode, wrongOrigin, wrongHash, expired, malformed]) {
      expect(error).toBeInstanceOf(RelayError);
      expect(error.code).toBe("PAIR_REJECTED");
      expect(error.message).toBe("PAIR_REJECTED");
      expect(error.retryable).toBe(false);
    }
    const rejectionLines = diagnostics.filter((line) => line.startsWith("pair attempt rejected"));
    expect(rejectionLines).toHaveLength(5);
    expect(new Set(rejectionLines).size).toBe(1);
  });

  it("never leaks the pair code or session token through diagnostics", () => {
    const { code, token } = pairPage();
    registry.disconnect(token);
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const line of diagnostics) {
      expect(line).not.toContain(code);
      expect(line).not.toContain(token);
    }
  });
});

describe("session replacement", () => {
  it("invalidates the previous token and rejects its pending calls", async () => {
    const first = pairPage();
    const { promise } = forward("get_scene");
    const rejection = expect(promise).rejects.toThrowError("SESSION_DISCONNECTED");

    const second = pairPage();
    expect(second.token).not.toBe(first.token);
    await rejection;
    await expect(drainPoll(first.token)).rejects.toThrowError("UNAUTHORIZED");
    await expect(drainPoll(second.token)).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("forwarding tool calls", () => {
  it("reports PAGE_UNAVAILABLE when no page is paired", async () => {
    const { promise } = forward("get_scene");
    await expect(promise).rejects.toMatchObject({ code: "PAGE_UNAVAILABLE", retryable: true });
  });

  it("hands queued calls to the poller in order with opaque input", async () => {
    const { token } = pairPage();
    const first = forward("get_scene", {});
    const second = forward("move_object", { objectId: "sofa-1", position: { x: 1, z: 2 } });
    first.promise.catch(() => {});
    second.promise.catch(() => {});

    const call = await drainPoll(token);
    expect(RelayToolCallSchema.safeParse(call).success).toBe(true);
    expect(call?.toolName).toBe("get_scene");

    const next = await drainPoll(token);
    expect(next?.toolName).toBe("move_object");
    expect(next?.input).toEqual({ objectId: "sofa-1", position: { x: 1, z: 2 } });
    expect(next?.requestId).not.toBe(call?.requestId);

    registry.disconnect(token);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("wakes a waiting poll as soon as a call arrives", async () => {
    const { token } = pairPage();
    const controller = new AbortController();
    const polled = registry.poll(token, controller.signal);
    const { promise } = forward("get_selection");
    promise.catch(() => {});
    await expect(polled).resolves.toMatchObject({ toolName: "get_selection" });
    registry.disconnect(token);
  });

  it("rejects the ninth concurrent call and keeps the first eight pending", async () => {
    const { token } = pairPage();
    const inflight = Array.from({ length: MAX_PENDING_CALLS }, () => {
      const { promise } = forward("get_scene");
      const settled = { done: false };
      promise.then(
        () => {
          settled.done = true;
        },
        () => {
          settled.done = true;
        },
      );
      return { promise, settled };
    });

    const ninth = forward("get_scene");
    await expect(ninth.promise).rejects.toMatchObject({
      code: "TOO_MANY_PENDING_CALLS",
      retryable: true,
    });
    expect(inflight.every((entry) => entry.settled.done === false)).toBe(true);
    expect(vi.getTimerCount()).toBe(MAX_PENDING_CALLS);

    registry.disconnect(token);
    await Promise.all(
      inflight.map((entry) => expect(entry.promise).rejects.toThrowError("SESSION_DISCONNECTED")),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out after thirty seconds and never requeues the call", async () => {
    const { token } = pairPage();
    const { promise } = forward("search_products", { query: "sofa" });
    const delivered = await drainPoll(token);
    expect(delivered?.toolName).toBe("search_products");

    advance(CALL_TIMEOUT_MS);
    await expect(promise).rejects.toMatchObject({ code: "CALL_TIMEOUT", retryable: false });
    expect(vi.getTimerCount()).toBe(0);
    await expect(drainPoll(token)).resolves.toBeNull();

    expect(() =>
      registry.resolve(token, {
        requestId: delivered?.requestId ?? "",
        result: sceneResult("late"),
      }),
    ).toThrowError("UNAUTHORIZED");
  });

  it("aborts the call when the MCP caller cancels", async () => {
    const { token } = pairPage();
    const { controller, promise } = forward("get_scene");
    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(RelayError);
    expect(vi.getTimerCount()).toBe(0);
    await expect(drainPoll(token)).resolves.toBeNull();
  });
});

describe("resolving results", () => {
  it("resolves a delivered call exactly once and frees its slot", async () => {
    const { token } = pairPage();
    const { promise } = forward("get_scene");
    const delivered = await drainPoll(token);
    const requestId = delivered?.requestId ?? "";

    registry.resolve(token, { requestId, result: sceneResult("scene payload") });
    await expect(promise).resolves.toEqual(sceneResult("scene payload"));
    expect(vi.getTimerCount()).toBe(0);

    expect(() => registry.resolve(token, { requestId, result: sceneResult("replay") })).toThrowError(
      "UNAUTHORIZED",
    );

    const refill = Array.from({ length: MAX_PENDING_CALLS }, () => {
      const call = forward("get_scene");
      call.promise.catch(() => {});
      return call.promise;
    });
    expect(refill).toHaveLength(MAX_PENDING_CALLS);
    registry.disconnect(token);
    await Promise.all(refill.map((entry) => expect(entry).rejects.toThrowError("SESSION_DISCONNECTED")));
  });

  it("rejects results for unknown or undelivered request ids", async () => {
    const { token } = pairPage();
    const { promise } = forward("get_scene");
    promise.catch(() => {});
    expect(() =>
      registry.resolve(token, { requestId: "u".repeat(24), result: sceneResult("forged") }),
    ).toThrowError("UNAUTHORIZED");
    registry.disconnect(token);
    await expect(promise).rejects.toThrowError("SESSION_DISCONNECTED");
  });
});

describe("authentication", () => {
  it("refuses polling, resolving, and disconnecting with the wrong token", async () => {
    const { token } = pairPage();
    const forged = "f".repeat(64);
    await expect(drainPoll(forged)).rejects.toMatchObject({ code: "UNAUTHORIZED", retryable: false });
    expect(() => registry.resolve(forged, { requestId: "u".repeat(24), result: sceneResult("x") })).toThrowError(
      "UNAUTHORIZED",
    );
    expect(() => registry.disconnect(forged)).toThrowError("UNAUTHORIZED");
    await expect(drainPoll(token)).resolves.toBeNull();
  });
});

describe("heartbeat expiry", () => {
  it("keeps the session alive while polls arrive", async () => {
    const { token } = pairPage();
    advance(HEARTBEAT_TIMEOUT_MS - 1);
    await expect(drainPoll(token)).resolves.toBeNull();
    advance(HEARTBEAT_TIMEOUT_MS - 1);
    registry.sweepExpired();
    await expect(drainPoll(token)).resolves.toBeNull();
  });

  it("disconnects after forty five seconds without a valid poll", async () => {
    const { token } = pairPage();
    // Forwarded late enough that the heartbeat deadline lands before its own
    // 30 second call timeout, isolating the disconnect path.
    advance(20_000);
    const { promise } = forward("get_scene");
    const rejection = expect(promise).rejects.toThrowError("SESSION_DISCONNECTED");

    advance(HEARTBEAT_TIMEOUT_MS - 20_000);
    registry.sweepExpired();
    await rejection;
    await expect(drainPoll(token)).rejects.toThrowError("UNAUTHORIZED");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("expires a stale session lazily even without an explicit sweep", async () => {
    const { token } = pairPage();
    advance(HEARTBEAT_TIMEOUT_MS);
    await expect(drainPoll(token)).rejects.toThrowError("UNAUTHORIZED");
  });

  it("pins the exact heartbeat diagnostic the companion reissues a code on", () => {
    // The owning process decides whether to mint a replacement code by matching
    // this line. Both sides now share one constant, and this pins its text so a
    // reworded diagnostic fails here rather than silently stranding an operator
    // with no way back in.
    pairPage();
    advance(HEARTBEAT_TIMEOUT_MS);
    registry.sweepExpired();

    expect(SESSION_CLOSED_HEARTBEAT_EXPIRED).toBe("session closed: heartbeat expired");
    expect(diagnostics).toContain(SESSION_CLOSED_HEARTBEAT_EXPIRED);
    expect(REPAIRABLE_SESSION_CLOSURES.has(SESSION_CLOSED_HEARTBEAT_EXPIRED)).toBe(true);
  });

  it("pins the exact page disconnect diagnostic", () => {
    const { token } = pairPage();
    registry.disconnect(token);

    expect(SESSION_CLOSED_BY_PAGE).toBe("session closed: disconnected by the paired page");
    expect(diagnostics).toContain(SESSION_CLOSED_BY_PAGE);
    expect(REPAIRABLE_SESSION_CLOSURES.has(SESSION_CLOSED_BY_PAGE)).toBe(true);
  });

  it("leaves a replaced session and a shutdown out of the repairable set", () => {
    // A replaced session already has a page attached and a shut down process is
    // going away; minting a code for either would leave a live code where none
    // belongs, so only the two closures above may trigger a reissue.
    for (const closure of REPAIRABLE_SESSION_CLOSURES) {
      expect([SESSION_CLOSED_BY_PAGE, SESSION_CLOSED_HEARTBEAT_EXPIRED]).toContain(closure);
    }
    expect(REPAIRABLE_SESSION_CLOSURES.has("session closed: replaced by a new pairing")).toBe(false);
    expect(REPAIRABLE_SESSION_CLOSURES.has("session closed: relay shutting down")).toBe(false);
  });

  it("drops expired pair codes during a sweep", () => {
    const issued = registry.issuePairCode();
    advance(PAIR_CODE_TTL_MS - 1);
    registry.sweepExpired();
    advance(1);
    registry.sweepExpired();
    expect(() =>
      registry.pair({ code: issued.code, origin: ORIGIN, manifestHash: MANIFEST_HASH, pageNonce: PAGE_NONCE }),
    ).toThrowError("PAIR_REJECTED");
  });
});

describe("periodic expiry sweep", () => {
  it("closes a lapsed session without any other registry call", () => {
    // A page killed with its tab - no DELETE, no further poll - leaves nobody
    // to touch the registry, so without this timer the closure diagnostic, and
    // with it the replacement pair code, would never be emitted.
    const stop = startExpirySweep(registry);
    try {
      pairPage();
      advance(HEARTBEAT_TIMEOUT_MS - EXPIRY_SWEEP_INTERVAL_MS);
      expect(diagnostics).not.toContain(SESSION_CLOSED_HEARTBEAT_EXPIRED);

      advance(EXPIRY_SWEEP_INTERVAL_MS);
      expect(diagnostics).toContain(SESSION_CLOSED_HEARTBEAT_EXPIRED);
    } finally {
      stop();
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sweeps on an unref'd interval and stops on demand", () => {
    const unref = vi.fn();
    const handle = { unref };
    const scheduled: Array<{ handler: () => void; ms: number }> = [];
    const cleared: unknown[] = [];

    const stop = startExpirySweep(registry, {
      setTimer: (handler, ms) => {
        scheduled.push({ handler, ms });
        return handle;
      },
      clearTimer: (cancelled) => cleared.push(cancelled),
    });

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].ms).toBe(EXPIRY_SWEEP_INTERVAL_MS);
    // Unref'd, so the sweep alone never keeps the companion process alive.
    expect(unref).toHaveBeenCalledTimes(1);

    stop();
    stop();
    expect(cleared).toEqual([handle]);
  });

  it("survives a sweep on a shut down registry", () => {
    const stop = startExpirySweep(registry);
    try {
      registry.shutdown();
      expect(() => advance(EXPIRY_SWEEP_INTERVAL_MS * 2)).not.toThrow();
    } finally {
      stop();
    }
  });
});

describe("explicit disconnect", () => {
  it("rejects every pending promise and the outstanding poll", async () => {
    const { token } = pairPage();
    const first = forward("get_scene");
    const second = forward("get_selection");
    const controller = new AbortController();
    await expect(registry.poll(token, controller.signal)).resolves.toMatchObject({ toolName: "get_scene" });
    await expect(registry.poll(token, controller.signal)).resolves.toMatchObject({ toolName: "get_selection" });
    const polled = registry.poll(token, controller.signal);
    const polledRejection = expect(polled).rejects.toThrowError("SESSION_DISCONNECTED");

    registry.disconnect(token);

    await expect(first.promise).rejects.toThrowError("SESSION_DISCONNECTED");
    await expect(second.promise).rejects.toThrowError("SESSION_DISCONNECTED");
    await polledRejection;
    expect(vi.getTimerCount()).toBe(0);
    await expect(registry.forwardToolCall("get_scene", {}, controller.signal)).rejects.toThrowError(
      "PAGE_UNAVAILABLE",
    );
  });
});

describe("unknown tool names", () => {
  it("refuses a tool outside the Core 6 without queuing it", async () => {
    const { token } = pairPage();
    await expect(
      registry.forwardToolCall("not_a_tool" as never, {}, new AbortController().signal),
    ).rejects.toMatchObject({ code: "UNKNOWN_TOOL", retryable: false });
    expect(vi.getTimerCount()).toBe(0);
    await expect(drainPoll(token)).resolves.toBeNull();
  });

  it("refuses an unknown tool even before a page pairs", async () => {
    await expect(
      registry.forwardToolCall("" as never, {}, new AbortController().signal),
    ).rejects.toThrowError("UNKNOWN_TOOL");
  });
});

describe("held long polls count as liveness", () => {
  it("never reaps a session while its poll is held, and resumes the clock when it ends", async () => {
    const { token } = pairPage();
    const controller = new AbortController();
    const polled = registry.poll(token, controller.signal);

    advance(HEARTBEAT_TIMEOUT_MS - 1);
    registry.sweepExpired();
    advance(2);
    registry.sweepExpired();
    controller.abort();
    await expect(polled).resolves.toBeNull();

    advance(HEARTBEAT_TIMEOUT_MS - 1);
    registry.sweepExpired();
    await expect(drainPoll(token)).resolves.toBeNull();

    advance(HEARTBEAT_TIMEOUT_MS);
    registry.sweepExpired();
    await expect(drainPoll(token)).rejects.toThrowError("UNAUTHORIZED");
  });
});

describe("process shutdown", () => {
  it("rejects pending calls, clears every timer, and fails closed afterwards", async () => {
    const { token } = pairPage();
    const first = forward("get_scene");
    const second = forward("get_selection");
    const rejections = [
      expect(first.promise).rejects.toThrowError("SESSION_DISCONNECTED"),
      expect(second.promise).rejects.toThrowError("SESSION_DISCONNECTED"),
    ];

    registry.shutdown();
    await Promise.all(rejections);
    expect(vi.getTimerCount()).toBe(0);

    await expect(drainPoll(token)).rejects.toThrowError("SESSION_DISCONNECTED");
    await expect(
      registry.forwardToolCall("get_scene", {}, new AbortController().signal),
    ).rejects.toThrowError("PAGE_UNAVAILABLE");
    expect(() => registry.issuePairCode()).toThrowError("SESSION_DISCONNECTED");
    expect(() =>
      registry.pair({ code: "123456", origin: ORIGIN, manifestHash: MANIFEST_HASH, pageNonce: PAGE_NONCE }),
    ).toThrowError("SESSION_DISCONNECTED");
    expect(() =>
      registry.resolve(token, { requestId: "u".repeat(24), result: sceneResult("x") }),
    ).toThrowError("SESSION_DISCONNECTED");
    expect(() => registry.disconnect(token)).toThrowError("SESSION_DISCONNECTED");

    registry.sweepExpired();
    registry.shutdown();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends a held poll and invalidates an unused pair code", async () => {
    const issued = registry.issuePairCode();
    const paired = registry.pair({
      code: issued.code,
      origin: ORIGIN,
      manifestHash: MANIFEST_HASH,
      pageNonce: PAGE_NONCE,
    });
    const stale = registry.issuePairCode();
    const controller = new AbortController();
    const rejection = expect(registry.poll(paired.sessionToken, controller.signal)).rejects.toThrowError(
      "SESSION_DISCONNECTED",
    );

    registry.shutdown();
    await rejection;
    expect(stale.code).toMatch(/^\d{6}$/);
    expect(() =>
      registry.pair({ code: stale.code, origin: ORIGIN, manifestHash: MANIFEST_HASH, pageNonce: PAGE_NONCE }),
    ).toThrowError("SESSION_DISCONNECTED");
  });

  it("clears call timers whose handles have no unref", async () => {
    const handles: number[] = [];
    let nextHandle = 1;
    vi.stubGlobal("setTimeout", () => {
      const handle = nextHandle;
      nextHandle += 1;
      handles.push(handle);
      return handle;
    });
    vi.stubGlobal("clearTimeout", (handle: number) => {
      const index = handles.indexOf(handle);
      if (index !== -1) handles.splice(index, 1);
    });

    pairPage();
    const { promise } = forward("get_scene");
    expect(handles).toHaveLength(1);

    registry.shutdown();
    await expect(promise).rejects.toThrowError("SESSION_DISCONNECTED");
    expect(handles).toHaveLength(0);
  });
});
