// @vitest-environment node
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import type { Stream } from "node:stream";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { relayCallFailure } from "../../src/local-mcp/page-relay-client";
import {
  LOCKOUT_REISSUE_BASE_DELAY_MS,
  MAX_LOCKOUT_REISSUES,
} from "../../scripts/openinterior-mcp/pair-code-announcer";
import { MAX_PAIR_ATTEMPTS } from "../../scripts/openinterior-mcp/relay-http";
import {
  CORE_TOOL_MANIFEST,
  getCoreToolManifestHash,
} from "../../src/webmcp/core-tool-manifest";

/**
 * End-to-end proof that the companion is a real MCP server: an official
 * `@modelcontextprotocol/client` drives a real spawned `pnpm mcp:openinterior`
 * process over stdio, while a fake browser page pairs and answers tool calls
 * over the actual loopback HTTP relay. Nothing here is mocked - not the server,
 * not the transport, not the relay - so a regression in framing, stdout
 * discipline, pairing, forwarding, or teardown fails this file.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Deliberately not one of `DEFAULT_ALLOWED_ORIGINS`, so the env parser is exercised. */
const PAGE_ORIGIN = "http://127.0.0.1:4173";
const FOREIGN_ORIGIN = "http://localhost:5173";

const CORE_TOOL_NAMES = CORE_TOOL_MANIFEST.map((entry) => entry.name);

/** The companion prints its port and pair code here; stdout stays MCP-only. */
const PORT_LINE = /relay listening on http:\/\/127\.0\.0\.1:(\d{1,5})\b/;
const PAIR_CODE_LINE = /pairing code (\d{6})\b/;

const STARTUP_TIMEOUT_MS = 20_000;

interface Startup {
  port: number;
  code: string;
}

/** Only string-valued entries survive, because `spawn` rejects anything else. */
function inheritedEnv(overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  return { ...env, ...overrides };
}

/**
 * Reads the operator banner off stderr. Every line the companion writes must
 * arrive here; a byte of it on stdout would corrupt the MCP stream instead.
 */
function readStartup(stderr: Stream, log: string[]): Promise<Startup> {
  return new Promise<Startup>((resolve, reject) => {
    const timer = setTimeout(() => {
      finish();
      reject(new Error(`companion did not announce itself:\n${log.join("")}`));
    }, STARTUP_TIMEOUT_MS);
    const onData = (chunk: Buffer | string): void => {
      log.push(String(chunk));
      const joined = log.join("");
      const port = PORT_LINE.exec(joined);
      const code = PAIR_CODE_LINE.exec(joined);
      if (!port || !code) return;
      finish();
      resolve({ port: Number(port[1]), code: code[1] });
    };
    const finish = (): void => {
      clearTimeout(timer);
      stderr.off("data", onData);
      // Keep draining so a full pipe can never stall the child.
      stderr.on("data", (chunk: Buffer | string) => log.push(String(chunk)));
    };
    stderr.on("data", onData);
  });
}

/** URL-safe high-entropy nonce in the shape `PairRequestSchema` accepts. */
function pageNonce(): string {
  return randomBytes(32).toString("base64url");
}

interface Delivered {
  requestId: string;
  toolName: string;
  input: unknown;
}

/**
 * A browser page, minus the browser: it pairs over real HTTP with an `Origin`
 * header exactly like `page-relay-client.ts` sends, long-polls for calls, and
 * posts back whatever `respond` produces.
 */
class FakePage {
  readonly delivered: Delivered[] = [];
  respond: (call: Delivered) => unknown = () => ({
    content: [{ type: "text", text: "unconfigured" }],
    structuredContent: { ok: false },
    isError: true,
  });

  #token: string | null = null;
  #stopped = false;
  #poll: AbortController | null = null;
  #loop: Promise<void> = Promise.resolve();

  constructor(private readonly baseUrl: string) {}

  get sessionToken(): string {
    if (this.#token === null) throw new Error("page is not paired");
    return this.#token;
  }

  async pair(body: Record<string, unknown>, origin = PAGE_ORIGIN): Promise<Response> {
    return fetch(`${this.baseUrl}/v1/pair`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(body),
    });
  }

  async connect(code: string, manifestHash: string): Promise<void> {
    const response = await this.pair({
      code,
      origin: PAGE_ORIGIN,
      manifestHash,
      pageNonce: pageNonce(),
    });
    if (!response.ok) throw new Error(`pair failed: ${response.status} ${await response.text()}`);
    const paired = (await response.json()) as { sessionToken: string };
    this.#token = paired.sessionToken;
    this.#loop = this.#run();
  }

