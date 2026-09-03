import {
  CALL_TIMEOUT_MS,
  HEARTBEAT_TIMEOUT_MS,
  MAX_PENDING_CALLS,
  PAIR_CODE_TTL_MS,
  PairRequestSchema,
  RelayError,
  RelayToolResultSchema,
  type PairRequest,
  type PairResponse,
  type RelayToolCall,
  type RelayToolResult,
} from "../../src/local-mcp/relay-protocol";
import type { CoreToolName } from "../../src/webmcp/tool-contracts";
import type { ToolResult } from "../../src/webmcp/tool-result";

export interface SessionRegistryOptions {
  /** Lowercase SHA-256 hex of the canonical Core 6 manifest this build serves. */
  manifestHash: string;
  /** Exact page origins permitted to pair. */
  allowedOrigins: ReadonlySet<string>;
  /** Injected clock, in epoch milliseconds. */
  now?: () => number;
  /** Injected CSPRNG. */
  randomBytes?: (length: number) => Uint8Array;
  /** Operator-facing log sink; never receives secrets or tool payloads. */
  onDiagnostic?: (message: string) => void;
}

interface PendingCall {
  readonly requestId: string;
  readonly toolName: CoreToolName;
  readonly input: unknown;
  /** Set once the paired page has actually received the call through a poll. */
  delivered: boolean;
  resolve: (result: ToolResult<unknown>) => void;
  reject: (error: RelayError) => void;
}

interface PollWaiter {
  resolve: (call: RelayToolCall | null) => void;
  reject: (error: RelayError) => void;
}

interface Session {
  readonly token: string;
  readonly origin: string;
  readonly pageNonce: string;
  lastSeenAt: number;
  readonly pending: Map<string, PendingCall>;
  /** Request ids handed out in FIFO order and not yet delivered. */
  readonly queue: string[];
  waiter: PollWaiter | null;
}

