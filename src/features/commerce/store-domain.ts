/**
 * Turning what a person pastes into a store host, and saying what is wrong
 * when it cannot be one.
 *
 * Format is a gate, not a verdict: it decides whether the domain is worth a
 * network round trip (see `store-probe.ts`), and nothing more.
 */

// Bare host only: labels of letters, digits, and inner hyphens, a TLD of at
// least two letters, no scheme, path, port, query, or whitespace. Moved here
// from commerce-config so the build-time and runtime paths judge a domain the
// same way rather than drifting apart.
export const STORE_DOMAIN_PATTERN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export type DomainRejection =
  | "empty"
  | "looks-like-email"
  | "no-dot"
  | "not-public-host"
  | "malformed";

export type DomainParse =
  | { ok: true; domain: string }
  | { ok: false; rejection: DomainRejection };

/**
 * Applied in order, so the ordinary ways of copying a store address all
 * succeed instead of being rejected on a technicality.
 */
export function normalizeStoreDomain(raw: string): string {
  let value = raw.trim();
  value = value.replace(/^https?:\/\//i, "");
  value = value.replace(/^www\./i, "");
  const cut = value.search(/[/?#]/);
  if (cut !== -1) value = value.slice(0, cut);
  return value.toLowerCase();
}

const IPV4_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export function parseStoreDomain(raw: string): DomainParse {
  const domain = normalizeStoreDomain(raw);
  if (domain === "") return { ok: false, rejection: "empty" };
  if (/[\s@]/.test(domain)) return { ok: false, rejection: "looks-like-email" };
  // A port survives normalization because it is not a path separator, and it
  // is the usual shape of a local address someone types out of habit.
  if (domain.includes(":") || IPV4_PATTERN.test(domain) || domain.endsWith(".local")) {
    return { ok: false, rejection: "not-public-host" };
  }
  if (!domain.includes(".")) return { ok: false, rejection: "no-dot" };
  if (!STORE_DOMAIN_PATTERN.test(domain)) {
    return { ok: false, rejection: "malformed" };
  }
  return { ok: true, domain };
}

export function domainRejectionMessage(rejection: DomainRejection): string {
  switch (rejection) {
    case "empty":
      return "Enter your store's address, like your-store.myshopify.com";
    case "looks-like-email":
      return "That looks like an email or a search, not a store address";
    case "no-dot":
      return "Add the full address, like openroom.myshopify.com";
    case "not-public-host":
      return "A Shopify store address is needed here";
    case "malformed":
      return "That is not a valid store address";
  }
}
