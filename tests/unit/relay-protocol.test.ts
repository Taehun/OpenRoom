import { describe, expect, it } from "vitest";

import {
  CALL_TIMEOUT_MS,
  DEFAULT_ALLOWED_ORIGINS,
  DEFAULT_RELAY_PORT,
  HEARTBEAT_TIMEOUT_MS,
  MAX_BODY_BYTES,
  MAX_PENDING_CALLS,
  PAIR_CODE_TTL_MS,
  PairRequestSchema,
  PairResponseSchema,
  RELAY_ERROR_CODES,
  RELAY_ERROR_RETRYABLE,
  RelayError,
  RelayErrorSchema,
  RelayToolCallSchema,
  RelayToolResultSchema,
  isRelayError,
} from "../../src/local-mcp/relay-protocol";
import { CORE_TOOL_NAMES } from "../../src/webmcp/tool-contracts";

const HASH = "a".repeat(64);
const NONCE = "n".repeat(32);
const TOKEN = "t".repeat(43);
const REQUEST_ID = "r".repeat(16);

function pairRequest(overrides: Record<string, unknown> = {}) {
  return {
    code: "123456",
    origin: "http://localhost:3000",
    manifestHash: HASH,
    pageNonce: NONCE,
    ...overrides,
  };
}

describe("relay protocol constants", () => {
  it("pins the exact security budget", () => {
    expect(DEFAULT_RELAY_PORT).toBe(43_110);
    expect(PAIR_CODE_TTL_MS).toBe(10 * 60_000);
    expect(MAX_BODY_BYTES).toBe(64 * 1024);
    expect(MAX_PENDING_CALLS).toBe(8);
    expect(CALL_TIMEOUT_MS).toBe(30_000);
    expect(HEARTBEAT_TIMEOUT_MS).toBe(45_000);
  });

  it("allows only the two loopback development origins", () => {
    expect([...DEFAULT_ALLOWED_ORIGINS].sort()).toEqual([
      "http://127.0.0.1:3000",
      "http://localhost:3000",
    ]);
    expect(DEFAULT_ALLOWED_ORIGINS.has("http://localhost:3001")).toBe(false);
    expect(DEFAULT_ALLOWED_ORIGINS.has("https://openinterior.example")).toBe(false);
    expect(DEFAULT_ALLOWED_ORIGINS.has("null")).toBe(false);
  });
});

