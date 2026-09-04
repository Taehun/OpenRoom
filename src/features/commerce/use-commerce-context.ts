"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { resolveCommerceConfig } from "./commerce-config";
import type { CommerceContext } from "./commerce-types";
import { BUILD_COMMERCE } from "./commerce-runtime";
import { readStoredStoreDomain, writeStoredStoreDomain } from "./store-storage";
import { ACTIVE_SHOPIFY_VARIANTS } from "./shopify-variants";

const EMPTY_SHOPIFY_VARIANTS = Object.freeze({});

const BUILD_ENV = {
  NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN,
  NEXT_PUBLIC_SITE_ORIGIN: process.env.NEXT_PUBLIC_SITE_ORIGIN,
};

export interface CommerceController {
  commerce: CommerceContext;
  /** False until the stored value has been read, so the chip can hold its tongue. */
  hydrated: boolean;
  storedDomain: string | null;
  setStoreDomain(domain: string | null): boolean;
}

interface StoredStoreState {
  hydrated: boolean;
  storedDomain: string | null;
}

export function useCommerceContext(): CommerceController {
  const [{ hydrated, storedDomain }, setStoredStore] =
    useState<StoredStoreState>({ hydrated: false, storedDomain: null });

  // The site is a static export, so the first paint is always the build
  // default; storage can only be consulted once we are in the browser.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- This is the intentional server-to-browser storage handoff.
    setStoredStore({ hydrated: true, storedDomain: readStoredStoreDomain() });
  }, []);

  const setStoreDomain = useCallback((domain: string | null) => {
    const persisted = writeStoredStoreDomain(domain);
    setStoredStore((current) => ({ ...current, storedDomain: domain }));
    return persisted;
  }, []);

  const commerce = useMemo<CommerceContext>(
    () => {
      if (!hydrated || storedDomain === null) return BUILD_COMMERCE;

      const config = resolveCommerceConfig(BUILD_ENV, storedDomain);
      const usesBuildStore =
        config.status !== "connected" ||
        (BUILD_COMMERCE.config.status === "connected" &&
          config.storeDomain === BUILD_COMMERCE.config.storeDomain);

      return {
        config,
        variants: usesBuildStore
          ? ACTIVE_SHOPIFY_VARIANTS
          : EMPTY_SHOPIFY_VARIANTS,
      };
    },
    [hydrated, storedDomain],
  );

  return { commerce, hydrated, storedDomain, setStoreDomain };
}
