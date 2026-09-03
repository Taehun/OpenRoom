import { z } from "zod";

import { CORE_TOOL_NAMES, type CoreToolName } from "../webmcp/tool-contracts";
import type { ToolResult } from "../webmcp/tool-result";
import {
  DEFAULT_RELAY_PORT,
  PairResponseSchema,
  type RelayToolCall,
  type RelayToolResult,
} from "./relay-protocol";

/**
 * Browser half of the local MCP companion. The page pairs once with a manually
 * typed code, then long polls the loopback relay for tool calls, executes each
 * one exactly once against the live Core 6 descriptors, and posts the result
 * back. The session token never leaves this instance: it lives in a private
 * field, is sent only as an `Authorization` header, and is never stored,
 * logged, rendered, or written to the URL.
 */

export type LocalMcpStatus =
  | "not-connected"
  | "pairing"
  | "connected"
  | "connection-lost";

export const PAGE_RELAY_ERROR_CODES = [
  "INSECURE_CONTEXT",
  "PAIR_REJECTED",
] as const;
export type PageRelayErrorCode = (typeof PAGE_RELAY_ERROR_CODES)[number];

/**
 * Pairing failures the page can surface. Like `RelayError`, the message is
 * exactly the code so a rejected code, an expired code, a disallowed origin,
 * and a manifest mismatch stay indistinguishable from one another.
 */
export class PageRelayError extends Error {
  readonly code: PageRelayErrorCode;

  constructor(code: PageRelayErrorCode) {
    super(code);
    this.name = "PageRelayError";
    this.code = code;
  }
}

export function isPageRelayError(value: unknown): value is PageRelayError {
  return value instanceof PageRelayError;
}

/** Transport-level refusals that never reach a Core 6 descriptor. */
export type RelayCallErrorCode =
  | "UNKNOWN_TOOL"
  | "DUPLICATE_REQUEST"
  | "EXECUTION_FAILED";

/** Shaped like `ToolFailure` but for names and requests no descriptor owns. */
export interface RelayCallFailure {
  content: [{ type: "text"; text: string }];
  structuredContent: {
    ok: false;
    tool: string;
    error: { code: RelayCallErrorCode; message: string; retryable: boolean };
  };
  isError: true;
}

export type RelayCallOutcome = ToolResult<unknown> | RelayCallFailure;

export function relayCallFailure(
  tool: string,
  code: RelayCallErrorCode,
  message: string,
): RelayCallFailure {
  return {
    content: [{ type: "text", text: message }],
    structuredContent: {
      ok: false,
      tool,
      error: { code, message, retryable: false },
    },
    isError: true,
  };
}

export interface PageRelayClientOptions {
  baseUrl?: string;
  origin: string;
  fetchImpl?: typeof fetch;
  onCall(call: RelayToolCall, signal: AbortSignal): Promise<RelayCallOutcome>;
  onStatus(status: LocalMcpStatus): void;
}

/** Longer than the relay's own long-poll window, so only a stall trips it. */
const POLL_TIMEOUT_MS = 30_000;

/** Completed ids kept so a redelivered call is never executed a second time. */
const MAX_COMPLETED_REQUESTS = 256;

/** Marks a call that started but whose result was never posted. */
const PENDING = Symbol("pending-relay-call");

/**
 * Deliberately looser than `RelayToolCallSchema`: a well-formed envelope naming
 * a tool outside the Core 6 must be answered with `UNKNOWN_TOOL` rather than
 * dropped, while the request id stays strict because it becomes a URL segment.
 */
const RelayCallEnvelopeSchema = z
  .object({
    requestId: z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/),
    toolName: z.string().min(1).max(64),
    input: z.unknown(),
  })
  .strict();

function isCoreToolName(value: string): value is CoreToolName {
  return (CORE_TOOL_NAMES as readonly string[]).includes(value);
}

/** `crypto.subtle` and `getRandomValues` exist only in a secure context. */
export function isSecureCryptoContext(): boolean {
  const webCrypto = globalThis.crypto as Crypto | undefined;
  return (
    typeof webCrypto?.getRandomValues === "function" &&
    typeof webCrypto.subtle?.digest === "function"
  );
}

export function assertSecureCryptoContext(): void {
  if (!isSecureCryptoContext()) throw new PageRelayError("INSECURE_CONTEXT");
}