  async disconnect(): Promise<number> {
    const response = await fetch(`${this.baseUrl}/v1/session`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${this.sessionToken}`, origin: PAGE_ORIGIN },
    });
    return response.status;
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#poll?.abort();
    await this.#loop.catch(() => undefined);
  }

  /** Raw poll, used to prove a stale token is refused after a disconnect. */
  async pollOnce(token = this.#token ?? ""): Promise<number> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_000);
    try {
      const response = await fetch(`${this.baseUrl}/v1/calls`, {
        headers: { authorization: `Bearer ${token}`, origin: PAGE_ORIGIN },
        signal: controller.signal,
      });
      return response.status;
    } finally {
      clearTimeout(timer);
    }
  }

  async #run(): Promise<void> {
    while (!this.#stopped) {
      const controller = new AbortController();
      this.#poll = controller;
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/v1/calls`, {
          headers: { authorization: `Bearer ${this.sessionToken}`, origin: PAGE_ORIGIN },
          signal: controller.signal,
        });
      } catch {
        return;
      }
      if (response.status === 204) continue;
      if (!response.ok) return;

      const call = (await response.json()) as Delivered;
      this.delivered.push(call);
      await fetch(`${this.baseUrl}/v1/results/${call.requestId}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.sessionToken}`,
          origin: PAGE_ORIGIN,
        },
        body: JSON.stringify({ requestId: call.requestId, result: this.respond(call) }),
      }).catch(() => undefined);
    }
  }
}

function sceneResult(revision: number) {
  return {
    content: [{ type: "text", text: "Tool completed successfully." }],
    structuredContent: {
      ok: true,
      tool: "get_scene",
      sceneRevision: revision,
      stateVersion: revision,
      data: { revision, objects: [{ id: "table_01", source: "product" }] },
    },
  };
}

/** Every pair code the companion has announced, oldest first. */
function pairCodes(log: string[]): string[] {
  return [...log.join("").matchAll(/pairing code (\d{6})\b/g)].map((match) => match[1]);
}

/** Waits for the nth code to be printed; stderr arrives asynchronously. */
async function waitForPairCode(log: string[], index: number): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const codes = pairCodes(log);
    if (codes.length >= index) return codes[index - 1];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`only ${pairCodes(log).length} pair codes were printed:\n${log.join("")}`);
}

function textOf(result: { content?: unknown }): string {
  const blocks = Array.isArray(result.content) ? result.content : [];
  return blocks
    .map((block) => (typeof block === "object" && block !== null && "text" in block ? String(block.text) : ""))
    .join(" ");
}

