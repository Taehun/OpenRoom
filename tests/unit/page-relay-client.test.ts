import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  PageRelayClient,
  PageRelayError,
  type LocalMcpStatus,
  type RelayCallOutcome,
} from "../../src/local-mcp/page-relay-client";
import {
  DEFAULT_RELAY_PORT,
  PairRequestSchema,
  RelayToolResultSchema,
  type RelayToolCall,
} from "../../src/local-mcp/relay-protocol";
import {
  FakeRelayServer,
  PAGE_ORIGIN,
  RELAY_SESSION_TOKEN,
  TEST_MANIFEST_HASH,
  postedResults,
} from "../helpers/relay-server";

const GET_SCENE_CALL = {
  requestId: "req-get-scene-0001",
  toolName: "get_scene",
  input: {},
};

const MOVE_CALL = {
  requestId: "req-move-object-001",
  toolName: "move_object",
  input: {
    objectId: "lamp_01",
    position: { x: 0, z: 0 },
    expectedRevision: 1,
    expectedStateVersion: 1,
  },
};

function okResult(text: string): RelayCallOutcome {
  return {
    content: [{ type: "text", text }],
    structuredContent: {
      ok: true,
      tool: "get_scene",
      sceneRevision: 1,
      stateVersion: 1,
      data: { text },
    },
  };
}

interface Harness {
  server: FakeRelayServer;
  client: PageRelayClient;
  statuses: LocalMcpStatus[];
  onCall: ReturnType<typeof vi.fn>;
}

function createHarness(
  overrides: {
    baseUrl?: string;
    onCall?: (call: RelayToolCall, signal: AbortSignal) => Promise<RelayCallOutcome>;
  } = {},
): Harness {
  const server = new FakeRelayServer();
  const statuses: LocalMcpStatus[] = [];
  const onCall = vi.fn(
    overrides.onCall ??
      (async (call: RelayToolCall) => okResult(`executed ${call.toolName}`)),
  );
  const client = new PageRelayClient({
    ...(overrides.baseUrl === undefined ? {} : { baseUrl: overrides.baseUrl }),
    origin: PAGE_ORIGIN,
    fetchImpl: server.fetch,
    onCall: onCall as never,
    onStatus: (status) => statuses.push(status),
  });

  return { server, client, statuses, onCall };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PageRelayClient pairing", () => {
  test("posts the loopback pair request with origin, manifest hash, and a fresh nonce", async () => {
    const getRandomValues = vi.spyOn(globalThis.crypto, "getRandomValues");
    const { server, client, statuses } = createHarness();

    await client.pair("123456", TEST_MANIFEST_HASH);

    const pair = server.requests[0];
    expect(pair?.url).toBe(`http://127.0.0.1:${DEFAULT_RELAY_PORT}/v1/pair`);
    expect(pair?.method).toBe("POST");
    expect(pair?.cache).toBe("no-store");
    const parsed = PairRequestSchema.safeParse(pair?.body);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("Expected a valid pair request");
    expect(parsed.data.code).toBe("123456");
    expect(parsed.data.origin).toBe(PAGE_ORIGIN);
    expect(parsed.data.manifestHash).toBe(TEST_MANIFEST_HASH);
    expect(parsed.data.pageNonce.length).toBeGreaterThanOrEqual(32);
    expect(parsed.data.pageNonce).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(getRandomValues).toHaveBeenCalled();
    expect(statuses).toEqual(["pairing", "connected"]);

    await client.disconnect();
  });

  test("uses the port from the advanced control instead of the default", async () => {
    const { server, client } = createHarness({
      baseUrl: "http://127.0.0.1:43999",
    });

    await client.pair("123456", TEST_MANIFEST_HASH);

    expect(server.requests[0]?.url).toBe("http://127.0.0.1:43999/v1/pair");
    await client.disconnect();
  });

  test("keeps the session token out of storage, the URL, the DOM, and logs", async () => {
    const logs = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
    ];
    const { server, client } = createHarness();

    await client.pair("123456", TEST_MANIFEST_HASH);
    await server.waitForPoll();

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.body.innerHTML).not.toContain(RELAY_SESSION_TOKEN);
    expect(window.location.href).not.toContain(RELAY_SESSION_TOKEN);
    expect(JSON.stringify(client)).toBe("{}");
    expect(Object.keys(client)).toHaveLength(0);
    for (const spy of logs) expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify(server.requests[0]?.body)).not.toContain(
      RELAY_SESSION_TOKEN,
    );

    await client.disconnect();
  });

  test("rejects a refused pair code without starting a poll", async () => {
    const { server, client, statuses } = createHarness();
    server.pairStatus = 403;
    server.pairBody = {
      code: "PAIR_REJECTED",
      message: "PAIR_REJECTED",
      retryable: false,
    };

    await expect(client.pair("000000", TEST_MANIFEST_HASH)).rejects.toThrow(
      PageRelayError,
    );
    expect(statuses).toEqual(["pairing", "not-connected"]);
    expect(server.polls).toHaveLength(0);
  });

  // A refused request never reached a relay, which the browser can see for
  // itself — so it is never reported as a bad code.
  test("separates an unreachable companion from a refused code", async () => {
    const statuses: LocalMcpStatus[] = [];
    const failure = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const client = new PageRelayClient({
      origin: PAGE_ORIGIN,
      fetchImpl: failure as unknown as typeof fetch,
      onCall: async () => okResult("unused"),
      onStatus: (status) => statuses.push(status),
    });

    await expect(client.pair("123456", TEST_MANIFEST_HASH)).rejects.toMatchObject(
      { code: "COMPANION_UNREACHABLE", message: "COMPANION_UNREACHABLE" },
    );
    expect(statuses).toEqual(["pairing", "not-connected"]);
    // One request, the pair attempt; a failed pair never starts a poll.
    expect(failure).toHaveBeenCalledTimes(1);
  });

  test("rejects with INSECURE_CONTEXT when web crypto is unavailable", async () => {
    vi.stubGlobal("crypto", {});
    const { server, client } = createHarness();

    await expect(
      client.pair("123456", TEST_MANIFEST_HASH),
    ).rejects.toMatchObject({ code: "INSECURE_CONTEXT", message: "INSECURE_CONTEXT" });
    expect(server.requests).toHaveLength(0);
  });
});