describe("PairRequestSchema", () => {
  it("accepts a well formed request", () => {
    expect(PairRequestSchema.safeParse(pairRequest()).success).toBe(true);
  });

  it("rejects unknown keys", () => {
    expect(
      PairRequestSchema.safeParse({
        code: "123456",
        origin: "http://localhost:3000",
        manifestHash: "a".repeat(64),
        pageNonce: "n".repeat(32),
        extra: true,
      }).success,
    ).toBe(false);
  });

  it("requires exactly six ASCII digits for the pair code", () => {
    for (const code of ["12345", "1234567", "12345a", "12 456", "１２３４５６", "", 123456]) {
      expect(PairRequestSchema.safeParse(pairRequest({ code })).success).toBe(false);
    }
    expect(PairRequestSchema.safeParse(pairRequest({ code: "000000" })).success).toBe(true);
  });

  it("requires a 64 character lowercase hex manifest hash", () => {
    for (const manifestHash of ["a".repeat(63), "a".repeat(65), "A".repeat(64), `${"a".repeat(63)}g`, ""]) {
      expect(PairRequestSchema.safeParse(pairRequest({ manifestHash })).success).toBe(false);
    }
    expect(
      PairRequestSchema.safeParse(pairRequest({ manifestHash: "0123456789abcdef".repeat(4) })).success,
    ).toBe(true);
  });

  it("bounds the page nonce to 32..128 URL safe characters", () => {
    expect(PairRequestSchema.safeParse(pairRequest({ pageNonce: "n".repeat(31) })).success).toBe(false);
    expect(PairRequestSchema.safeParse(pairRequest({ pageNonce: "n".repeat(32) })).success).toBe(true);
    expect(PairRequestSchema.safeParse(pairRequest({ pageNonce: "n".repeat(128) })).success).toBe(true);
    expect(PairRequestSchema.safeParse(pairRequest({ pageNonce: "n".repeat(129) })).success).toBe(false);
    expect(PairRequestSchema.safeParse(pairRequest({ pageNonce: `${"n".repeat(31)} ` })).success).toBe(false);
    expect(PairRequestSchema.safeParse(pairRequest({ pageNonce: `${"n".repeat(31)}<` })).success).toBe(false);
  });

  it("rejects origins that are not bare loopback style origins", () => {
    for (const origin of [
      "http://localhost:3000/",
      "http://localhost:3000/pair",
      "javascript:alert(1)",
      "file://",
      "null",
      "",
    ]) {
      expect(PairRequestSchema.safeParse(pairRequest({ origin })).success).toBe(false);
    }
    expect(PairRequestSchema.safeParse(pairRequest({ origin: "http://127.0.0.1:3000" })).success).toBe(true);
  });

  it("rejects missing fields", () => {
    for (const key of ["code", "origin", "manifestHash", "pageNonce"]) {
      const body = pairRequest();
      delete (body as Record<string, unknown>)[key];
      expect(PairRequestSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe("PairResponseSchema", () => {
  it("accepts a bounded token and integer expiry", () => {
    expect(PairResponseSchema.safeParse({ sessionToken: TOKEN, expiresAt: 1_700_000_000_000 }).success).toBe(true);
  });

  it("rejects short, long, unsafe, or extra fields", () => {
    expect(PairResponseSchema.safeParse({ sessionToken: "t".repeat(31), expiresAt: 1 }).success).toBe(false);
    expect(PairResponseSchema.safeParse({ sessionToken: "t".repeat(129), expiresAt: 1 }).success).toBe(false);
    expect(PairResponseSchema.safeParse({ sessionToken: `${"t".repeat(42)}!`, expiresAt: 1 }).success).toBe(false);
    expect(PairResponseSchema.safeParse({ sessionToken: TOKEN, expiresAt: 1.5 }).success).toBe(false);
    expect(PairResponseSchema.safeParse({ sessionToken: TOKEN, expiresAt: -1 }).success).toBe(false);
    expect(PairResponseSchema.safeParse({ sessionToken: TOKEN, expiresAt: 1, extra: true }).success).toBe(false);
  });
});

describe("RelayToolCallSchema", () => {
  it("accepts every Core 6 tool name with opaque input", () => {
    for (const toolName of CORE_TOOL_NAMES) {
      const parsed = RelayToolCallSchema.safeParse({ requestId: REQUEST_ID, toolName, input: { nested: [1, "x"] } });
      expect(parsed.success).toBe(true);
    }
  });

  it("rejects tool names outside the Core 6", () => {
    for (const toolName of ["delete_everything", "get_scene ", "GET_SCENE", ""]) {
      expect(RelayToolCallSchema.safeParse({ requestId: REQUEST_ID, toolName, input: {} }).success).toBe(false);
    }
  });

  it("bounds the request id to 16..128 URL safe characters", () => {
    const call = (requestId: unknown) => RelayToolCallSchema.safeParse({ requestId, toolName: "get_scene", input: {} });
    expect(call("r".repeat(15)).success).toBe(false);
    expect(call("r".repeat(16)).success).toBe(true);
    expect(call("r".repeat(128)).success).toBe(true);
    expect(call("r".repeat(129)).success).toBe(false);
    expect(call(`${"r".repeat(15)}/`).success).toBe(false);
    expect(call(`${"r".repeat(15)}?`).success).toBe(false);
    expect(call(`${"r".repeat(15)} `).success).toBe(false);
  });

  it("requires the input key and rejects unknown keys", () => {
    expect(RelayToolCallSchema.safeParse({ requestId: REQUEST_ID, toolName: "get_scene" }).success).toBe(false);
    expect(
      RelayToolCallSchema.safeParse({ requestId: REQUEST_ID, toolName: "get_scene", input: {}, extra: 1 }).success,
    ).toBe(false);
  });
});

describe("RelayToolResultSchema", () => {
  it("carries an opaque result for a bounded request id", () => {
    const parsed = RelayToolResultSchema.safeParse({
      requestId: REQUEST_ID,
      result: { content: [{ type: "text", text: "ok" }], structuredContent: { ok: true } },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown keys, bad ids, and a missing result", () => {
    expect(RelayToolResultSchema.safeParse({ requestId: REQUEST_ID, result: {}, extra: 1 }).success).toBe(false);
    expect(RelayToolResultSchema.safeParse({ requestId: "short", result: {} }).success).toBe(false);
    expect(RelayToolResultSchema.safeParse({ requestId: REQUEST_ID }).success).toBe(false);
  });
});

describe("RelayErrorSchema", () => {
  it("accepts every typed relay code", () => {
    for (const code of RELAY_ERROR_CODES) {
      expect(RelayErrorSchema.safeParse({ code, message: code, retryable: false }).success).toBe(true);
    }
  });

  it("pins the exact code list and retryability", () => {
    expect([...RELAY_ERROR_CODES]).toEqual([
      "PAIR_REJECTED",
      "UNAUTHORIZED",
      "TOO_MANY_PENDING_CALLS",
      "CALL_TIMEOUT",
      "SESSION_DISCONNECTED",
      "PAGE_UNAVAILABLE",
      "UNKNOWN_TOOL",
      "BAD_REQUEST",
    ]);
    expect(RELAY_ERROR_RETRYABLE).toEqual({
      PAIR_REJECTED: false,
      UNAUTHORIZED: false,
      TOO_MANY_PENDING_CALLS: true,
      CALL_TIMEOUT: false,
      SESSION_DISCONNECTED: false,
      PAGE_UNAVAILABLE: true,
      UNKNOWN_TOOL: false,
      BAD_REQUEST: false,
    });
  });

  it("rejects unknown codes, unbounded messages, and extra keys", () => {
    expect(RelayErrorSchema.safeParse({ code: "TEAPOT", message: "no", retryable: false }).success).toBe(false);
    expect(RelayErrorSchema.safeParse({ code: "UNAUTHORIZED", message: "", retryable: false }).success).toBe(false);
    expect(
      RelayErrorSchema.safeParse({ code: "UNAUTHORIZED", message: "x".repeat(501), retryable: false }).success,
    ).toBe(false);
    expect(
      RelayErrorSchema.safeParse({ code: "UNAUTHORIZED", message: "no", retryable: "false" }).success,
    ).toBe(false);
    expect(
      RelayErrorSchema.safeParse({ code: "UNAUTHORIZED", message: "no", retryable: false, extra: 1 }).success,
    ).toBe(false);
  });
});

describe("RelayError", () => {
  it("uses the typed code as the thrown message so failures stay indistinguishable", () => {
    const error = new RelayError("PAIR_REJECTED");
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("PAIR_REJECTED");
    expect(error.code).toBe("PAIR_REJECTED");
    expect(error.retryable).toBe(false);
    expect(isRelayError(error)).toBe(true);
    expect(isRelayError(new Error("PAIR_REJECTED"))).toBe(false);
    expect(() => {
      throw new RelayError("PAIR_REJECTED");
    }).toThrowError("PAIR_REJECTED");
  });

  it("defaults retryability per code and serializes into a valid wire body", () => {
    for (const code of RELAY_ERROR_CODES) {
      const body = new RelayError(code).toBody();
      expect(body).toEqual({ code, message: code, retryable: RELAY_ERROR_RETRYABLE[code] });
      expect(RelayErrorSchema.safeParse(body).success).toBe(true);
    }
  });
});
