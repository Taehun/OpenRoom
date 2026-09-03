import { z } from "zod";

import { CORE_TOOL_NAMES } from "../webmcp/tool-contracts";

/**
 * Wire contract shared by the localhost MCP companion, its loopback HTTP relay,
 * and the paired browser page. Every body crossing the relay is parsed with the
 * strict schemas below before any state changes, and every rejection is one of
 * the typed codes in `RELAY_ERROR_CODES`.
 */

/** Loopback port the relay binds; chosen to avoid common development ports. */
export const DEFAULT_RELAY_PORT = 43_110;

/** A pair code is single use and dies ten minutes after it is issued. */
export const PAIR_CODE_TTL_MS = 10 * 60_000;

/** Hard ceiling for any relay request body, enforced before JSON parsing. */
export const MAX_BODY_BYTES = 64 * 1024;

/** Concurrent in-flight tool calls a single paired page may owe results for. */
export const MAX_PENDING_CALLS = 8;

/** A forwarded tool call is abandoned after this long; it is never retried. */
export const CALL_TIMEOUT_MS = 30_000;

/** A session without a valid poll for this long is treated as disconnected. */
export const HEARTBEAT_TIMEOUT_MS = 45_000;

/** Development origins allowed to pair; anything else is rejected outright. */
export const DEFAULT_ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

/** Six ASCII digits, shown to the operator and typed into the paired page. */
const pairCode = z.string().regex(/^[0-9]{6}$/);

/** Lowercase SHA-256 hex of the canonical Core 6 manifest. */
const manifestHash = z.string().regex(/^[0-9a-f]{64}$/);

/** Opaque high-entropy secret: bounded length, URL safe alphabet only. */
const secret = z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/);

/** Bare origin with no path, no credentials, and no wildcard. */
const origin = z.string().max(255).regex(/^https?:\/\/[a-z0-9.-]{1,120}(?::[0-9]{1,5})?$/);

/** Correlates a forwarded call with the result the page posts back. */
const requestId = z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/);

/** Epoch milliseconds. */
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const PairRequestSchema = z
  .object({
    code: pairCode,
    origin,
    manifestHash,
    pageNonce: secret,
  })
  .strict();
export type PairRequest = z.infer<typeof PairRequestSchema>;

export const PairResponseSchema = z
  .object({
    sessionToken: secret,
    expiresAt: timestamp,
  })
  .strict();
export type PairResponse = z.infer<typeof PairResponseSchema>;

/**
 * `input` and `result` stay `unknown` because this envelope is only produced or
 * accepted after the session token authenticates; the browser re-validates the
 * payload with the Core 6 Zod contract before executing anything.
 */
export const RelayToolCallSchema = z
  .object({
    requestId,
    toolName: z.enum(CORE_TOOL_NAMES),
    input: z.unknown(),
  })
  .strict();
export type RelayToolCall = z.infer<typeof RelayToolCallSchema>;

export const RelayToolResultSchema = z
  .object({
    requestId,
    result: z.unknown(),
  })
  .strict();
export type RelayToolResult = z.infer<typeof RelayToolResultSchema>;

export const RELAY_ERROR_CODES = [
  "PAIR_REJECTED",
  "UNAUTHORIZED",
  "TOO_MANY_PENDING_CALLS",
  "CALL_TIMEOUT",
  "SESSION_DISCONNECTED",
  "PAGE_UNAVAILABLE",
] as const;
export type RelayErrorCode = (typeof RELAY_ERROR_CODES)[number];

/** Whether a caller may sensibly repeat the request that produced the code. */
export const RELAY_ERROR_RETRYABLE: Readonly<Record<RelayErrorCode, boolean>> = {
  PAIR_REJECTED: false,
  UNAUTHORIZED: false,
  TOO_MANY_PENDING_CALLS: true,
  CALL_TIMEOUT: false,
  SESSION_DISCONNECTED: false,
  PAGE_UNAVAILABLE: true,
};

export const RelayErrorSchema = z
  .object({
    code: z.enum(RELAY_ERROR_CODES),
    message: z.string().min(1).max(500),
    retryable: z.boolean(),
  })
  .strict();
export type RelayErrorBody = z.infer<typeof RelayErrorSchema>;

/**
 * The only error type the relay throws. The message is always exactly the code
 * so that distinct failure reasons - an expired pair code, a mistyped code, a
 * disallowed origin, a manifest mismatch - stay indistinguishable to a caller.
 */
export class RelayError extends Error {
  readonly code: RelayErrorCode;
  readonly retryable: boolean;

  constructor(code: RelayErrorCode, retryable: boolean = RELAY_ERROR_RETRYABLE[code]) {
    super(code);
    this.name = "RelayError";
    this.code = code;
    this.retryable = retryable;
  }

  /** Serializable body for an HTTP or stdio response. */
  toBody(): RelayErrorBody {
    return { code: this.code, message: this.message, retryable: this.retryable };
  }
}

export function isRelayError(value: unknown): value is RelayError {
  return value instanceof RelayError;
}
