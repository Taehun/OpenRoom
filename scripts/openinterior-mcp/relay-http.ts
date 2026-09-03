import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  DEFAULT_ALLOWED_ORIGINS,
  MAX_BODY_BYTES,
  PairRequestSchema,
  RelayError,
  RelayToolResultSchema,
  isRelayError,
  type RelayErrorCode,
} from "../../src/local-mcp/relay-protocol";
import type { SessionRegistry } from "./session-registry";

/**
 * Loopback HTTP boundary in front of the `SessionRegistry`. Everything that can
 * be decided without touching session state - origin membership, CORS and
 * private network preflights, request size, content type, bearer credentials,
 * pair attempt throttling - is decided here, so the registry only ever sees
 * well formed, authenticated calls from an exactly allowed origin.
 *
 * The server binds `127.0.0.1` and nothing else. It never reflects an origin it
 * has not matched against the allow set, never returns a pair code, session
 * token, manifest hash, or stack trace in an error body, and answers every
 * refusal with the same small normalized `RelayErrorBody`.
 */

/**
 * How long a `GET /v1/calls` waits server side before answering 204. It sits
 * below `HEARTBEAT_TIMEOUT_MS` so a page that keeps polling always re-arms its
 * heartbeat with room to spare, even when no tool call ever arrives.
 */
export const LONG_POLL_TIMEOUT_MS = 25_000;

/**
 * Failed pair attempts tolerated per issued code. A six digit code has a
 * million values, so five guesses leave a brute force attempt at odds no better
 * than one in two hundred thousand before the code is retired.
 */
export const MAX_PAIR_ATTEMPTS = 5;

/** Longest a `close()` waits for in-flight responses before forcing sockets shut. */
const DRAIN_GRACE_MS = 250;

/** Preflight results may be cached by the browser for ten minutes. */
const PREFLIGHT_MAX_AGE_SECONDS = 600;

/** Same shape the wire contract accepts, so an unusable origin cannot be allowed. */
const ORIGIN_PATTERN = /^https?:\/\/[a-z0-9.-]{1,120}(?::[0-9]{1,5})?$/;

/** Path segment shape of a correlated request id, matching the relay contract. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

const STATUS_FOR_CODE: Readonly<Record<RelayErrorCode, number>> = {
  PAIR_REJECTED: 403,
  UNAUTHORIZED: 401,
  TOO_MANY_PENDING_CALLS: 429,
  CALL_TIMEOUT: 504,
  SESSION_DISCONNECTED: 410,
  PAGE_UNAVAILABLE: 503,
  UNKNOWN_TOOL: 404,
};

type RouteName = "pair" | "calls" | "result" | "session";

interface Route {
  readonly name: RouteName;
  readonly method: "GET" | "POST" | "DELETE";
  /** Exactly the request headers this route needs a browser to be allowed to send. */
  readonly requestHeaders: string;
  /** Present only on `/v1/results/:requestId`. */
  readonly requestId?: string;
}

export interface RelayHttpServerOptions {
  registry: SessionRegistry;
  /** Loopback port to bind; `0` lets the kernel choose one. */
  port: number;
  /** Exact page origins permitted to reach any route. */
  allowedOrigins: ReadonlySet<string>;
  /** Server side long poll deadline; overridden only to keep tests quick. */
  longPollMs?: number;
  /** Failed pair attempts tolerated before the active code is retired. */
  maxPairAttempts?: number;
  /** Mints a fresh pair code; defaults to the registry's own generator. */
  issuePairCode?: () => { code: string; expiresAt: number };
  /** Operator facing log sink; never receives secrets or tool payloads. */
  onDiagnostic?: (message: string) => void;
}

export interface RelayHttpServer {
  /** Port actually bound, resolved after listening on port `0`. */
  readonly port: number;
  /** Bound interface; always `127.0.0.1`. */
  readonly address: string;
  /**
   * Issues the next pair code and clears the failed attempt counter. The owning
   * process must mint codes through here rather than through the registry, so a
   * retired code can never be revived by a stale counter.
   */
  issuePairCode(): { code: string; expiresAt: number };
  /**
   * Terminal shutdown: stops accepting, ends every long poll, waits for the
   * socket to close, and shuts the registry down. Idempotent; the relay and its
   * registry are both unusable afterwards.
   */
  close(): Promise<void>;
}

/**
 * Parses the operator supplied allow list into an exact origin set. Entries must
 * be bare `http`/`https` origins: no wildcard, no credentials, no path, query,
 * or fragment, and no opaque origin. Anything else aborts process startup rather
 * than silently widening what may reach the relay.
 */
