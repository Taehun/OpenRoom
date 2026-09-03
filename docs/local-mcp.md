# Local MCP companion

OpenInterior's six tools live in the browser page. Chrome-based agent surfaces
that implement WebMCP call them directly through `document.modelContext`; Claude
Desktop, Claude Code, and Codex CLI cannot, because they speak MCP over stdio and
have no way into your tab.

The companion closes that gap. `pnpm mcp:openinterior` starts a real MCP stdio
server that advertises exactly the Core 6, plus a loopback HTTP relay that a
paired OpenInterior page long-polls for work. The model asks for `get_scene`,
the companion hands the call to your open page, the page executes it against the
live Scene, and the answer comes back unchanged. Nothing about the Scene is
copied into the companion process, and nothing leaves your machine.

```
Claude Desktop / Claude Code / Codex CLI
        │  MCP over stdio
        ▼
pnpm mcp:openinterior ──── HTTP on 127.0.0.1 only ────► OpenInterior page
  (tools/list, tools/call)      (pair, long poll, result)   (the live Scene)
```

## Prerequisites

- Node.js 24.13.1 and pnpm 10.27.0 (the versions recorded in `package.json` and
  `.node-version`), and `pnpm install --frozen-lockfile` already run.
- OpenInterior running at an allowed origin. `pnpm dev` serves
  <http://localhost:3000>, which is allowed out of the box; any other origin has
  to be listed in `OPENINTERIOR_ALLOWED_ORIGINS`.
- **No WebMCP-capable browser is required.** The companion path works in any
  browser that can run the app, because the page executes the tools itself.

## Lifecycle

1. Start the app: `pnpm dev`, then open <http://localhost:3000/demo>.
2. Start the companion: `pnpm mcp:openinterior`. Configure your MCP client with
   one of the entries below and it will start the companion for you instead.
3. Read the banner on **stderr** (stdout carries MCP framing and nothing else):

   ```text
   openinterior-mcp: relay listening on http://127.0.0.1:43110
   openinterior-mcp: allowed page origins: http://localhost:3000, http://127.0.0.1:3000
   openinterior-mcp: pairing code 481902 expires 2026-09-03T09:14:53.267Z
   openinterior-mcp: enter it in OpenInterior's "Pairing code" field, then press "Connect Claude"
   ```

   In Claude Desktop this text is in the MCP server log; in Claude Code use
   `claude --debug` or run `pnpm mcp:openinterior` yourself in a terminal.
4. In the page, type the six digits into **Pairing code** and press **Connect
   Claude**. The status line changes to `Claude: Connected`. Leave the port field
   at `43110` unless you changed `OPENINTERIOR_MCP_PORT`.
5. Ask your model to call a tool — "call get_scene and tell me what is in the
   room" is enough. The call runs in the page you are looking at.

The pair code is **single use** and expires **ten minutes** after it is printed.
Five wrong attempts retire it, and the companion immediately prints a
replacement. Once a page has paired, the code is spent: if the page disconnects
or the session times out, restart the companion (or restart the MCP server from
your client) to get a fresh code.

## Security boundary

| Property | Value |
| --- | --- |
| Listening interface | `127.0.0.1` only; never `0.0.0.0`, never a public port. |
| Allowed page origins | An exact set. No wildcard, no suffix match, no credentials, no path. |
| Pair code | Six digits, single use, 10 minute expiry, retired after 5 failed attempts. |
| Session credential | A bearer token held in memory in the page and the process; never logged, never in a URL. |
| Paired pages | One at a time. A new pairing invalidates the previous token and its pending calls. |
| Concurrent calls | 8 in flight; the ninth is refused rather than queued indefinitely. |
| Request bodies | 64 KiB ceiling, enforced before any JSON is parsed. |
| Call timeout | 30 seconds, after which the call is abandoned and never retried. |
| Liveness | The page long-polls for at most 25 seconds; a session with no poll for 45 seconds is dropped. |
| Retained state | Routing data only: request id, tool name, the input still in flight, and its resolver. No Scene, selection, catalog, cart, or completed result is ever stored, and nothing survives process exit. |
| Cart | Unchanged: `add_scene_to_cart` still opens the local approval sheet in the page and writes nothing anywhere. |

Every pairing failure — mistyped code, expired code, disallowed origin,
mismatched manifest — returns the identical `PAIR_REJECTED` response, so a
caller cannot learn which part was wrong.

**Where your data goes.** The transport and the Scene execution are entirely
local: loopback HTTP between two processes on your machine, and JavaScript in
your own tab. What the model does with a tool result follows your Claude or
Codex product's own data handling, exactly as it would for any other MCP server.

## Client configuration

Every example below uses this repository's absolute path,
`/Users/taehun/Projects/WebMCP`. **Change it to wherever you cloned
OpenInterior.** `pnpm --dir <path>` is what lets the client start the companion
from any working directory.

### Claude Code

