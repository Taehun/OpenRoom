import { z } from "zod";

import type { CommerceConfig, CommerceEnv } from "./commerce-types";

const providerSchema = z.enum(["demo", "shopify"]);

// Bare host only: labels of letters, digits, and inner hyphens, a TLD of at
// least two letters, no scheme, path, port, query, or whitespace.
const storeDomainSchema = z
  .string()
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);

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
    mcpEndpoint: `https://${domain.data}/api/mcp`,
  };
}

// Literal `process.env.NEXT_PUBLIC_*` references are inlined by Next at build time.
export const COMMERCE_CONFIG: CommerceConfig = parseCommerceConfig({
  NEXT_PUBLIC_COMMERCE_PROVIDER: process.env.NEXT_PUBLIC_COMMERCE_PROVIDER,
  NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN,
});
