/**
 * The bridge back into OpenRoom: one `NEXT_PUBLIC_SHOPIFY_VARIANTS` line that
 * maps every catalog product id to the variant GID the seeded store gave it.
 * `parseVariantOverrides` in `src/features/commerce/shopify-variants.ts` reads
 * exactly this format, and the unit test round-trips the line through it.
 */
import type { AdminClient } from "./admin-client";
import { PRODUCT_BY_HANDLE_QUERY } from "./seed";

export const VARIANTS_ENV_KEY = "NEXT_PUBLIC_SHOPIFY_VARIANTS";

export interface VariantEntry {
  handle: string;
  variantId: string | null;
}

interface ProductByHandleData {
  products: {
    nodes: { id: string; handle: string; variants: { nodes: { id: string }[] } }[];
  };
}

/** `NEXT_PUBLIC_SHOPIFY_VARIANTS=<handle>=<gid>,…`, sorted by handle. */
export function buildVariantsEnvLine(entries: readonly VariantEntry[]): string {
  const pairs = entries
    .filter((entry): entry is { handle: string; variantId: string } =>
      typeof entry.variantId === "string" && entry.variantId !== "",
    )
    .slice()
    .sort((a, b) => (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0))
    .map((entry) => `${entry.handle}=${entry.variantId}`);
  return `${VARIANTS_ENV_KEY}=${pairs.join(",")}`;
}

/**
 * Reads the default variant of each handle straight out of the store, one
 * request per handle so a big catalog never trips the Admin API's cost budget.
 * A handle the store does not have comes back with a `null` variant rather
 * than throwing — the caller reports it and the app leaves it unmapped.
 */
export async function fetchStoreVariants(
  client: AdminClient,
  handles: readonly string[],
): Promise<VariantEntry[]> {
  const entries: VariantEntry[] = [];
  for (const handle of handles) {
    const data = await client.query<ProductByHandleData>(PRODUCT_BY_HANDLE_QUERY, {
      q: `handle:${handle}`,
    });
    const node = data.products.nodes.find((candidate) => candidate.handle === handle);
    entries.push({ handle, variantId: node?.variants.nodes[0]?.id ?? null });
  }
  return entries;
}

/**
 * Replaces the `NEXT_PUBLIC_SHOPIFY_VARIANTS=` line in an `.env.local` body,
 * or appends it. Every other line — including other keys and comments — is
 * left byte-for-byte alone.
 */
export function upsertEnvLine(body: string, line: string): string {
  const key = `${line.slice(0, line.indexOf("="))}=`;
  const lines = body === "" ? [] : body.split("\n");
  const index = lines.findIndex((existing) => existing.startsWith(key));
  if (index >= 0) {
    lines[index] = line;
    return lines.join("\n");
  }
  const trimmed = lines.length > 0 && lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;
  return [...trimmed, line, ""].join("\n");
}