```bash
claude mcp add --transport stdio openinterior -- pnpm --silent --dir /Users/taehun/Projects/WebMCP mcp:openinterior
```

### Claude Desktop

Add this to `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "openinterior": {
      "command": "pnpm",
      "args": [
        "--silent",
        "--dir",
        "/Users/taehun/Projects/WebMCP",
        "mcp:openinterior"
      ]
    }
  }
}
```

### Codex CLI

Either run:

```bash
codex mcp add openinterior -- pnpm --silent --dir /Users/taehun/Projects/WebMCP mcp:openinterior
```

or write the equivalent block into `~/.codex/config.toml`:

```toml
[mcp_servers.openinterior]
command = "pnpm"
args = ["--silent", "--dir", "/Users/taehun/Projects/WebMCP", "mcp:openinterior"]
```

Verified against `openai/codex` on 2026-09-03; if your Codex version disagrees,
prefer `codex mcp add`, which writes the block in whatever shape that version
expects.

### ChatGPT desktop and Codex in the ChatGPT browser

No companion needed. Those surfaces call `document.modelContext` natively, so
opening OpenInterior is the whole setup. See the compatibility matrix in the
[README](../README.md#agent-surface-compatibility).

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `OPENINTERIOR_MCP_PORT` | `43110` | Loopback port for the relay. `0` asks the kernel for an ephemeral port (used by the tests). Any other value must be `1024`–`65535`. A malformed value aborts startup rather than silently falling back. |
| `OPENINTERIOR_ALLOWED_ORIGINS` | unset | Extra page origins allowed to pair, comma separated and exact — for example `OPENINTERIOR_ALLOWED_ORIGINS=http://127.0.0.1:4173,https://openinterior.example`. They are added to the built-in `http://localhost:3000` and `http://127.0.0.1:3000`. Wildcards, paths, query strings, and credentials are rejected at startup. |

If you change the port, set the page's **Relay port** field to match; the page
defaults to `43110`.

## Tool annotations

The manifest marks all six tools `untrustedContentHint: true`, because catalog
and Scene text is data rather than instruction. MCP's `ToolAnnotations` schema
defines only `title`, `readOnlyHint`, `destructiveHint`, `idempotentHint`, and
`openWorldHint`, so a conforming client drops any other key when it parses
`tools/list`. The companion therefore sends `readOnlyHint` alone, and
`tools/list` reports exactly `{"readOnlyHint": true}` for the three read tools
and `{"readOnlyHint": false}` for `replace_object`, `move_object`, and
`add_scene_to_cart`. The hint still reaches native WebMCP surfaces, which read
the manifest directly. Names, descriptions, and input schemas are byte-identical
on both paths, and `tests/e2e/webmcp-core.spec.ts` asserts that.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| A tool call returns `PAGE_UNAVAILABLE` | No page is paired. Open OpenInterior, enter the code from the companion's stderr, press **Connect Claude**, then retry. |
| A tool call returns `SESSION_DISCONNECTED` | The page went away mid-call. Restart the companion for a fresh code and pair again. |
| Pairing returns 403 | The code, the page origin, or the manifest hash did not match. Retype the code; if the page is not on `http://localhost:3000`, add its exact origin to `OPENINTERIOR_ALLOWED_ORIGINS`; if you are running a different build in the tab than in the terminal, rebuild so both share one manifest. |
| Pairing keeps failing after several tries | Five wrong attempts retire the code. The companion prints a new one straight away — use that. |
| The page shows `Pairing needs HTTPS or localhost.` | The page is in an insecure context, so it cannot hash the manifest. Use `http://localhost:3000` or an HTTPS origin. |
| The status flips to `Claude: Connection lost` | The long poll stopped reaching the relay (the companion exited, the machine slept, or the port changed). Restart the companion and pair again. |
| The companion exits with `EADDRINUSE` | Port 43110 is taken. Set `OPENINTERIOR_MCP_PORT` and update the page's **Relay port** field. |
| `Invalid OPENINTERIOR_ALLOWED_ORIGINS entry` | An entry is not a bare origin. Use `scheme://host[:port]` with no trailing slash, path, or wildcard. |
| The client reports a protocol parse error | Something other than the companion wrote to stdout. Keep `--silent` in the `pnpm` invocation; the companion itself only writes to stderr. |

## Verifying it works

```bash
pnpm exec vitest run tests/integration/local-mcp-companion.test.ts
```

That test spawns the real `pnpm mcp:openinterior` process, drives it with the
official `@modelcontextprotocol/client` over stdio, pairs a fake page over real
loopback HTTP, and checks the whole path: exact Core 6 in `tools/list`,
`PAGE_UNAVAILABLE` before pairing, refusal of a wrong origin, code, or manifest
hash, unchanged round-trip of `content`/`structuredContent`/`isError`, one MCP
call producing exactly one page execution, failure without replay after a
disconnect, and a clean exit on both stdin close and `SIGINT`.