export function allowedOriginsFromEnv(value: string | undefined): ReadonlySet<string> {
  const origins = new Set(DEFAULT_ALLOWED_ORIGINS);
  const configured = value?.trim();
  if (!configured) return origins;

  for (const entry of configured.split(",")) {
    const candidate = entry.trim();
    let url: URL | null = null;
    try {
      url = new URL(candidate);
    } catch {
      url = null;
    }
    if (
      candidate.length === 0 ||
      url === null ||
      !ORIGIN_PATTERN.test(candidate) ||
      url.origin !== candidate ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/"
    ) {
      throw new Error(`Invalid OPENINTERIOR_ALLOWED_ORIGINS entry: ${candidate}`);
    }
    origins.add(url.origin);
  }
  return origins;
}

function resolveRoute(pathname: string): Route | null {
  if (pathname === "/v1/pair") return { name: "pair", method: "POST", requestHeaders: "Content-Type" };
  if (pathname === "/v1/calls") return { name: "calls", method: "GET", requestHeaders: "Authorization" };
  if (pathname === "/v1/session") return { name: "session", method: "DELETE", requestHeaders: "Authorization" };

  const prefix = "/v1/results/";
  if (pathname.startsWith(prefix)) {
    const requestId = pathname.slice(prefix.length);
    if (!REQUEST_ID_PATTERN.test(requestId)) return null;
    return { name: "result", method: "POST", requestHeaders: "Authorization, Content-Type", requestId };
  }
  return null;
}

/** `application/json`, with or without parameters; nothing else is accepted. */
function isJsonContentType(value: string | undefined): boolean {
  if (typeof value !== "string") return false;
  const [mediaType] = value.split(";");
  return mediaType.trim().toLowerCase() === "application/json";
}

/**
 * Extracts a `Bearer` credential. Query strings and cookies are deliberately not
 * consulted: a token in a URL leaks through history, logs, and `Referer`.
 */
function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const separator = header.indexOf(" ");
  if (separator === -1) return null;
  if (header.slice(0, separator).toLowerCase() !== "bearer") return null;
  const token = header.slice(separator + 1).trim();
  return token.length > 0 ? token : null;
}

/** Length checked first because `timingSafeEqual` throws on a length mismatch. */
function constantTimeEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}

type BodyOutcome = { status: "ok"; raw: string } | { status: "too_large" } | { status: "aborted" };

/**
 * Buffers at most `MAX_BODY_BYTES`, bailing out on the first byte past the
 * ceiling so an oversized upload is never retained. The caller answers 413 and
 * closes the connection; nothing past the ceiling is parsed.
 */
function readBody(req: IncomingMessage): Promise<BodyOutcome> {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return Promise.resolve({ status: "too_large" });
  }

  return new Promise<BodyOutcome>((resolve) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;

    const finish = (outcome: BodyOutcome): void => {
      if (settled) return;
      settled = true;
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      req.off("aborted", onError);
      resolve(outcome);
    };
    const onData = (chunk: Buffer): void => {
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        req.pause();
        finish({ status: "too_large" });
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = (): void => finish({ status: "ok", raw: Buffer.concat(chunks).toString("utf8") });
    const onError = (): void => finish({ status: "aborted" });

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("aborted", onError);
  });
}

