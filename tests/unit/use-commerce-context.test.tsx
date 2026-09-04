import { act, cleanup, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { useCommerceContext } from "../../src/features/commerce/use-commerce-context";
import { BUILD_COMMERCE } from "../../src/features/commerce/commerce-runtime";
import { STORE_DOMAIN_KEY } from "../../src/features/commerce/store-storage";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("useCommerceContext", () => {
  it("keeps the server first paint neutral until storage can be read", () => {
    window.localStorage.setItem(STORE_DOMAIN_KEY, "stored.myshopify.com");

    function FirstPaint() {
      const { hydrated, storedDomain } = useCommerceContext();
      return <output>{`${hydrated ? "hydrated" : "waiting"}:${storedDomain ?? "none"}`}</output>;
    }

    expect(renderToString(<FirstPaint />)).toContain("waiting:none");
  });

  it("reports hydrated after the first effect, with no stored value", () => {
    const { result } = renderHook(() => useCommerceContext());
    expect(result.current.hydrated).toBe(true);
    expect(result.current.storedDomain).toBeNull();
  });

  it("adopts a domain already in storage", () => {
    window.localStorage.setItem(STORE_DOMAIN_KEY, "stored.myshopify.com");
    const { result } = renderHook(() => useCommerceContext());
    expect(result.current.commerce.config).toMatchObject({
      status: "connected",
      storeDomain: "stored.myshopify.com",
    });
  });

  it("switches the store and persists it", () => {
    const { result } = renderHook(() => useCommerceContext());
    act(() => {
      expect(result.current.setStoreDomain("chosen.myshopify.com")).toBe(true);
    });
    expect(result.current.commerce.config).toMatchObject({
      storeDomain: "chosen.myshopify.com",
    });
    expect(window.localStorage.getItem(STORE_DOMAIN_KEY)).toBe("chosen.myshopify.com");
  });

  it("clears back to the build default", () => {
    window.localStorage.setItem(STORE_DOMAIN_KEY, "stored.myshopify.com");
    const { result } = renderHook(() => useCommerceContext());
    act(() => {
      result.current.setStoreDomain(null);
    });
    expect(result.current.storedDomain).toBeNull();
    expect(window.localStorage.getItem(STORE_DOMAIN_KEY)).toBeNull();
  });

  it("keeps the variant map from the build", () => {
    const { result } = renderHook(() => useCommerceContext());
    expect(Object.keys(result.current.commerce.variants).length).toBeGreaterThan(0);
  });

  it("drops build-store variants after switching to another store", () => {
    const buildDomain =
      BUILD_COMMERCE.config.status === "connected"
        ? BUILD_COMMERCE.config.storeDomain
        : null;
    const switchedDomain =
      buildDomain === "chosen.myshopify.com"
        ? "alternate.myshopify.com"
        : "chosen.myshopify.com";
    const { result } = renderHook(() => useCommerceContext());

    act(() => {
      result.current.setStoreDomain(switchedDomain);
    });

    expect(result.current.commerce.config).toMatchObject({
      status: "connected",
      storeDomain: switchedDomain,
    });
    expect(result.current.commerce.variants).toEqual({});
  });
});
