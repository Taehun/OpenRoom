import type { CommerceConfig, CommerceEnv } from "./commerce-types";
import { parseStoreDomain } from "./store-domain";

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

function connect(domain: string, env: CommerceEnv): CommerceConfig {
  return {
    status: "connected",
    storeDomain: domain,
    mcpEndpoint: `https://${domain}/api/ucp/mcp`,
    agentProfileUrl: parseAgentProfileUrl(env.NEXT_PUBLIC_SITE_ORIGIN),
  };
}

export function parseCommerceConfig(env: CommerceEnv): CommerceConfig {
  const raw = env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN?.trim() ?? "";
  if (raw === "") return { status: "unconfigured", reason: "not-configured" };
  const parsed = parseStoreDomain(raw);
  if (!parsed.ok) return { status: "unconfigured", reason: "invalid-domain" };
  return connect(parsed.domain, env);
}

/**
 * The runtime choice wins over the build default. A stored value that no
 * longer parses is discarded rather than honoured, so one bad paste cannot
 * leave the app unusable on that browser.
 */
export function resolveCommerceConfig(
  env: CommerceEnv,
  storedDomain: string | null,
): CommerceConfig {
  if (storedDomain !== null) {
    const parsed = parseStoreDomain(storedDomain);
    if (parsed.ok) return connect(parsed.domain, env);
  }
  return parseCommerceConfig(env);
}

// Literal `process.env.NEXT_PUBLIC_*` references are inlined by Next at build time.
export const COMMERCE_CONFIG: CommerceConfig = parseCommerceConfig({
  NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN,
  NEXT_PUBLIC_SITE_ORIGIN: process.env.NEXT_PUBLIC_SITE_ORIGIN,
});
