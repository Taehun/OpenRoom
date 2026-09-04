import { describe, expect, it, vi } from "vitest";

import {
  probeStoreCapability,
  ucpEndpoint,
} from "../../src/features/commerce/store-probe";

const DOMAIN = "openroom-x.myshopify.com";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function toolsResponse(names: readonly string[]): Response {
  return jsonResponse({
    jsonrpc: "2.0",
    id: 1,
    result: { tools: names.map((name) => ({ name })) },
  });
}

const FULL_TOOLS = [
  "get_checkout",
  "create_checkout",
  "get_cart",
  "create_cart",
  "update_cart",
  "search_catalog",
];

describe("ucpEndpoint", () => {
  it("targets the UCP path, never the retired one", () => {
    expect(ucpEndpoint(DOMAIN)).toBe(`https://${DOMAIN}/api/ucp/mcp`);
  });
});

describe("probeStoreCapability", () => {
  it("reports ok when the store offers every cart tool", async () => {
    const fetchImpl = vi.fn(async () => toolsResponse(FULL_TOOLS));
    await expect(probeStoreCapability(DOMAIN, { fetch: fetchImpl })).resolves.toMatchObject({
      status: "ok",
    });
  });

  it("sends a tools/list with no credential", async () => {
    let request: Parameters<typeof globalThis.fetch> | undefined;
    const fetchImpl = vi.fn(async (...args: Parameters<typeof globalThis.fetch>) => {
      request = args;
      return toolsResponse(FULL_TOOLS);
    });
    await probeStoreCapability(DOMAIN, { fetch: fetchImpl });

    const [url, init] = request!;
    expect(url).toBe(`https://${DOMAIN}/api/ucp/mcp`);
    expect(JSON.parse(String(init?.body))).toMatchObject({ method: "tools/list" });
    const headers = new Headers(init?.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("X-Shopify-Access-Token")).toBeNull();
    expect(init?.credentials).toBe("omit");
  });

  // The row that justifies probing rather than pinging: the retired endpoint
  // answers 200 and lists a tool while the cart surface is gone.
  it("reports missing-cart-tools when only the policies tool is offered", async () => {
    const fetchImpl = vi.fn(async () => toolsResponse(["search_shop_policies_and_faqs"]));
    await expect(probeStoreCapability(DOMAIN, { fetch: fetchImpl })).resolves.toEqual({
      status: "missing-cart-tools",
      tools: ["search_shop_policies_and_faqs"],
    });
  });

  it("reports missing-cart-tools when one cart tool is absent", async () => {
    const fetchImpl = vi.fn(async () =>
      toolsResponse(["get_cart", "create_cart", "search_catalog"]),
    );
    await expect(probeStoreCapability(DOMAIN, { fetch: fetchImpl })).resolves.toMatchObject({
      status: "missing-cart-tools",
    });
  });

  // A missing store and a non-Shopify host both send no CORS header, so the
  // browser rejects the fetch rather than handing back a readable status.
  it("reports unreachable when the request rejects", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(probeStoreCapability(DOMAIN, { fetch: fetchImpl })).resolves.toEqual({
      status: "unreachable",
    });
  });

  it("reports unreachable when the probe times out", async () => {
    const fetchImpl = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    ) as unknown as typeof globalThis.fetch;

    await expect(
      probeStoreCapability(DOMAIN, { fetch: fetchImpl, timeoutMs: 5 }),
    ).resolves.toEqual({ status: "unreachable" });
  });

  it("reports unreachable when reading the response body times out", async () => {
    const fetchImpl = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) =>
        ({
          json: () =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => {
                reject(new DOMException("Aborted", "AbortError"));
              });
            }),
        }) as Response,
    );

    await expect(
      probeStoreCapability(DOMAIN, { fetch: fetchImpl, timeoutMs: 5 }),
    ).resolves.toEqual({ status: "unreachable" });
  });

  it("reports not-shopify when the body is not a JSON-RPC result", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("<!doctype html><title>Example</title>", { status: 200 }),
    );
    await expect(probeStoreCapability(DOMAIN, { fetch: fetchImpl })).resolves.toEqual({
      status: "not-shopify",
    });
  });

  it("reports not-shopify when JSON-RPC answers with an error", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "nope" } }),
    );
    await expect(probeStoreCapability(DOMAIN, { fetch: fetchImpl })).resolves.toEqual({
      status: "not-shopify",
    });
  });

  it("reports not-shopify when the tool list lacks a JSON-RPC envelope", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ result: { tools: FULL_TOOLS.map((name) => ({ name })) } }),
    );
    await expect(probeStoreCapability(DOMAIN, { fetch: fetchImpl })).resolves.toEqual({
      status: "not-shopify",
    });
  });
});