describe("local MCP companion", () => {
  let transport: StdioClientTransport;
  let client: Client;
  let page: FakePage;
  let rePaired: FakePage | undefined;
  let startup: Startup;
  let manifestHash: string;
  let baseUrl: string;
  const stderrLog: string[] = [];
  const transportErrors: Error[] = [];

  beforeAll(async () => {
    manifestHash = await getCoreToolManifestHash();
    transport = new StdioClientTransport({
      command: "pnpm",
      args: ["--silent", "mcp:openinterior"],
      cwd: REPO_ROOT,
      env: inheritedEnv({
        OPENINTERIOR_MCP_PORT: "0",
        OPENINTERIOR_ALLOWED_ORIGINS: PAGE_ORIGIN,
      }),
      stderr: "pipe",
    });
    transport.onerror = (error) => transportErrors.push(error);

    const stderr = transport.stderr;
    if (stderr === null) throw new Error("stderr was not piped");
    const announced = readStartup(stderr, stderrLog);

    client = new Client({ name: "openinterior-integration-test", version: "1.0.0" });
    await client.connect(transport);
    startup = await announced;
    baseUrl = `http://127.0.0.1:${startup.port}`;
    page = new FakePage(baseUrl);
  }, 40_000);

  afterAll(async () => {
    await page?.stop();
    await rePaired?.stop();
    await client?.close();
  }, 20_000);

  it("binds an ephemeral loopback port and prints one six digit code", () => {
    expect(startup.port).toBeGreaterThan(0);
    expect(startup.code).toMatch(/^\d{6}$/);
    expect(stderrLog.join("")).toContain("127.0.0.1");
  });

  it("lists exactly the Core 6 with the manifest's descriptions and schemas", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(CORE_TOOL_NAMES);
    for (const entry of CORE_TOOL_MANIFEST) {
      const tool = tools.find((candidate) => candidate.name === entry.name);
      expect(tool?.description).toBe(entry.description);
      expect(tool?.inputSchema).toEqual(entry.inputSchema);
      // `untrustedContentHint` is not part of the MCP `ToolAnnotations` schema,
      // so it does not survive a real client's `tools/list` parse. The manifest
      // keeps it for the in-page WebMCP path; only `readOnlyHint` crosses here.
      expect(tool?.annotations).toEqual({ readOnlyHint: entry.annotations.readOnlyHint });
      expect(tool?.annotations).not.toHaveProperty("untrustedContentHint");
    }
  });

  it("fails a call with PAGE_UNAVAILABLE before a page is paired, without hanging", async () => {
    const started = Date.now();
    const result = await client.callTool({ name: "get_scene", arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("PAGE_UNAVAILABLE");
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("refuses to pair on a foreign origin, a wrong code, or a wrong manifest hash", async () => {
    const foreign = await page.pair(
      { code: startup.code, origin: FOREIGN_ORIGIN, manifestHash, pageNonce: pageNonce() },
      FOREIGN_ORIGIN,
    );
    expect(foreign.status).toBe(403);

    const wrongCode = await page.pair({
      code: startup.code === "000000" ? "111111" : "000000",
      origin: PAGE_ORIGIN,
      manifestHash,
      pageNonce: pageNonce(),
    });
    expect(wrongCode.status).toBe(403);

    const wrongHash = await page.pair({
      code: startup.code,
      origin: PAGE_ORIGIN,
      manifestHash: "0".repeat(64),
      pageNonce: pageNonce(),
    });
    expect(wrongHash.status).toBe(403);

    // No refusal body may name the reason, the code, or a token.
    for (const response of [foreign, wrongCode, wrongHash]) {
      // `Response.json()` is consumed once; each response above is still unread.
      expect(await response.json()).toEqual({
        code: "PAIR_REJECTED",
        message: "PAIR_REJECTED",
        retryable: false,
      });
    }

    const stillUnpaired = await client.callTool({ name: "get_scene", arguments: {} });
    expect(textOf(stillUnpaired)).toContain("PAGE_UNAVAILABLE");
  });

  it("round-trips a paired get_scene result unchanged", async () => {
    await page.connect(startup.code, manifestHash);
    const expected = sceneResult(2);
    page.respond = () => expected;

    const result = await client.callTool({ name: "get_scene", arguments: {} });
    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual(expected.content);
    expect(result.structuredContent).toEqual(expected.structuredContent);
    expect(page.delivered.at(-1)?.toolName).toBe("get_scene");
  });

  it("preserves a page reported tool failure, including isError", async () => {
    const failure = {
      content: [{ type: "text", text: "Scene revision conflict." }],
      structuredContent: {
        ok: false,
        tool: "move_object",
        sceneRevision: 2,
        stateVersion: 2,
        error: { code: "SCENE_REVISION_CONFLICT", message: "stale", retryable: true, latestRevision: 2 },
      },
      isError: true,
    };
    page.respond = () => failure;

    const result = await client.callTool({
      name: "move_object",
      arguments: {
        objectId: "lamp_01",
        position: { x: 0, z: 0 },
        expectedRevision: 1,
        expectedStateVersion: 1,
      },
    });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual(failure.content);
    expect(result.structuredContent).toEqual(failure.structuredContent);
  });

  it("forwards a relay level failure that carries no revision fields", async () => {
    // What the page returns for a name or a request id no Core 6 descriptor
    // owns. It is shaped like a ToolFailure but omits `sceneRevision` and
    // `stateVersion`, so the companion's result check must not demand them.
    const failure = relayCallFailure("get_selection", "DUPLICATE_REQUEST", "Request already executed.");
    page.respond = () => failure;

    const result = await client.callTool({ name: "get_selection", arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual(failure.content);
    expect(result.structuredContent).toEqual(failure.structuredContent);
    expect(result.structuredContent).not.toHaveProperty("sceneRevision");
    expect(result.structuredContent).not.toHaveProperty("stateVersion");
  });

  it("turns one move_object call into exactly one request id and one page execution", async () => {
    page.respond = (call) => ({
      content: [{ type: "text", text: "Tool completed successfully." }],
      structuredContent: {
        ok: true,
        tool: call.toolName,
        sceneRevision: 3,
        stateVersion: 3,
        data: { requestId: call.requestId },
      },
    });
    const before = page.delivered.length;

    const result = await client.callTool({
      name: "move_object",
      arguments: {
        objectId: "lamp_01",
        position: { x: 1.5, z: -0.5 },
        expectedRevision: 2,
        expectedStateVersion: 2,
      },
    });

    const executed = page.delivered.slice(before);
    expect(executed).toHaveLength(1);
    expect(executed[0]?.toolName).toBe("move_object");
    expect(executed[0]?.input).toEqual({
      objectId: "lamp_01",
      position: { x: 1.5, z: -0.5 },
      expectedRevision: 2,
      expectedStateVersion: 2,
    });
    expect(new Set(page.delivered.map((call) => call.requestId)).size).toBe(page.delivered.length);
    expect(result.structuredContent).toMatchObject({
      data: { requestId: executed[0]?.requestId },
    });
  });

  it("completes several calls with no stdout parse noise", async () => {
    page.respond = () => sceneResult(3);
    for (let index = 0; index < 3; index += 1) {
      const result = await client.callTool({ name: "get_scene", arguments: {} });
      expect(result.isError).toBeUndefined();
    }
    expect(transportErrors).toEqual([]);
  });

  it("fails the next call after the page disconnects and never replays it", async () => {
    const staleToken = page.sessionToken;
    expect(await page.disconnect()).toBe(204);
    await page.stop();
    const executedBeforeFailure = page.delivered.length;

    const result = await client.callTool({
      name: "move_object",
      arguments: {
        objectId: "lamp_01",
        position: { x: -2, z: 2 },
        expectedRevision: 3,
        expectedStateVersion: 3,
      },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("PAGE_UNAVAILABLE");
    // The mutation was never handed to a page, and the retired token cannot
    // come back to collect it.
    expect(page.delivered).toHaveLength(executedBeforeFailure);
    expect(await page.pollOnce(staleToken)).toBe(401);
  });

  it("issues a fresh code when the page disconnects, so a new page can pair", async () => {
    expect(pairCodes(stderrLog)[0]).toBe(startup.code);
    // Losing a page must not mean restarting the companion: the disconnect the
    // previous test performed has to leave a usable code behind.
    const reissued = await waitForPairCode(stderrLog, 2);

    rePaired = new FakePage(baseUrl);
    // The startup code was spent by the first pairing and stays refused.
    expect((await rePaired.pair({
      code: startup.code,
      origin: PAGE_ORIGIN,
      manifestHash,
      pageNonce: pageNonce(),
    })).status).toBe(403);

    await rePaired.connect(reissued, manifestHash);
    const expected = sceneResult(4);
    rePaired.respond = () => expected;

    const result = await client.callTool({ name: "get_scene", arguments: {} });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(expected.structuredContent);
    expect(rePaired.delivered.at(-1)?.toolName).toBe("get_scene");
  }, 15_000);

  it("exits when the client closes the transport", async () => {
    const pid = transport.pid;
    expect(pid).not.toBeNull();
    await client.close();

    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        process.kill(pid as number, 0);
      } catch {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`companion process ${pid} was still alive after the transport closed`);
  }, 15_000);
});

describe("pair code lockout", () => {
  /**
   * Spawns a companion on an ephemeral port and hands back its stderr log, the
   * fake page, and a helper that burns the whole attempt budget against the
   * live code. Callers must call `stop()`; nothing here may outlive the test.
   */
  async function startLockoutHarness(): Promise<{
    log: string[];
    page: FakePage;
    burnAttempts: (liveCode: string) => Promise<void>;
    stop: () => Promise<void>;
  }> {
    const child: ChildProcess = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/openinterior-mcp/server.ts"],
      {
        cwd: REPO_ROOT,
        env: inheritedEnv({
          OPENINTERIOR_MCP_PORT: "0",
          OPENINTERIOR_ALLOWED_ORIGINS: PAGE_ORIGIN,
        }) as NodeJS.ProcessEnv,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const log: string[] = [];
    const started = readStartup(child.stderr as unknown as Stream, log);
    const stop = async (): Promise<void> => {
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill("SIGINT");
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3_000))]);
      if (child.exitCode === null) child.kill("SIGKILL");
    };

    try {
      const { port } = await started;
      const manifestHash = await getCoreToolManifestHash();
      const page = new FakePage(`http://127.0.0.1:${port}`);
      const burnAttempts = async (liveCode: string): Promise<void> => {
        for (let attempt = 0; attempt < MAX_PAIR_ATTEMPTS; attempt += 1) {
          const guess = String(attempt).repeat(6);
          const response = await page.pair({
            code: guess === liveCode ? "999999" : guess,
            origin: PAGE_ORIGIN,
            manifestHash,
            pageNonce: pageNonce(),
          });
          expect(response.status).toBe(403);
        }
      };
      return { log, page, burnAttempts, stop };
    } catch (error) {
      await stop();
      throw error;
    }
  }

  it("makes each consecutive lockout wait longer for its replacement", async () => {
    const { log, burnAttempts, stop } = await startLockoutHarness();

    try {
      const first = await waitForPairCode(log, 1);
      await burnAttempts(first);
      // The first replacement is delayed too, so guessing can never run at the
      // speed of the network.
      await new Promise((resolve) => setTimeout(resolve, LOCKOUT_REISSUE_BASE_DELAY_MS / 2));
      expect(pairCodes(log)).toHaveLength(1);

      const second = await waitForPairCode(log, 2);
      expect(second).not.toBe(first);

      await burnAttempts(second);
      const lockedOutAt = Date.now();
      // Twice the first delay: a replacement inside the first window would mean
      // the backoff is flat and the cost of a guessing block never grows.
      await new Promise((resolve) => setTimeout(resolve, LOCKOUT_REISSUE_BASE_DELAY_MS + 200));
      expect(pairCodes(log)).toHaveLength(2);

      const third = await waitForPairCode(log, 3);
      expect(third).not.toBe(second);
      expect(Date.now() - lockedOutAt).toBeGreaterThanOrEqual(LOCKOUT_REISSUE_BASE_DELAY_MS);
      expect(log.join("")).toContain(`of ${MAX_LOCKOUT_REISSUES}`);
    } finally {
      await stop();
    }
  }, 30_000);

  it("prints a replacement the operator can pair with", async () => {
    const child: ChildProcess = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/openinterior-mcp/server.ts"],
      {
        cwd: REPO_ROOT,
        env: inheritedEnv({
          OPENINTERIOR_MCP_PORT: "0",
          OPENINTERIOR_ALLOWED_ORIGINS: PAGE_ORIGIN,
        }) as NodeJS.ProcessEnv,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const log: string[] = [];
    const started = readStartup(child.stderr as unknown as Stream, log);

    try {
      const { port, code } = await started;
      const manifestHash = await getCoreToolManifestHash();
      const page = new FakePage(`http://127.0.0.1:${port}`);

      // Burn the whole attempt budget, which retires the live code.
      for (let attempt = 0; attempt < MAX_PAIR_ATTEMPTS; attempt += 1) {
        const guess = String(attempt).repeat(6);
        const response = await page.pair({
          code: guess === code ? "999999" : guess,
          origin: PAGE_ORIGIN,
          manifestHash,
          pageNonce: pageNonce(),
        });
        expect(response.status).toBe(403);
      }

      // A retired code with no replacement would strand the operator: there is
      // no other way to pair, and the relay answers even the right code 403.
      const reissued = await waitForPairCode(log, 2);
      expect(reissued).toMatch(/^\d{6}$/);
      const paired = await page.pair({
        code: reissued,
        origin: PAGE_ORIGIN,
        manifestHash,
        pageNonce: pageNonce(),
      });
      expect(paired.status).toBe(200);
    } finally {
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill("SIGINT");
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3_000))]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  }, 30_000);
});

describe("companion shutdown", () => {
  it("tears down once and exits zero on SIGINT", async () => {
    const child: ChildProcess = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/openinterior-mcp/server.ts"],
      {
        cwd: REPO_ROOT,
        // The repo augments `ProcessEnv` with required keys; the inherited copy
        // carries them, but only the index signature survives the helper.
        env: inheritedEnv({ OPENINTERIOR_MCP_PORT: "0" }) as NodeJS.ProcessEnv,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const stdout: string[] = [];
    const log: string[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(String(chunk)));
    const started = readStartup(child.stderr as unknown as Stream, log);

    try {
      const { port } = await started;
      expect(port).toBeGreaterThan(0);

      const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child.once("exit", (code, signal) => resolve({ code, signal }));
      });
      child.kill("SIGINT");
      const outcome = await exited;

      expect(outcome.signal).toBeNull();
      expect(outcome.code).toBe(0);
      // Nothing but MCP framing may ever reach stdout, and no message was sent.
      expect(stdout.join("")).toBe("");
      expect(log.join("")).toContain("shutting down");
      // The loopback port is released, so a restart can rebind it.
      await expect(fetch(`http://127.0.0.1:${port}/v1/pair`, { method: "POST" })).rejects.toThrow();
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  }, 30_000);
});
