import { serveStdio, type StdioServerHandle } from "@modelcontextprotocol/server/stdio";

import { DEFAULT_RELAY_PORT } from "../../src/local-mcp/relay-protocol";
import { getCoreToolManifestHash } from "../../src/webmcp/core-tool-manifest";
import { createOpenInteriorMcpServer } from "./mcp-server";
import { allowedOriginsFromEnv, startRelayHttpServer, type RelayHttpServer } from "./relay-http";
import { REPAIRABLE_SESSION_CLOSURES, SessionRegistry, startExpirySweep } from "./session-registry";

/**
 * Process entry point for the localhost MCP companion.
 *
 * stdout belongs entirely to the MCP stdio transport: a single stray byte there
 * corrupts JSON-RPC framing for every client, so nothing in this directory ever
 * calls `console.log` or writes to `process.stdout`. Operator output - the bound
 * port, the pair code, session diagnostics - goes to stderr, which is exactly
 * where Claude Desktop, Claude Code, and Codex CLI show it.
 */

const LOG_PREFIX = "openinterior-mcp:";

/** Ports below 1024 need privileges the companion must never ask for. */
const MIN_USER_PORT = 1024;
const MAX_PORT = 65_535;

/** How long teardown is given before the process stops waiting for a stuck handle. */
const EXIT_GRACE_MS = 250;

function log(message: string): void {
  console.error(`${LOG_PREFIX} ${message}`);
}

/**
 * Set as soon as `main` can create anything worth releasing. Startup can fail
 * after the relay has bound its port or the transport has started, and exiting
 * without closing those leaves the port held and a client talking to a server
 * that will never answer.
 */
let releaseStartedResources: (() => Promise<void>) | undefined;

/**
 * `0` asks the kernel for an ephemeral port, which is what the tests use;
 * anything else must be an unprivileged port. A malformed value aborts startup
 * rather than silently falling back to the default, so a typo cannot leave the
 * relay listening somewhere the page will never look.
 */
export function parseRelayPort(value: string | undefined): number {
  const raw = value?.trim();
  if (raw === undefined || raw === "") return DEFAULT_RELAY_PORT;
  const invalid = new Error(
    `Invalid OPENINTERIOR_MCP_PORT: ${raw} (expected 0 or ${MIN_USER_PORT}-${MAX_PORT})`,
  );
  if (!/^[0-9]{1,5}$/.test(raw)) throw invalid;
  const port = Number(raw);
  if (port === 0) return 0;
  if (port < MIN_USER_PORT || port > MAX_PORT) throw invalid;
  return port;
}

async function main(): Promise<void> {
  // Explicitly initialized: `teardown` closes over all four and may run before
  // startup has filled any of them in.
  let registry: SessionRegistry | undefined = undefined;
  let relay: RelayHttpServer | undefined = undefined;
  let stdio: StdioServerHandle | undefined = undefined;
  let stopSweep: (() => void) | undefined = undefined;
  let stopping: Promise<void> | undefined = undefined;

  /**
   * Releases whatever startup has built so far. Every step is idempotent, so it
   * is safe to run again for anything that was created after a signal raced it.
   */
  const teardown = async (): Promise<void> => {
    stopSweep?.();
    registry?.shutdown();
    await relay?.close().catch((error: unknown) => {
      log(`relay close failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    await stdio?.close().catch(() => undefined);
    process.stdin.pause();
  };
  releaseStartedResources = teardown;

  const stop = (reason: string): void => {
    if (stopping) return;
    log(`shutting down (${reason})`);
    stopping = teardown();
    void stopping.then(() => {
      process.exitCode = 0;
      // Unref'd, so it never keeps the loop alive by itself; it only fires if
      // some other handle is still holding the process open after teardown.
      setTimeout(() => process.exit(0), EXIT_GRACE_MS).unref();
    });
  };

  // Installed before anything is built. Until a JS listener exists, the kernel's
  // default disposition applies and a Ctrl-C during startup would kill the
  // process outright, leaving the loopback port bound until the OS reclaims it.
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
  // The MCP client closes the transport by closing our stdin; there is nothing
  // left to serve after that, so the relay must not keep the process alive.
  process.stdin.once("end", () => stop("stdin closed"));
  process.stdin.once("close", () => stop("stdin closed"));

  const port = parseRelayPort(process.env.OPENINTERIOR_MCP_PORT);
  const allowedOrigins = allowedOriginsFromEnv(process.env.OPENINTERIOR_ALLOWED_ORIGINS);
  // Pairing is refused unless the page derives this same hash from its own copy
  // of the Core 6 manifest, so a page from a different build cannot attach.
  const manifestHash = await getCoreToolManifestHash();

  /**
   * Mints the single active code through the relay, which is also what clears
   * the failed-attempt lockout. Minting replaces any unused previous code, so
   * there is never more than one live at a time. A failure here must not break
   * whatever request produced the diagnostic, so it is reported and swallowed.
   */
  const announcePairCode = (): void => {
    if (!relay) return;
    try {
      const { code, expiresAt } = relay.issuePairCode();
      log(`pairing code ${code} expires ${new Date(expiresAt).toISOString()}`);
      log('enter it in OpenInterior\'s "Pairing code" field, then press "Connect Claude"');
    } catch (error) {
      log(`could not issue a pair code: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  registry = new SessionRegistry({
    manifestHash,
    allowedOrigins,
    onDiagnostic: (message) => {
      log(message);
      // A code is single use, so a page that disconnects or times out spends the
      // only way back in. Replacing it here is what lets an operator re-pair
      // without restarting the companion and its MCP client.
      if (REPAIRABLE_SESSION_CLOSURES.has(message)) announcePairCode();
    },
  });

  // Heartbeat expiry is otherwise only noticed when a client next touches the
  // registry, so a page lost with its tab would leave the process believing it
  // is still paired and the replacement code unprinted. Unref'd, and stopped in
  // teardown.
  stopSweep = startExpirySweep(registry);

  relay = await startRelayHttpServer({
    registry,
    port,
    allowedOrigins,
    onDiagnostic: log,
    // A retired code would otherwise strand the operator with no way to pair;
    // minting the replacement here is also what clears the attempt counter.
    onPairLockout: announcePairCode,
  });
  if (stopping) return teardown();

  log(`relay listening on http://${relay.address}:${relay.port}`);
  log(`allowed page origins: ${[...allowedOrigins].join(", ")}`);
  announcePairCode();

  stdio = serveStdio(() => createOpenInteriorMcpServer(registry as SessionRegistry), {
    onerror: (error) => log(`stdio transport error: ${error.message}`),
  });
  if (stopping) return teardown();
}

void main().catch(async (error: unknown) => {
  log(`failed to start: ${error instanceof Error ? error.message : String(error)}`);
  await releaseStartedResources?.().catch(() => undefined);
  process.exitCode = 1;
});