describe("PageRelayClient polling", () => {
  test("long-polls with bearer authorization and no-store caching", async () => {
    const { server, client } = createHarness();

    await client.pair("123456", TEST_MANIFEST_HASH);
    await server.waitForPoll();

    const poll = server.polls[0];
    expect(poll?.url).toBe(`http://127.0.0.1:${DEFAULT_RELAY_PORT}/v1/calls`);
    expect(poll?.method).toBe("GET");
    expect(poll?.headers.authorization).toBe(`Bearer ${RELAY_SESSION_TOKEN}`);
    expect(poll?.cache).toBe("no-store");

    await client.disconnect();
  });

  test("resumes polling after an idle window closes with no call", async () => {
    const { server, client } = createHarness();

    await client.pair("123456", TEST_MANIFEST_HASH);
    await server.waitForPoll();
    server.releaseEmptyPoll();

    await vi.waitFor(() => expect(server.polls).toHaveLength(2));
    expect(server.results).toHaveLength(0);

    await client.disconnect();
  });

  test("executes one delivered call, posts one result, and polls again", async () => {
    const { server, client, onCall } = createHarness();

    await client.pair("123456", TEST_MANIFEST_HASH);
    await server.waitForPoll();
    await server.deliver(GET_SCENE_CALL);

    expect(onCall).toHaveBeenCalledTimes(1);
    expect(onCall.mock.calls[0]?.[0]).toMatchObject({
      requestId: GET_SCENE_CALL.requestId,
      toolName: "get_scene",
    });
    expect(onCall.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
    const post = server.results[0];
    expect(post?.url).toBe(
      `http://127.0.0.1:${DEFAULT_RELAY_PORT}/v1/results/${GET_SCENE_CALL.requestId}`,
    );
    expect(post?.headers.authorization).toBe(`Bearer ${RELAY_SESSION_TOKEN}`);
    expect(RelayToolResultSchema.safeParse(post?.body).success).toBe(true);
    await vi.waitFor(() => expect(server.polls).toHaveLength(2));

    await client.disconnect();
  });

  test("answers a tool outside the Core 6 with UNKNOWN_TOOL and never executes it", async () => {
    const { server, client, onCall } = createHarness();

    await client.pair("123456", TEST_MANIFEST_HASH);
    await server.waitForPoll();
    await server.deliver({
      requestId: "req-unknown-tool-01",
      toolName: "delete_everything",
      input: {},
    });

    expect(onCall).not.toHaveBeenCalled();
    const [posted] = postedResults(server);
    expect(posted?.requestId).toBe("req-unknown-tool-01");
    expect(posted?.result.structuredContent.ok).toBe(false);
    expect(posted?.result.structuredContent.error?.code).toBe("UNKNOWN_TOOL");
    await vi.waitFor(() => expect(server.polls).toHaveLength(2));

    await client.disconnect();
  });

  test("replays the cached result for a redelivered request id without executing twice", async () => {
    const { server, client, onCall } = createHarness();

    await client.pair("123456", TEST_MANIFEST_HASH);
    await server.waitForPoll();
    await server.deliver(GET_SCENE_CALL);
    await server.deliver(GET_SCENE_CALL);

    expect(onCall).toHaveBeenCalledTimes(1);
    const posted = postedResults(server);
    expect(posted).toHaveLength(2);
    expect(posted[1]).toEqual(posted[0]);

    await client.disconnect();
  });
});

describe("PageRelayClient failure handling", () => {
  test("loses the session on an unauthorized poll and stops polling", async () => {
    const { server, client, statuses } = createHarness();

    await client.pair("123456", TEST_MANIFEST_HASH);
    await server.waitForPoll();
    server.failPoll(401);

    await vi.waitFor(() => expect(statuses.at(-1)).toBe("connection-lost"));
    const polls = server.polls.length;
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(server.polls).toHaveLength(polls);
  });

  test("loses the session on a transport failure and stops polling", async () => {
    const { server, client, statuses } = createHarness();

    await client.pair("123456", TEST_MANIFEST_HASH);
    await server.waitForPoll();
    server.breakPoll();

    await vi.waitFor(() => expect(statuses.at(-1)).toBe("connection-lost"));
    const polls = server.polls.length;
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(server.polls).toHaveLength(polls);
  });

  test("never retries a mutation request id after the result post is rejected", async () => {
    const { server, client, statuses, onCall } = createHarness();

    await client.pair("123456", TEST_MANIFEST_HASH);
    await server.waitForPoll();
    server.resultStatus = 401;
    server.enqueueCall(MOVE_CALL);

    await vi.waitFor(() => expect(statuses.at(-1)).toBe("connection-lost"));
    expect(onCall).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(server.results).toHaveLength(1);
    expect(server.polls).toHaveLength(1);
  });

  test("abandons a long poll that never answers", async () => {
    vi.useFakeTimers();
    try {
      const { server, client, statuses } = createHarness();

      await client.pair("123456", TEST_MANIFEST_HASH);
      await vi.waitFor(() => expect(server.polls).toHaveLength(1));
      await vi.advanceTimersByTimeAsync(30_001);

      expect(statuses.at(-1)).toBe("connection-lost");
      expect(server.polls).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("PageRelayClient shutdown", () => {
  test("aborts the poll and the active call, then deletes the session once", async () => {
    let callSignal: AbortSignal | undefined;
    let started: () => void = () => undefined;
    const callStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const { server, client, statuses } = createHarness({
      onCall: (_call, signal) =>
        new Promise<RelayCallOutcome>(() => {
          callSignal = signal;
          started();
        }),
    });

    await client.pair("123456", TEST_MANIFEST_HASH);
    await server.waitForPoll();
    server.enqueueCall(MOVE_CALL);
    await callStarted;
    await client.disconnect();

    expect(callSignal?.aborted).toBe(true);
    expect(server.deletes).toHaveLength(1);
    const [deleted] = server.deletes;
    expect(deleted?.url).toBe(
      `http://127.0.0.1:${DEFAULT_RELAY_PORT}/v1/session`,
    );
    expect(deleted?.headers.authorization).toBe(`Bearer ${RELAY_SESSION_TOKEN}`);
    expect(deleted?.keepalive).toBe(true);
    expect(statuses.at(-1)).toBe("not-connected");
    expect(server.results).toHaveLength(0);

    const polls = server.polls.length;
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(server.polls).toHaveLength(polls);
  });

  test("sends no second delete when disconnect runs twice", async () => {
    const { server, client } = createHarness();

    await client.pair("123456", TEST_MANIFEST_HASH);
    await server.waitForPoll();
    await client.disconnect();
    await client.disconnect();

    expect(server.deletes).toHaveLength(1);
  });

  test("answers a call redelivered after an aborted execution with DUPLICATE_REQUEST", async () => {
    let started: () => void = () => undefined;
    const callStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const { server, client, onCall } = createHarness({
      onCall: (_call, signal) =>
        new Promise<RelayCallOutcome>((_resolve, reject) => {
          started();
          signal.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    });

    await client.pair("123456", TEST_MANIFEST_HASH);
    await server.waitForPoll();
    server.enqueueCall(MOVE_CALL);
    await callStarted;
    await client.disconnect();
    expect(server.results).toHaveLength(0);

    await client.pair("123456", TEST_MANIFEST_HASH);
    await server.waitForPoll();
    await server.deliver(MOVE_CALL);

    expect(onCall).toHaveBeenCalledTimes(1);
    const [posted] = postedResults(server);
    expect(posted?.result.structuredContent.ok).toBe(false);
    expect(posted?.result.structuredContent.error?.code).toBe(
      "DUPLICATE_REQUEST",
    );

    await client.disconnect();
  });
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
