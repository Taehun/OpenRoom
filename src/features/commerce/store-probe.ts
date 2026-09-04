/**
 * Asking a store whether it can do the thing it is being connected for.
 *
 * This is the only external request OpenRoom makes, and it happens only when
 * a person presses Save in the store popover. It carries no credential: the
 * UCP endpoint serves `tools/list` unauthenticated, and the agent profile it
 * requires elsewhere is a `tools/call` concern.
 *
 * It works from the browser because Shopify answers `/api/ucp/mcp` with
 * `access-control-allow-origin: *`. That is Shopify's policy rather than a
 * contract with us — if it tightens, every probe fails at once, and the
 * failure will look like a bug in this file before it looks like a policy
 * change.
 */
export const REQUIRED_CART_TOOLS = ["create_cart", "update_cart", "get_cart"] as const;

export const PROBE_TIMEOUT_MS = 5000;

export function ucpEndpoint(storeDomain: string): string {
  return `https://${storeDomain}/api/ucp/mcp`;
}

export type ProbeOutcome =
  | { status: "ok"; tools: readonly string[] }
  | { status: "missing-cart-tools"; tools: readonly string[] }
  | { status: "not-shopify" }
  | { status: "unreachable" };

interface ToolsListResult {
  jsonrpc?: unknown;
  id?: unknown;
  result?: { tools?: { name?: unknown }[] };
}

function toolNamesOf(body: unknown): readonly string[] | null {
  const message = body as ToolsListResult | null;
  if (message?.jsonrpc !== "2.0" || message.id !== 1) return null;
  const tools = message.result?.tools;
  if (!Array.isArray(tools)) return null;
  return tools
    .map((tool) => tool?.name)
    .filter((name): name is string => typeof name === "string");
}

export async function probeStoreCapability(
  storeDomain: string,
  options: { fetch?: typeof globalThis.fetch; timeoutMs?: number } = {},
): Promise<ProbeOutcome> {
  const { fetch: fetchImpl = globalThis.fetch, timeoutMs = PROBE_TIMEOUT_MS } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let body: unknown;
  try {
    const response = await fetchImpl(ucpEndpoint(storeDomain), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      credentials: "omit",
      signal: controller.signal,
    });
    try {
      body = await response.json();
    } catch {
      if (controller.signal.aborted) return { status: "unreachable" };
      // A readable response that is not JSON reached a host, but not the
      // Shopify protocol surface this connection requires.
      return { status: "not-shopify" };
    }
  } catch {
    // A rejected fetch covers three cases the browser cannot tell apart: DNS
    // failure, a 404 store, and a non-Shopify host — none send a CORS header.
    return { status: "unreachable" };
  } finally {
    clearTimeout(timer);
  }

  const tools = toolNamesOf(body);
  if (tools === null) return { status: "not-shopify" };
  const missing = REQUIRED_CART_TOOLS.some((tool) => !tools.includes(tool));
  return missing ? { status: "missing-cart-tools", tools } : { status: "ok", tools };
}
