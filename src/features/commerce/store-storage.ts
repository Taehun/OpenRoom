/**
 * The chosen store, remembered on this browser and nowhere else.
 *
 * Every access is guarded because `localStorage` does not merely come back
 * empty when a browser refuses it — reaching for the property throws, and a
 * throw during the first render would take the workspace down with it.
 */
export const STORE_DOMAIN_KEY = "openroom.store-domain";

function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readStoredStoreDomain(
  storage: Storage | null = defaultStorage(),
): string | null {
  if (storage === null) return null;
  try {
    const value = storage.getItem(STORE_DOMAIN_KEY)?.trim() ?? "";
    return value === "" ? null : value;
  } catch {
    // Indistinguishable from "nothing stored", which is the right fallback.
    return null;
  }
}

export function writeStoredStoreDomain(
  domain: string | null,
  storage: Storage | null = defaultStorage(),
): boolean {
  if (storage === null) return false;
  try {
    if (domain === null) storage.removeItem(STORE_DOMAIN_KEY);
    else storage.setItem(STORE_DOMAIN_KEY, domain);
    return true;
  } catch {
    return false;
  }
}
