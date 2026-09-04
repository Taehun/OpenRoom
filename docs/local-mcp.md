# Local MCP companion

OpenRoom's six tools live in the browser page. Chrome-based agent surfaces
that implement WebMCP call them directly through `document.modelContext`; Claude
Desktop, Claude Code, and Codex CLI cannot, because they speak MCP over stdio and
have no way into your tab.

The companion closes that gap. `pnpm mcp:openroom` starts a real MCP stdio
server that advertises exactly the Core 6, plus a loopback HTTP relay that a
paired OpenRoom page long-polls for work. The model asks for `get_scene`,
the companion hands the call to your open page, the page executes it against the
live Scene, and the answer comes back unchanged. Nothing about the Scene is
copied into the companion process, and nothing leaves your machine.

```
Claude Desktop / Claude Code / Codex CLI
        │  MCP over stdio
        ▼
pnpm mcp:openroom ──── HTTP on 127.0.0.1 only ────► OpenRoom page
  (tools/list, tools/call)  (pair, long poll, result)   (the live Scene)
```

## Prerequisites

- Node.js 24.13.1 and pnpm 10.27.0 (the versions recorded in `package.json` and
  `.node-version`), and `pnpm install --frozen-lockfile` already run.
- OpenRoom running at an allowed origin. `pnpm dev` serves
  <http://localhost:3000>, which is allowed out of the box; any other origin has
  to be listed in `OPENROOM_ALLOWED_ORIGINS`.
- **No WebMCP-capable browser is required.** The companion path works in any
  browser that can run the app, because the page executes the tools itself.

## Lifecycle