/** 24 random bytes as 32 base64url characters, the protocol's `secret` shape. */
function createPageNonce(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export class PageRelayClient {
  readonly #baseUrl: string;
  readonly #origin: string;
  readonly #fetchImpl: typeof fetch | undefined;
  readonly #onCall: PageRelayClientOptions["onCall"];
  readonly #onStatus: (status: LocalMcpStatus) => void;
  readonly #completed = new Map<string, RelayCallOutcome | typeof PENDING>();
  #token: string | null = null;
  #closed = true;
  #pollController: AbortController | null = null;
  #callController: AbortController | null = null;

  constructor(options: PageRelayClientOptions) {
    this.#baseUrl = (
      options.baseUrl ?? `http://127.0.0.1:${DEFAULT_RELAY_PORT}`
    ).replace(/\/+$/, "");
    this.#origin = options.origin;
    this.#fetchImpl = options.fetchImpl;
    this.#onCall = options.onCall;
    this.#onStatus = options.onStatus;
  }

  /** Exchanges a manually typed code for a session token and starts polling. */
  async pair(code: string, manifestHash: string): Promise<void> {
    assertSecureCryptoContext();
    this.#closed = false;
    this.#onStatus("pairing");

    let response: Response;
    try {
      response = await this.#request("/v1/pair", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code,
          origin: this.#origin,
          manifestHash,
          pageNonce: createPageNonce(),
        }),
        cache: "no-store",
      });
    } catch {
      return this.#rejectPairing();
    }

    if (!response.ok) return this.#rejectPairing();
    const body: unknown = await response.json().catch(() => null);
    const paired = PairResponseSchema.safeParse(body);
    if (!paired.success) return this.#rejectPairing();

    this.#token = paired.data.sessionToken;
    this.#onStatus("connected");
    void this.#poll();
  }

  /**
   * Aborts the poll and any running descriptor, then makes one best-effort
   * authenticated `DELETE /v1/session`. Safe to call twice; the second call
   * has no token left to send.
   */
  async disconnect(): Promise<void> {
    const token = this.#token;
    const wasClosed = this.#closed;
    this.#token = null;
    this.#closed = true;
    this.#pollController?.abort();
    this.#callController?.abort();
    this.#pollController = null;
    this.#callController = null;
    if (!wasClosed || token !== null) this.#onStatus("not-connected");
    if (token === null) return;

    try {
      await this.#request("/v1/session", {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
        keepalive: true,
      });
    } catch {
      // Best effort only: the relay expires an unheard-from session on its own.
    }
  }

  #rejectPairing(): never {
    this.#token = null;
    this.#closed = true;
    this.#onStatus("not-connected");
    throw new PageRelayError("PAIR_REJECTED");
  }

  async #poll(): Promise<void> {
    while (!this.#closed && this.#token !== null) {
      const controller = new AbortController();
      this.#pollController = controller;
      const timeout = setTimeout(() => {
        controller.abort(new DOMException("Timeout", "TimeoutError"));
      }, POLL_TIMEOUT_MS);

      let response: Response;
      try {
        response = await this.#request("/v1/calls", {
          method: "GET",
          headers: { authorization: `Bearer ${this.#token}` },
          cache: "no-store",
          signal: controller.signal,
        });
      } catch {
        // An abort during shutdown is expected; anything else lost the session.
        if (!this.#closed) this.#lose();
        return;
      } finally {
        clearTimeout(timeout);
        this.#pollController = null;
      }

      if (this.#closed) return;
      if (response.status === 204) continue;
      if (!response.ok) {
        this.#lose();
        return;
      }

      const payload: unknown = await response.json().catch(() => null);
      if (!(await this.#handleCall(payload))) return;
    }
  }

  /** Returns whether polling may continue. */
  async #handleCall(payload: unknown): Promise<boolean> {
    const envelope = RelayCallEnvelopeSchema.safeParse(payload);
    if (!envelope.success) {
      this.#lose();
      return false;
    }
    const { requestId, toolName, input } = envelope.data;

    const previous = this.#completed.get(requestId);
    if (previous !== undefined) {
      // A redelivered call is answered from memory; a mutation is never replayed.
      return this.#postResult(
        requestId,
        previous === PENDING
          ? relayCallFailure(
              toolName,
              "DUPLICATE_REQUEST",
              "This request was already delivered and is never executed twice.",
            )
          : previous,
      );
    }

    if (!isCoreToolName(toolName)) {
      const failure = relayCallFailure(
        toolName,
        "UNKNOWN_TOOL",
        "This page exposes only the Core 6 tools.",
      );
      this.#remember(requestId, failure);
      return this.#postResult(requestId, failure);
    }

    const call: RelayToolCall = { requestId, toolName, input };
    this.#remember(requestId, PENDING);
    const controller = new AbortController();
    this.#callController = controller;
    let outcome: RelayCallOutcome;
    try {
      outcome = await this.#onCall(call, controller.signal);
    } catch {
      // The call stays remembered as pending, so a redelivery is refused rather
      // than re-executed against the Scene.
      if (this.#closed || controller.signal.aborted) return false;
      outcome = relayCallFailure(
        toolName,
        "EXECUTION_FAILED",
        "The page could not complete this tool call.",
      );
    } finally {
      this.#callController = null;
    }

    this.#remember(requestId, outcome);
    return this.#postResult(requestId, outcome);
  }

  /** Returns whether polling may continue; a failed post is never retried. */
  async #postResult(
    requestId: string,
    result: RelayCallOutcome,
  ): Promise<boolean> {
    if (this.#closed || this.#token === null) return false;

    let response: Response;
    try {
      response = await this.#request(
        `/v1/results/${encodeURIComponent(requestId)}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.#token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ requestId, result } satisfies RelayToolResult),
          cache: "no-store",
        },
      );
    } catch {
      if (!this.#closed) this.#lose();
      return false;
    }

    if (!response.ok) {
      this.#lose();
      return false;
    }
    return true;
  }

  #remember(
    requestId: string,
    outcome: RelayCallOutcome | typeof PENDING,
  ): void {
    this.#completed.delete(requestId);
    this.#completed.set(requestId, outcome);
    while (this.#completed.size > MAX_COMPLETED_REQUESTS) {
      const oldest = this.#completed.keys().next();
      if (oldest.done) break;
      this.#completed.delete(oldest.value);
    }
  }

  /** Ends the session without re-pairing; only the operator may reconnect. */
  #lose(): void {
    if (this.#closed && this.#token === null) return;
    this.#token = null;
    this.#closed = true;
    this.#pollController?.abort();
    this.#callController?.abort();
    this.#onStatus("connection-lost");
  }

  #request(path: string, init: RequestInit): Promise<Response> {
    const call = this.#fetchImpl ?? globalThis.fetch.bind(globalThis);
    return call(`${this.#baseUrl}${path}`, init);
  }
}