function defaultRandomBytes(length: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/**
 * Six digits drawn from 48 random bits, so the modulo bias against any single
 * code is under one in a hundred million.
 */
function sixDigitCode(randomBytes: (length: number) => Uint8Array): string {
  let value = 0;
  for (const byte of randomBytes(6)) value = value * 256 + byte;
  return String(value % 1_000_000).padStart(6, "0");
}

/** Length-independent comparison, so a token never leaks through timing. */
function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * In-memory state machine behind the loopback relay. It holds exactly one pair
 * code and at most one paired session, and it stores only routing data: request
 * id, Core 6 tool name, the opaque input still in flight, and the resolver plus
 * timeout that settle it. No Scene, selection, catalog, cart, photograph, or
 * completed result is ever retained, and nothing survives process exit.
 */
export class SessionRegistry {
  private readonly manifestHash: string;
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly now: () => number;
  private readonly randomBytes: (length: number) => Uint8Array;
  private readonly onDiagnostic: (message: string) => void;
  private pairCode: { code: string; expiresAt: number } | null = null;
  private session: Session | null = null;

  constructor(options: SessionRegistryOptions) {
    this.manifestHash = options.manifestHash;
    this.allowedOrigins = options.allowedOrigins;
    this.now = options.now ?? (() => Date.now());
    this.randomBytes = options.randomBytes ?? defaultRandomBytes;
    this.onDiagnostic = options.onDiagnostic ?? (() => {});
  }

  /** Mints the single active pair code, replacing any earlier unused code. */
  issuePairCode(): { code: string; expiresAt: number } {
    this.sweepExpired();
    const expiresAt = this.now() + PAIR_CODE_TTL_MS;
    this.pairCode = { code: sixDigitCode(this.randomBytes), expiresAt };
    this.onDiagnostic("pair code issued");
    return { code: this.pairCode.code, expiresAt };
  }

  /**
   * Consumes the pair code and starts a session. Every failure mode - malformed
   * body, expired code, wrong code, disallowed origin, manifest mismatch - fails
   * with the identical `PAIR_REJECTED` error and the same diagnostic line.
   */
  pair(input: PairRequest): PairResponse {
    this.sweepExpired();
    const parsed = PairRequestSchema.safeParse(input);
    const request = parsed.success ? parsed.data : null;
    const active = this.pairCode;
    const codeMatches =
      request !== null && active !== null && active.expiresAt > this.now() && safeEqual(active.code, request.code);
    const originAllowed = request !== null && this.allowedOrigins.has(request.origin);
    const manifestMatches = request !== null && safeEqual(request.manifestHash, this.manifestHash);

    if (request === null || !codeMatches || !originAllowed || !manifestMatches) {
      this.onDiagnostic("pair attempt rejected");
      throw new RelayError("PAIR_REJECTED");
    }

    this.pairCode = null;
    const previous = this.session;
    if (previous) this.destroySession(previous, "replaced by a new pairing");

    const lastSeenAt = this.now();
    this.session = {
      token: toHex(this.randomBytes(32)),
      origin: request.origin,
      pageNonce: request.pageNonce,
      lastSeenAt,
      pending: new Map(),
      queue: [],
      waiter: null,
    };
    this.onDiagnostic(`page paired from ${request.origin}`);
    return { sessionToken: this.session.token, expiresAt: lastSeenAt + HEARTBEAT_TIMEOUT_MS };
  }

  /**
   * Authenticated long poll. Refreshes the heartbeat, then returns the next
   * queued call, or resolves `null` when the caller's request is aborted before
   * one arrives. Rejects if the session is replaced or disconnected while held.
   */
  async poll(sessionToken: string, signal: AbortSignal): Promise<RelayToolCall | null> {
    this.sweepExpired();
    const session = this.authenticate(sessionToken);
    session.lastSeenAt = this.now();

    const superseded = session.waiter;
    session.waiter = null;
    superseded?.resolve(null);

    const queued = this.dequeue(session);
    if (queued) return queued;
    if (signal.aborted) return null;

    return new Promise<RelayToolCall | null>((resolve, reject) => {
      let detach = (): void => {};
      const waiter: PollWaiter = {
        resolve: (call) => {
          detach();
          resolve(call);
        },
        reject: (error) => {
          detach();
          reject(error);
        },
      };
      const onAbort = () => {
        if (session.waiter === waiter) session.waiter = null;
        detach();
        resolve(null);
      };
      detach = () => signal.removeEventListener("abort", onAbort);
      signal.addEventListener("abort", onAbort, { once: true });
      session.waiter = waiter;
    });
  }

  /**
   * Queues one Core 6 call for the paired page and resolves with whatever result
   * the page posts back. Rejects when no page is paired, when the page already
   * owes `MAX_PENDING_CALLS` results, when the caller aborts, on the 30 second
   * timeout, or when the session ends. A timed out call is never requeued.
   */
  async forwardToolCall(
    toolName: CoreToolName,
    input: unknown,
    signal: AbortSignal,
  ): Promise<ToolResult<unknown>> {
    this.sweepExpired();
    const session = this.session;
    if (!session) throw new RelayError("PAGE_UNAVAILABLE");
    if (session.pending.size >= MAX_PENDING_CALLS) throw new RelayError("TOO_MANY_PENDING_CALLS");
    if (signal.aborted) throw new RelayError("CALL_TIMEOUT");

    const requestId = toHex(this.randomBytes(16));
    return new Promise<ToolResult<unknown>>((resolve, reject) => {
      let detach = (): void => {};
      const call: PendingCall = {
        requestId,
        toolName,
        input,
        delivered: false,
        resolve: (result) => {
          detach();
          resolve(result);
        },
        reject: (error) => {
          detach();
          reject(error);
        },
      };
      // Caller cancellation and the relay timeout are both terminal: the call is
      // discarded so no later result can settle it and nothing is retried.
      const abandon = () => {
        this.discard(session, requestId);
        call.reject(new RelayError("CALL_TIMEOUT"));
      };
      const onAbort = () => abandon();
      const timer = setTimeout(() => {
        this.onDiagnostic(`tool call timed out: ${toolName}`);
        abandon();
      }, CALL_TIMEOUT_MS);
      detach = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      };
      signal.addEventListener("abort", onAbort, { once: true });

      session.pending.set(requestId, call);
      session.queue.push(requestId);
      this.deliverIfWaiting(session);
    });
  }

  /**
   * Settles one delivered call. An unknown, undelivered, or already settled
   * request id is refused as `UNAUTHORIZED` so a caller cannot probe which ids
   * exist. The result is handed straight to the waiting promise and not stored.
   */
  resolve(sessionToken: string, message: RelayToolResult): void {
    this.sweepExpired();
    const session = this.authenticate(sessionToken);
    const parsed = RelayToolResultSchema.safeParse(message);
    if (!parsed.success) throw new RelayError("UNAUTHORIZED");

    const call = session.pending.get(parsed.data.requestId);
    if (!call || !call.delivered) throw new RelayError("UNAUTHORIZED");

    this.discard(session, call.requestId);
    // Opaque across the relay; the stdio adapter re-validates before answering.
    call.resolve(parsed.data.result as ToolResult<unknown>);
  }

  /** Ends the session and rejects everything still in flight. */
  disconnect(sessionToken: string): void {
    const session = this.authenticate(sessionToken);
    this.destroySession(session, "disconnected by the paired page");
  }

  /** Drops an expired pair code and an expired session; safe to call on a timer. */
  sweepExpired(): void {
    const now = this.now();
    if (this.pairCode && this.pairCode.expiresAt <= now) {
      this.pairCode = null;
      this.onDiagnostic("pair code expired");
    }
    const session = this.session;
    if (session && session.lastSeenAt + HEARTBEAT_TIMEOUT_MS <= now) {
      this.destroySession(session, "heartbeat expired");
    }
  }

  private authenticate(sessionToken: string): Session {
    const session = this.session;
    if (!session || typeof sessionToken !== "string" || !safeEqual(session.token, sessionToken)) {
      throw new RelayError("UNAUTHORIZED");
    }
    return session;
  }

  private dequeue(session: Session): RelayToolCall | null {
    while (session.queue.length > 0) {
      const requestId = session.queue.shift();
      const call = requestId === undefined ? undefined : session.pending.get(requestId);
      if (!call) continue;
      call.delivered = true;
      return { requestId: call.requestId, toolName: call.toolName, input: call.input };
    }
    return null;
  }

  private deliverIfWaiting(session: Session): void {
    const waiter = session.waiter;
    if (!waiter) return;
    const call = this.dequeue(session);
    if (!call) return;
    session.waiter = null;
    waiter.resolve(call);
  }

  private discard(session: Session, requestId: string): void {
    session.pending.delete(requestId);
    const queued = session.queue.indexOf(requestId);
    if (queued !== -1) session.queue.splice(queued, 1);
  }

  private destroySession(session: Session, reason: string): void {
    if (this.session === session) this.session = null;
    const waiter = session.waiter;
    session.waiter = null;
    const abandoned = [...session.pending.values()];
    session.pending.clear();
    session.queue.length = 0;
    for (const call of abandoned) call.reject(new RelayError("SESSION_DISCONNECTED"));
    waiter?.reject(new RelayError("SESSION_DISCONNECTED"));
    this.onDiagnostic(`session closed: ${reason}`);
  }
}
