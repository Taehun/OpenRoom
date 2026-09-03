import {
  McpServer,
  fromJsonSchema,
  type CallToolResult,
  type JsonSchemaType,
} from "@modelcontextprotocol/server";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/server/validators/ajv";

import { isRelayError, type RelayError } from "../../src/local-mcp/relay-protocol";
import { CORE_TOOL_MANIFEST } from "../../src/webmcp/core-tool-manifest";
import type { SessionRegistry } from "./session-registry";

/**
 * The MCP face of the companion. It registers exactly the six manifest tools
 * and forwards each call to the paired browser page through the relay; it owns
 * no Scene, no catalog, and no cart, and it adds no resources, prompts,
 * sampling, elicitation, roots, or tools of its own. Everything a caller can
 * reach here is something the page would have executed anyway.
 */

export const MCP_SERVER_NAME = "openroom";
export const MCP_SERVER_VERSION = "0.1.0";

/**
 * `untrustedContentHint` is deliberately not forwarded. The MCP `ToolAnnotations`
 * schema defines only `title`, `readOnlyHint`, `destructiveHint`,
 * `idempotentHint`, and `openWorldHint`, so a real client drops any other key
 * when it parses `tools/list`. Sending it anyway would put a field on the wire
 * that no client can see; the manifest keeps the hint for the in-page WebMCP
 * path, where `document.modelContext` does surface it.
 */
function wireAnnotations(entry: (typeof CORE_TOOL_MANIFEST)[number]) {
  return { readOnlyHint: entry.annotations.readOnlyHint };
}

/** Operator-actionable text for a relay refusal; never a token, code, or stack. */
function relayFailureText(error: RelayError): string {
  switch (error.code) {
    case "PAGE_UNAVAILABLE":
      return "PAGE_UNAVAILABLE: no OpenRoom page is paired with this companion. Open the app, type the pairing code printed on the companion's stderr into the Pairing code field, press Connect Claude, then retry.";
    case "SESSION_DISCONNECTED":
      return "SESSION_DISCONNECTED: the paired page went away mid-call. The companion prints a fresh pairing code on stderr when that happens; enter it in the page and retry.";
    case "TOO_MANY_PENDING_CALLS":
      return "TOO_MANY_PENDING_CALLS: the paired page is already running the maximum number of concurrent calls. Retry in a moment.";
    case "CALL_TIMEOUT":
      return "CALL_TIMEOUT: the paired page did not answer in time. The call was abandoned and was not retried.";
    case "UNKNOWN_TOOL":
      return "UNKNOWN_TOOL: that name is not one of the six OpenRoom tools.";
    default:
      return `${error.code}: the OpenRoom relay refused the call.`;
  }
}

/** A tool-level failure, so the caller sees the reason instead of a dead request. */
function toolFailure(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * The page's answer crosses the relay as an opaque payload, so it is re-checked
 * here before it is handed to a model. The object is returned as received - a
 * validating parse would silently rewrite it, and this adapter must not change
 * what the page said.
 */
function isPageToolResult(value: unknown): value is CallToolResult {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { content?: unknown; structuredContent?: unknown; isError?: unknown };
  if (!Array.isArray(candidate.content) || candidate.content.length === 0) return false;
  const blocksAreText = candidate.content.every(
    (block) =>
      typeof block === "object" &&
      block !== null &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string",
  );
  if (!blocksAreText) return false;
  if (!("structuredContent" in candidate)) return false;
  return candidate.isError === undefined || candidate.isError === true;
}

export function createOpenRoomMcpServer(registry: SessionRegistry): McpServer {
  // One validator instance compiles each manifest schema once, at registration.
  const validator = new AjvJsonSchemaValidator();
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  for (const entry of CORE_TOOL_MANIFEST) {
    server.registerTool(
      entry.name,
      {
        description: entry.description,
        inputSchema: fromJsonSchema(entry.inputSchema as unknown as JsonSchemaType, validator),
        annotations: wireAnnotations(entry),
      },
      async (input, ctx) => {
        try {
          // `ctx.mcpReq.signal` fires when the caller cancels, so a cancelled
          // request stops owing the page a result instead of waiting out the
          // relay's thirty second call timeout.
          const result = await registry.forwardToolCall(entry.name, input, ctx.mcpReq.signal);
          if (!isPageToolResult(result)) {
            return toolFailure("The paired OpenRoom page returned a malformed tool result.");
          }
          return result;
        } catch (error) {
          // `RelayError.retryable` is advice for the caller, never a licence for
          // this adapter to re-send: one MCP call is at most one page
          // execution, so a refusal is reported once and the call is dropped.
          if (isRelayError(error)) return toolFailure(relayFailureText(error));
          return toolFailure("The OpenRoom companion could not complete the call.");
        }
      },
    );
  }

  return server;
}