1. Start the app: `pnpm dev`, then open <http://localhost:3000/demo>.
2. Register the companion with your MCP client, using one of the entries under
   [Client configuration](#client-configuration). The client starts the process
   itself; `pnpm mcp:openroom` is the script it runs, and running a second copy
   in a terminal does not help (see step 3).
3. Read the banner on **stderr** (stdout carries MCP framing and nothing else):

   ```text
   openroom-mcp: relay listening on http://127.0.0.1:43110
   openroom-mcp: allowed page origins: http://localhost:3000, http://127.0.0.1:3000
   openroom-mcp: pairing code 481902 expires 2026-09-03T09:14:53.267Z
   openroom-mcp: in OpenRoom press "Connect an AI app", type it into the "Pairing code" field, then press "Connect"
   ```

   Where that text lands depends on the client, because the client owns the
   process: the client keeps it out of the way, so register the companion
   behind the one-line stderr log wrapper under [Client
   configuration](#client-configuration) and read the code from the log file it
   appends to (`tail -f ~/openroom-mcp.log`). Starting a second companion in
   a terminal is not a way to read the code: it either fails with `EADDRINUSE`
   on 43110 or, on another port, prints a code for a relay no MCP client is
   attached to.
4. In the page, press **Connect an AI app**, type the six digits into
   **Pairing code**, and press **Connect**. The status chip changes to
   `Local agent: Connected`. The relay port sits behind **Advanced** in that
   dialog; leave it at `43110` unless you changed `OPENROOM_MCP_PORT`.
5. Ask your model to call a tool — "call get_scene and tell me what is in the
   room" is enough. The call runs in the page you are looking at.

The pair code is **single use** and expires **ten minutes** after it is printed.
Exactly one code is live at a time, and the companion prints a replacement
whenever the current one becomes useless. When a paired page goes away — you
press **Disconnect**, you close the tab, or the session misses its
heartbeat — the replacement is printed straight away, so re-pairing is just
"read the new code off stderr and type it in"; the companion and your MCP client
keep running. When five wrong attempts retire a code instead, the replacement is
**delayed**: one second after the first lockout, then two, four, eight … up to a
minute, back to one second once a page pairs. After **ten** lockouts the process
stops printing codes altogether and says so — restart it to pair again. Minting
a new code invalidates any unused previous one.

## Security boundary

| Property | Value |
| --- | --- |
| Listening interface | `127.0.0.1` only; never `0.0.0.0`, never a public port. |
| Allowed page origins | An exact set. No wildcard, no suffix match, no credentials, no path. |
| Pair code | Six digits, single use, 10 minute expiry, retired after 5 failed attempts. Exactly one is live at a time; a replacement is minted when the current one is spent or the paired page goes away, and it invalidates any unused predecessor. |
| Guessing cost | Bounded per process, not just per code. The replacement for a retired code is delayed 1 s, 2 s, 4 s … up to 60 s — doubling with each consecutive lockout, reset by a successful pairing — and after 10 lockouts no further code is minted until the companion is restarted. So five guesses per code stays true, and the number of codes an attacker on an allowed origin can force is finite. |
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
OpenRoom.** `pnpm --dir <path>` is what lets the client start the companion
from any working directory.

**Reading the pair code.** The client starts the companion, so its stderr is the
client's to keep. Wrapping the command in `sh -c` with `2>>` appends that stderr
to a file you can watch, and nothing else changes: only file descriptor 2 is
redirected, so stdout stays the pipe the client reads MCP framing from, and
`exec` replaces the shell with the companion itself, so the client still owns
one process and closing the transport still stops it.

### Claude Code

```bash
claude mcp add --transport stdio openroom -- sh -c 'exec pnpm --silent --dir /Users/taehun/Projects/WebMCP mcp:openroom 2>>"$HOME/openroom-mcp.log"'
```

Then read the code — the port, the pair code, and every session diagnostic land
there, and nothing else ever does:

```bash
tail -f ~/openroom-mcp.log
```

The file only grows by appending; delete it whenever you like. If you would
rather not keep a log file, register the bare command
(`-- pnpm --silent --dir /Users/taehun/Projects/WebMCP mcp:openroom`) and
read the same lines from `claude --debug` output instead.

### Claude Desktop

Add this to `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "openroom": {
      "command": "sh",
      "args": [
        "-c",
        "exec pnpm --silent --dir /Users/taehun/Projects/WebMCP mcp:openroom 2>>\"$HOME/openroom-mcp.log\""
      ]
    }
  }
}
```

Read the pair code with `tail -f ~/openroom-mcp.log`, exactly as for Claude
Code.

### Codex CLI

Either run:

```bash
codex mcp add openroom -- sh -c 'exec pnpm --silent --dir /Users/taehun/Projects/WebMCP mcp:openroom 2>>"$HOME/openroom-mcp.log"'
```

or write the equivalent block into `~/.codex/config.toml`:

```toml
[mcp_servers.openroom]
command = "sh"
args = [
  "-c",
  "exec pnpm --silent --dir /Users/taehun/Projects/WebMCP mcp:openroom 2>>\"$HOME/openroom-mcp.log\"",
]
```

Read the pair code with `tail -f ~/openroom-mcp.log`, exactly as for Claude
Code. Drop the `sh -c` wrapper if your Codex version already surfaces MCP server
stderr somewhere you can watch.

Verified against `openai/codex` on 2026-09-03; if your Codex version disagrees,
prefer `codex mcp add`, which writes the block in whatever shape that version
expects.

### ChatGPT desktop and Codex in the ChatGPT browser

No companion needed. Those surfaces call `document.modelContext` natively, so
opening OpenRoom is the whole setup. See the compatibility matrix in the
[README](../README.md#agent-surface-compatibility).

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `OPENROOM_MCP_PORT` | `43110` | Loopback port for the relay. `0` asks the kernel for an ephemeral port (used by the tests). Any other value must be `1024`–`65535`. A malformed value aborts startup rather than silently falling back. |
| `OPENROOM_ALLOWED_ORIGINS` | unset | Extra page origins allowed to pair, comma separated and exact — for example `OPENROOM_ALLOWED_ORIGINS=http://127.0.0.1:4173,https://openroom.example`. They are added to the built-in `http://localhost:3000` and `http://127.0.0.1:3000`. Wildcards, paths, query strings, and credentials are rejected at startup. |

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
| A tool call returns `PAGE_UNAVAILABLE` | No page is paired. Open OpenRoom, press **Connect an AI app**, enter the code from the companion's stderr, press **Connect**, then retry. |
| You cannot find the pair code | Your client is keeping the companion's stderr. Register it behind the `sh -c … 2>>"$HOME/openroom-mcp.log"` wrapper above and `tail -f ~/openroom-mcp.log`. Starting a second companion in a terminal does not help: it fails with `EADDRINUSE`, or prints a code for a relay no client is attached to. |
| A tool call returns `SESSION_DISCONNECTED` | The page went away mid-call. The companion has already printed a fresh code on stderr — enter it in the page and retry. |
| Pairing returns 403 | The code, the page origin, or the manifest hash did not match. Retype the code; if the page is not on `http://localhost:3000`, add its exact origin to `OPENROOM_ALLOWED_ORIGINS`; if you are running a different build in the tab than in the terminal, rebuild so both share one manifest. |
| Pairing keeps failing after several tries | Five wrong attempts retire the code. The companion prints a replacement after a short delay that doubles with each lockout (1 s, 2 s, 4 s … up to 60 s) — wait for the `pairing code` line and use that one. |
| `no pair code reissued after 10 lockouts` | Ten codes have been retired by wrong attempts in this process, which is the ceiling on guessing. Stop the companion and start it again; if you did not mistype ten times, something else on an allowed origin is posting to the relay. |
| The page shows `Pairing needs HTTPS or localhost.` | The page is in an insecure context, so it cannot hash the manifest. Use `http://localhost:3000` or an HTTPS origin. |
| The status chip flips to `Local agent: Connection lost` | The long poll stopped reaching the relay (the machine slept, the port changed, or the companion exited). If the companion is still running it has printed a fresh code on stderr; enter that and press **Connect** again. |
| The companion exits with `EADDRINUSE` | Port 43110 is taken. Set `OPENROOM_MCP_PORT` and update the page's **Relay port** field. |
| `Invalid OPENROOM_ALLOWED_ORIGINS entry` | An entry is not a bare origin. Use `scheme://host[:port]` with no trailing slash, path, or wildcard. |
| The client reports a protocol parse error | Something other than the companion wrote to stdout. Keep `--silent` in the `pnpm` invocation; the companion itself only writes to stderr. |

## Verifying it works

```bash
pnpm exec vitest run tests/integration/local-mcp-companion.test.ts
```

That test spawns the real `pnpm mcp:openroom` process, drives it with the
official `@modelcontextprotocol/client` over stdio, pairs a fake page over real
loopback HTTP, and checks the whole path: exact Core 6 in `tools/list`,
`PAGE_UNAVAILABLE` before pairing, refusal of a wrong origin, code, or manifest
hash, unchanged round-trip of `content`/`structuredContent`/`isError`, one MCP
call producing exactly one page execution, failure without replay after a
disconnect, a fresh code printed after that disconnect so a second page can
pair and call, and a clean exit on both stdin close and `SIGINT`.
