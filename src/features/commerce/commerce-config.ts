import { z } from "zod";

import type { CommerceConfig, CommerceEnv } from "./commerce-types";

const providerSchema = z.enum(["demo", "shopify"]);

// Bare host only: labels of letters, digits, and inner hyphens, a TLD of at
// least two letters, no scheme, path, port, query, or whitespace.
const storeDomainSchema = z
  .string()
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);

/**
 * Where the published UCP agent profile sits, relative to the site root. The
 * file itself is `public/ucp/agent-profile.json`; Shopify fetches it from the
 * open internet on every `/api/ucp/mcp` call, so only an absolute https origin
 * that is actually reachable produces a usable URL.
 */
export const UCP_AGENT_PROFILE_PATH = "/ucp/agent-profile.json";

// An https origin and nothing else: no path, query, fragment, or credentials.
// A localhost origin is rejected on purpose — Shopify's servers cannot fetch
// it, and a profile URL that 404s for them is worse than none at all.
function parseAgentProfileUrl(rawOrigin: string | undefined): string | null {
  const value = rawOrigin?.trim() ?? "";
  if (value === "") return null;

  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    return null;
  }
  if (origin.protocol !== "https:") return null;
  if (origin.username !== "" || origin.password !== "") return null;
  if (origin.search !== "" || origin.hash !== "") return null;
  if (origin.pathname !== "/" && origin.pathname !== "") return null;
  if (origin.hostname === "localhost" || origin.hostname.endsWith(".localhost")) {
    return null;
  }

  return `${origin.origin}${UCP_AGENT_PROFILE_PATH}`;
}

export function parseCommerceConfig(env: CommerceEnv): CommerceConfig {
  // Case-insensitive: a dashboard variable typed as `Shopify` must not fall
  // back to demo mode silently.
  const providerValue =
    env.NEXT_PUBLIC_COMMERCE_PROVIDER?.trim().toLowerCase() ?? "";
  if (providerValue === "") return { provider: "demo", reason: "default" };

  const provider = providerSchema.safeParse(providerValue);
  if (!provider.success) return { provider: "demo", reason: "not-configured" };
  if (provider.data === "demo") return { provider: "demo", reason: "default" };

  const domainValue =
    env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN?.trim().toLowerCase() ?? "";
  if (domainValue === "") return { provider: "demo", reason: "not-configured" };

  const domain = storeDomainSchema.safeParse(domainValue);
  if (!domain.success) return { provider: "demo", reason: "invalid-domain" };

  return {
    provider: "shopify",
    storeDomain: domain.data,
    mcpEndpoint: `https://${domain.data}/api/ucp/mcp`,
    agentProfileUrl: parseAgentProfileUrl(env.NEXT_PUBLIC_SITE_ORIGIN),
  };
}

// Literal `process.env.NEXT_PUBLIC_*` references are inlined by Next at build time.
export const COMMERCE_CONFIG: CommerceConfig = parseCommerceConfig({
  NEXT_PUBLIC_COMMERCE_PROVIDER: process.env.NEXT_PUBLIC_COMMERCE_PROVIDER,
  NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN,
  NEXT_PUBLIC_SITE_ORIGIN: process.env.NEXT_PUBLIC_SITE_ORIGIN,
});