export async function startRelayHttpServer(options: RelayHttpServerOptions): Promise<RelayHttpServer> {
  const { registry, allowedOrigins } = options;
  const longPollMs = options.longPollMs ?? LONG_POLL_TIMEOUT_MS;
  const maxPairAttempts = options.maxPairAttempts ?? MAX_PAIR_ATTEMPTS;
  const issue = options.issuePairCode ?? (() => registry.issuePairCode());
  const onDiagnostic = options.onDiagnostic ?? ((): void => {});

  /**
   * Cached copy of the token minted by the last successful pair. It is only a
   * cheap constant time gate in front of the registry, which stays the sole
   * authority: a token that survives this check is still re-authenticated there,
   * so an expired or replaced session is refused all the same.
   */
  let activeToken: string | null = null;
  let failedPairAttempts = 0;
  /** Non-null from the first `close()` call onwards; also makes `close()` idempotent. */
  let closing: Promise<void> | null = null;

  const activePolls = new Set<AbortController>();
  const inFlight = new Set<ServerResponse>();
  const drainWaiters = new Set<() => void>();

  function noteFailedPairAttempt(): void {
    if (failedPairAttempts >= maxPairAttempts) return;
    failedPairAttempts += 1;
    if (failedPairAttempts >= maxPairAttempts) {
      // One line, no code and no origin: the operator only needs to know that a
      // fresh code must be issued before the page can pair again.
      onDiagnostic("pair code invalidated after too many failed attempts");
    }
  }

  class Responder {
    constructor(
      private readonly req: IncomingMessage,
      private readonly res: ServerResponse,
      private readonly corsOrigin: string | null,
    ) {}

    private begin(status: number, closeConnection: boolean): boolean {
      if (this.res.headersSent || this.res.writableEnded || this.res.destroyed) return false;
      this.res.statusCode = status;
      this.res.setHeader("Cache-Control", "no-store");
      this.res.setHeader("X-Content-Type-Options", "nosniff");
      this.res.setHeader("Vary", "Origin");
      if (this.corsOrigin !== null) this.res.setHeader("Access-Control-Allow-Origin", this.corsOrigin);
      if (closeConnection) this.res.setHeader("Connection", "close");
      return true;
    }

    /** Drains any unread request body so the connection can be reused cleanly. */
    private end(payload: string | null): void {
      this.res.end(payload ?? undefined);
      if (!this.req.readableEnded && !this.req.destroyed) this.req.resume();
    }

    json(status: number, payload: unknown): void {
      if (!this.begin(status, false)) return;
      this.res.setHeader("Content-Type", "application/json");
      this.end(JSON.stringify(payload));
    }

    empty(status: number, extraHeaders: Readonly<Record<string, string>> = {}): void {
      if (!this.begin(status, false)) return;
      for (const [name, value] of Object.entries(extraHeaders)) this.res.setHeader(name, value);
      this.end(null);
    }

    /** Every refusal is the same normalized body: code, code as message, retryable. */
    error(status: number, code: RelayErrorCode, extraHeaders: Readonly<Record<string, string>> = {}): void {
      if (!this.begin(status, false)) return;
      this.res.setHeader("Content-Type", "application/json");
      for (const [name, value] of Object.entries(extraHeaders)) this.res.setHeader(name, value);
      this.end(JSON.stringify(new RelayError(code).toBody()));
    }

    /** 413 alone closes the connection rather than draining an oversized upload. */
    tooLarge(code: RelayErrorCode): void {
      if (!this.begin(413, true)) return;
      this.res.setHeader("Content-Type", "application/json");
      this.res.end(JSON.stringify(new RelayError(code).toBody()));
      this.res.once("finish", () => {
        if (!this.req.destroyed) this.req.destroy();
      });
    }

    /** Maps a thrown error onto a status without ever exposing its stack. */
    fromError(error: unknown, fallback: RelayErrorCode): void {
      if (isRelayError(error)) {
        this.error(STATUS_FOR_CODE[error.code], error.code);
        return;
      }
      this.error(STATUS_FOR_CODE[fallback], fallback);
    }
  }

  /** Throws `UNAUTHORIZED` unless the request carries the current bearer token. */
  function authenticate(req: IncomingMessage): string {
    const presented = bearerToken(req);
    if (presented === null || activeToken === null || !constantTimeEquals(activeToken, presented)) {
      throw new RelayError("UNAUTHORIZED");
    }
    return presented;
  }

  async function handlePair(req: IncomingMessage, respond: Responder, headerOrigin: string): Promise<void> {
    if (!isJsonContentType(req.headers["content-type"])) {
      respond.error(415, "PAIR_REJECTED");
      return;
    }
    const body = await readBody(req);
    if (body.status === "aborted") return;
    if (body.status === "too_large") {
      respond.tooLarge("PAIR_REJECTED");
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body.raw);
    } catch {
      respond.error(400, "PAIR_REJECTED");
      return;
    }

    // A retired code is refused before the registry sees it, with the identical
    // response a wrong code would get, so lockout is not externally observable.
    if (failedPairAttempts >= maxPairAttempts) {
      respond.error(403, "PAIR_REJECTED");
      return;
    }

    const parsed = PairRequestSchema.safeParse(payload);
    if (!parsed.success || parsed.data.origin !== headerOrigin) {
      noteFailedPairAttempt();
      respond.error(403, "PAIR_REJECTED");
      return;
    }

    try {
      const paired = registry.pair(parsed.data);
      failedPairAttempts = 0;
      activeToken = paired.sessionToken;
      respond.json(200, paired);
    } catch (error) {
      noteFailedPairAttempt();
      respond.fromError(error, "PAIR_REJECTED");
    }
  }

  async function handleCalls(req: IncomingMessage, res: ServerResponse, respond: Responder): Promise<void> {
    const token = authenticate(req);
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    const deadline = setTimeout(abort, longPollMs);

    activePolls.add(controller);
    // A held poll is proof of life to the registry, so an abandoned one would
    // keep the session alive forever. Both streams emit `close` when the client
    // hangs up, and neither fires early on a bodyless GET.
    res.on("close", abort);
    req.on("close", abort);
    // A poll that slips in on a keep-alive connection during shutdown must not
    // wait out the deadline; it is answered 204 straight away.
    if (closing !== null) abort();
    try {
      // `poll` refreshes the heartbeat before it waits and again when it ends,
      // so even a 204 keeps the session alive; the abort is what turns the
      // deadline, a client hang-up, or shutdown into that 204.
      const call = await registry.poll(token, controller.signal);
      if (call === null) respond.empty(204);
      else respond.json(200, call);
    } finally {
      clearTimeout(deadline);
      activePolls.delete(controller);
      res.off("close", abort);
      req.off("close", abort);
    }
  }

  async function handleResult(req: IncomingMessage, respond: Responder, requestId: string): Promise<void> {
    const token = authenticate(req);
    if (!isJsonContentType(req.headers["content-type"])) {
      respond.error(415, "UNAUTHORIZED");
      return;
    }
    const body = await readBody(req);
    if (body.status === "aborted") return;
    if (body.status === "too_large") {
      respond.tooLarge("UNAUTHORIZED");
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body.raw);
    } catch {
      respond.error(400, "UNAUTHORIZED");
      return;
    }

    const parsed = RelayToolResultSchema.safeParse(payload);
    if (!parsed.success || parsed.data.requestId !== requestId) {
      respond.error(400, "UNAUTHORIZED");
      return;
    }

    registry.resolve(token, parsed.data);
    respond.empty(204);
  }

  function handleSession(req: IncomingMessage, respond: Responder): void {
    const token = authenticate(req);
    registry.disconnect(token);
    activeToken = null;
    respond.empty(204);
  }

  function handlePreflight(req: IncomingMessage, respond: Responder, route: Route): void {
    const headers: Record<string, string> = {
      "Access-Control-Allow-Methods": `${route.method}, OPTIONS`,
      "Access-Control-Allow-Headers": route.requestHeaders,
      "Access-Control-Max-Age": String(PREFLIGHT_MAX_AGE_SECONDS),
    };
    // Private Network Access is granted only to a preflight that asks for it,
    // and only from an origin already proven to be in the allow set.
    if (req.headers["access-control-request-private-network"] === "true") {
      headers["Access-Control-Allow-Private-Network"] = "true";
    }
    respond.empty(204, headers);
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    const headerOrigin = typeof req.headers.origin === "string" ? req.headers.origin : null;
    const allowed = headerOrigin !== null && allowedOrigins.has(headerOrigin);
    const matched = resolveRoute(pathname);

    // Nothing permissive is emitted until exact allow set membership is proven.
    if (!allowed) {
      const anonymous = new Responder(req, res, null);
      anonymous.error(403, pathname === "/v1/pair" ? "PAIR_REJECTED" : "UNAUTHORIZED");
      return;
    }

    const respond = new Responder(req, res, headerOrigin);
    if (matched === null) {
      respond.error(404, "UNAUTHORIZED");
      return;
    }
    if (req.method === "OPTIONS") {
      handlePreflight(req, respond, matched);
      return;
    }
    if (req.method !== matched.method) {
      respond.error(405, "UNAUTHORIZED", { Allow: `${matched.method}, OPTIONS` });
      return;
    }

    try {
      switch (matched.name) {
        case "pair":
          await handlePair(req, respond, headerOrigin);
          return;
        case "calls":
          await handleCalls(req, res, respond);
          return;
        case "result":
          await handleResult(req, respond, matched.requestId ?? "");
          return;
        case "session":
          handleSession(req, respond);
          return;
      }
    } catch (error) {
      respond.fromError(error, "PAGE_UNAVAILABLE");
    }
  }

  const server = createServer((req, res) => {
    inFlight.add(res);
    res.on("close", () => {
      inFlight.delete(res);
      if (inFlight.size === 0) for (const waiter of [...drainWaiters]) waiter();
    });
    void route(req, res).catch(() => {
      // `route` already normalizes every failure; this only guards a response
      // that died mid-write, where nothing further can or should be sent.
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(options.port, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Relay HTTP server did not bind a loopback TCP port");
  }

  function whenDrained(): Promise<void> {
    if (inFlight.size === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const finish = (): void => {
        clearTimeout(timer);
        drainWaiters.delete(finish);
        resolve();
      };
      const timer = setTimeout(finish, DRAIN_GRACE_MS);
      timer.unref();
      drainWaiters.add(finish);
    });
  }

  return {
    port: address.port,
    address: address.address,
    issuePairCode() {
      failedPairAttempts = 0;
      return issue();
    },
    close() {
      if (closing !== null) return closing;
      closing = (async () => {
        const closed = new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
        for (const controller of activePolls) controller.abort();
        await whenDrained();
        // Terminal: the registry is unreachable once the socket is gone, so it
        // is torn down here rather than left holding calls until they time out.
        registry.shutdown();
        activeToken = null;
        server.closeAllConnections();
        await closed;
      })();
      return closing;
    },
  };
}
