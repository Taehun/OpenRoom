import { describe, expect, it } from "vitest";

import {
  STORE_DOMAIN_KEY,
  readStoredStoreDomain,
  writeStoredStoreDomain,
} from "../../src/features/commerce/store-storage";

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  } as Storage;
}

/** Site data blocked: the accessors throw rather than returning null. */
function hostileStorage(): Storage {
  return {
    get length(): number {
      throw new Error("blocked");
    },
    clear: () => {
      throw new Error("blocked");
    },
    getItem: () => {
      throw new Error("blocked");
    },
    key: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  } as unknown as Storage;
}

describe("readStoredStoreDomain", () => {
  it("returns the stored domain", () => {
    const storage = memoryStorage({ [STORE_DOMAIN_KEY]: "openroom-x.myshopify.com" });
    expect(readStoredStoreDomain(storage)).toBe("openroom-x.myshopify.com");
  });

  it("returns null when nothing is stored", () => {
    expect(readStoredStoreDomain(memoryStorage())).toBeNull();
  });

  it("treats an empty stored value as nothing stored", () => {
    expect(readStoredStoreDomain(memoryStorage({ [STORE_DOMAIN_KEY]: "  " }))).toBeNull();
  });

  // A throw here would take down the first render of the workspace.
  it("returns null when the browser refuses to be read", () => {
    expect(readStoredStoreDomain(hostileStorage())).toBeNull();
  });

  it("returns null when there is no storage at all", () => {
    expect(readStoredStoreDomain(null)).toBeNull();
  });
});

describe("writeStoredStoreDomain", () => {
  it("stores a domain and reports success", () => {
    const storage = memoryStorage();
    expect(writeStoredStoreDomain("openroom-x.myshopify.com", storage)).toBe(true);
    expect(storage.getItem(STORE_DOMAIN_KEY)).toBe("openroom-x.myshopify.com");
  });

  it("removes the key when passed null", () => {
    const storage = memoryStorage({ [STORE_DOMAIN_KEY]: "openroom-x.myshopify.com" });
    expect(writeStoredStoreDomain(null, storage)).toBe(true);
    expect(storage.getItem(STORE_DOMAIN_KEY)).toBeNull();
  });

  // Reported, not swallowed: appearing to save and not saving is worse than
  // saying the browser will not remember it.
  it("reports failure when the browser refuses to be written", () => {
    expect(writeStoredStoreDomain("openroom-x.myshopify.com", hostileStorage())).toBe(false);
  });

  it("reports failure when there is no storage at all", () => {
    expect(writeStoredStoreDomain("openroom-x.myshopify.com", null)).toBe(false);
  });
});
