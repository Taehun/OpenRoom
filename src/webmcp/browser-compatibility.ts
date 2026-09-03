import { getDocumentModelContext } from "./register-tools";

/** Chromium exposes `document.modelContext` from this major version onward. */
export const WEBMCP_MIN_CHROMIUM = 146;
/** From this Chrome version an origin trial replaces the testing flag. */
export const WEBMCP_ORIGIN_TRIAL_CHROME = 149;
export const WEBMCP_FLAG_URL = "chrome://flags/#enable-webmcp-testing";

export interface BrowserInfo {
  engine: "chromium" | "other";
  brand: string;
  /** Major version, or null when no version could be read. */
  version: number | null;
  /** WebMCP has only been verified on Google Chrome. */
  verified: boolean;
}

export type CompatibilityStatus =
  | { kind: "ready"; browser: BrowserInfo }
  | { kind: "flag-required"; browser: BrowserInfo }
  | { kind: "update-required"; browser: BrowserInfo }
  | { kind: "unsupported-browser"; browser: BrowserInfo }
  | { kind: "insecure-context"; browser: BrowserInfo };

export interface BrowserSignals {
  /** `navigator.userAgentData?.brands` when the browser publishes it. */
  brands?: ReadonlyArray<{ brand: string; version: string }> | undefined;
  userAgent: string;
}

/**
 * Client hint brands, most specific vendor first. A Chromium browser lists its
 * own brand next to the generic "Chromium" entry, so the vendor wins.
 */
const BRAND_PRIORITY = [
  "Google Chrome",
  "Microsoft Edge",
  "Brave",
  "Opera",
  "Chromium",
] as const;

/** Vendor tokens that mark a Chrome-shaped user agent as a different browser. */
const OTHER_VENDOR_TOKEN =
  /\b(?:Edg|EdgA|EdgiOS|OPR|Opera|Brave|Vivaldi|YaBrowser|SamsungBrowser|CriOS|HeadlessChrome)\b/;

function majorVersion(value: string | undefined): number | null {
  if (value === undefined) return null;
  const major = Number.parseInt(value, 10);
  return Number.isFinite(major) ? major : null;
}

function uaVersion(userAgent: string, token: string): number | null {
  return majorVersion(
    new RegExp(`${token}/(\\d+)`).exec(userAgent)?.[1] ?? undefined,
  );
}

function chromiumInfo(
  brand: string,
  version: number | null,
  verified: boolean,
): BrowserInfo {
  return { engine: "chromium", brand, version, verified };
}

function otherInfo(brand: string, version: number | null): BrowserInfo {
  return { engine: "other", brand, version, verified: false };
}

export function detectBrowser(signals: BrowserSignals): BrowserInfo {
  const { brands, userAgent } = signals;
  // "Not A(Brand", "Not/A)Brand", "Not:A-Brand": deliberate GREASE entries.
  const usable = (brands ?? []).filter(({ brand }) => !brand.includes("Not"));
  for (const candidate of BRAND_PRIORITY) {
    const entry = usable.find(({ brand }) => brand === candidate);
    if (entry) {
      return chromiumInfo(
        candidate,
        majorVersion(entry.version),
        candidate === "Google Chrome",
      );
    }
  }

  if (/\bEdg(?:A|iOS)?\//.test(userAgent)) {
    return chromiumInfo(
      "Microsoft Edge",
      uaVersion(userAgent, "Edg(?:A|iOS)?"),
      false,
    );
  }

  if (/\bOPR\//.test(userAgent)) {
    return chromiumInfo("Opera", uaVersion(userAgent, "OPR"), false);
  }

  if (/\bChrome\//.test(userAgent)) {
    return chromiumInfo(
      "Google Chrome",
      uaVersion(userAgent, "Chrome"),
      !OTHER_VENDOR_TOKEN.test(userAgent),
    );
  }

  if (/\bFirefox\//.test(userAgent)) {
    return otherInfo("Firefox", uaVersion(userAgent, "Firefox"));
  }

  if (/\bSafari\//.test(userAgent)) {
    return otherInfo("Safari", uaVersion(userAgent, "Version"));
  }

  return otherInfo("Unknown", null);
}

export function assessCompatibility(input: {
  browser: BrowserInfo;
  secureContext: boolean;
  hasModelContext: boolean;
}): CompatibilityStatus {
  const { browser, secureContext, hasModelContext } = input;
  // The API being present is the only proof that matters; every other signal
  // is a guess about why it is missing.
  if (hasModelContext) return { kind: "ready", browser };
  if (!secureContext) return { kind: "insecure-context", browser };
  if (browser.engine !== "chromium") {
    return { kind: "unsupported-browser", browser };
  }
  if (browser.version === null || browser.version < WEBMCP_MIN_CHROMIUM) {
    return { kind: "update-required", browser };
  }
  return { kind: "flag-required", browser };
}

interface UserAgentData {
  brands?: ReadonlyArray<{ brand: string; version: string }>;
}

/** Client-only: reads the live browser signals and assesses them. */
export function readCompatibility(): CompatibilityStatus {
  const userAgentData = (navigator as Navigator & {
    userAgentData?: UserAgentData;
  }).userAgentData;

  return assessCompatibility({
    browser: detectBrowser({
      brands: userAgentData?.brands,
      userAgent: navigator.userAgent,
    }),
    secureContext: window.isSecureContext,
    hasModelContext: getDocumentModelContext() !== null,
  });
}
