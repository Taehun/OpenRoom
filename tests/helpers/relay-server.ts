import { expect, vi } from "vitest";

/**
 * In-memory stand-in for the loopback relay of Task 3. It records every request
 * the paired page makes, holds `GET /v1/calls` open the way a long poll does,
 * and lets a test release exactly one call, one empty poll, or one failure.
 */

/** Matches the protocol `secret` shape so `PairResponseSchema` accepts it. */
export const RELAY_SESSION_TOKEN = "session-token-0123456789abcdefghij";

/** Lowercase 64-character hex, the shape `PairRequestSchema` demands. */
export const TEST_MANIFEST_HASH = "a".repeat(64);

export const PAGE_ORIGIN = "http://localhost:3000";

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  cache: string | undefined;
  keepalive: boolean | undefined;
  body: unknown;
}

function respond(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function headersOf(init: RequestInit): Record<string, string> {
  const source = init.headers as Record<string, string> | undefined;
  if (!source) return {};
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key.toLowerCase(), value]),
  );
}

interface PollWaiter {
  resolve(response: Response): void;
  reject(reason: unknown): void;
}

export class FakeRelayServer {
  readonly requests: RecordedRequest[] = [];
  pairStatus = 200;
  pairBody: unknown = {
    sessionToken: RELAY_SESSION_TOKEN,
    expiresAt: 1_800_000,
  };
  resultStatus = 202;

  #waiting: PollWaiter[] = [];
  #queued: unknown[] = [];

  readonly fetch = vi.fn(
    async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
      const url = String(input);
      const method = (init.method ?? "GET").toUpperCase();
      this.requests.push({
        url,
        method,
        headers: headersOf(init),
        cache: init.cache,
        keepalive: init.keepalive,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      });

      if (url.endsWith("/v1/pair")) return respond(this.pairStatus, this.pairBody);
      if (url.endsWith("/v1/session")) return respond(204, null);
      if (url.includes("/v1/results/")) return respond(this.resultStatus, null);
      if (url.endsWith("/v1/calls")) return this.#poll(init.signal ?? null);
      throw new Error(`Unexpected relay request: ${method} ${url}`);
    },
  ) as unknown as typeof fetch;

  get polls(): RecordedRequest[] {
    return this.requests.filter(({ url }) => url.endsWith("/v1/calls"));
  }

  get results(): RecordedRequest[] {
    return this.requests.filter(({ url }) => url.includes("/v1/results/"));
  }

  get deletes(): RecordedRequest[] {
    return this.requests.filter(({ method }) => method === "DELETE");
  }

  get waitingPolls(): number {
    return this.#waiting.length;
  }

  /** Resolves once the client is parked on a long poll. */
  async waitForPoll(): Promise<void> {
    await vi.waitFor(() => expect(this.#waiting.length).toBeGreaterThan(0));
  }

  /** Hands one tool call to the paired page. */
  enqueueCall(call: unknown): void {
    const waiter = this.#waiting.shift();
    if (waiter) {
      waiter.resolve(respond(200, call));
      return;
    }
    this.#queued.push(call);
  }

  /** Hands one call over and resolves once its result is posted back. */
  async deliver(call: unknown): Promise<void> {
    const before = this.results.length;
    this.enqueueCall(call);
    await vi.waitFor(() => expect(this.results.length).toBe(before + 1));
  }

  /** Ends the open long poll the way a 25 second idle window does. */
  releaseEmptyPoll(): void {
    this.#waiting.shift()?.resolve(respond(204, null));
  }

  /** Ends the open long poll with an HTTP failure. */
  failPoll(status: number): void {
    this.#waiting
      .shift()
      ?.resolve(
        respond(status, {
          code: "UNAUTHORIZED",
          message: "UNAUTHORIZED",
          retryable: false,
        }),
      );
  }

  /** Ends the open long poll with a transport failure. */
  breakPoll(): void {
    this.#waiting.shift()?.reject(new TypeError("Failed to fetch"));
  }

  async #poll(signal: AbortSignal | null): Promise<Response> {
    const queued = this.#queued.shift();
    if (queued !== undefined) return respond(200, queued);
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    return new Promise<Response>((resolve, reject) => {
      const waiter: PollWaiter = { resolve, reject };
      this.#waiting.push(waiter);
      signal?.addEventListener(
        "abort",
        () => {
          this.#waiting = this.#waiting.filter((entry) => entry !== waiter);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    });
  }
}

/** Posted result bodies, in the order the page sent them. */
export function postedResults(server: FakeRelayServer): Array<{
  requestId: string;
  result: {
    structuredContent: {
      ok: boolean;
      error?: { code: string; message: string };
      sceneRevision?: number;
      stateVersion?: number;
    };
  };
}> {
  return server.results.map(({ body }) => body as never);
}
