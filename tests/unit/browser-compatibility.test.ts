import { describe, expect, test } from "vitest";
import {
  assessCompatibility,
  detectBrowser,
  WEBMCP_FLAG_URL,
  WEBMCP_MIN_CHROMIUM,
  WEBMCP_ORIGIN_TRIAL_CHROME,
  type BrowserInfo,
} from "../../src/webmcp/browser-compatibility";

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";
const EDGE_UA = `${CHROME_UA} Edg/147.0.0.0`;
const FIREFOX_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0";
const SAFARI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15";

function browser(overrides: Partial<BrowserInfo> = {}): BrowserInfo {
  return {
    engine: "chromium",
    brand: "Google Chrome",
    version: 150,
    verified: true,
    ...overrides,
  };
}

test("publishes the verified WebMCP constants", () => {
  expect(WEBMCP_MIN_CHROMIUM).toBe(146);
  expect(WEBMCP_ORIGIN_TRIAL_CHROME).toBe(149);
  expect(WEBMCP_FLAG_URL).toBe("chrome://flags/#enable-webmcp-testing");
});

describe("detectBrowser", () => {
  test("reads a verified Google Chrome at the minimum version from brands", () => {
    expect(
      detectBrowser({
        brands: [{ brand: "Google Chrome", version: "146" }],
        userAgent: CHROME_UA,
      }),
    ).toEqual({
      engine: "chromium",
      brand: "Google Chrome",
      version: 146,
      verified: true,
    });
  });

  test("keeps the major version of an older Google Chrome", () => {
    expect(
      detectBrowser({
        brands: [{ brand: "Google Chrome", version: "145" }],
        userAgent: CHROME_UA,
      }).version,
    ).toBe(145);
  });

  test("prefers Microsoft Edge over Chromium and ignores the Not A(Brand entry", () => {
    expect(
      detectBrowser({
        brands: [
          { brand: "Not A(Brand", version: "99" },
          { brand: "Microsoft Edge", version: "147" },
          { brand: "Chromium", version: "147" },
        ],
        userAgent: EDGE_UA,
      }),
    ).toEqual({
      engine: "chromium",
      brand: "Microsoft Edge",
      version: 147,
      verified: false,
    });
  });

  test("falls back to the Chromium brand when no vendor brand is present", () => {
    expect(
      detectBrowser({
        brands: [
          { brand: "Not/A)Brand", version: "8" },
          { brand: "Chromium", version: "149" },
        ],
        userAgent: CHROME_UA,
      }),
    ).toEqual({
      engine: "chromium",
      brand: "Chromium",
      version: 149,
      verified: false,
    });
  });

  test("reads a verified Google Chrome from a plain user agent string", () => {
    expect(
      detectBrowser({ brands: undefined, userAgent: CHROME_UA }),
    ).toEqual({
      engine: "chromium",
      brand: "Google Chrome",
      version: 147,
      verified: true,
    });
  });

  test("reads Microsoft Edge from the Edg user agent token", () => {
    expect(detectBrowser({ userAgent: EDGE_UA })).toEqual({
      engine: "chromium",
      brand: "Microsoft Edge",
      version: 147,
      verified: false,
    });
  });

  test("reports Firefox as a non-Chromium engine", () => {
    expect(detectBrowser({ userAgent: FIREFOX_UA })).toEqual({
      engine: "other",
      brand: "Firefox",
      version: 133,
      verified: false,
    });
  });

  test("reports Safari as a non-Chromium engine when no Chrome token is present", () => {
    expect(detectBrowser({ userAgent: SAFARI_UA })).toMatchObject({
      engine: "other",
      brand: "Safari",
      verified: false,
    });
  });

  test("reports an unknown browser for an unrecognized user agent", () => {
    expect(detectBrowser({ userAgent: "curl/8.7.1" })).toEqual({
      engine: "other",
      brand: "Unknown",
      version: null,
      verified: false,
    });
  });
});

describe("assessCompatibility", () => {
  test("is ready whenever the page already has a model context", () => {
    const firefox = browser({
      engine: "other",
      brand: "Firefox",
      version: 133,
      verified: false,
    });

    expect(
      assessCompatibility({
        browser: firefox,
        secureContext: false,
        hasModelContext: true,
      }),
    ).toEqual({ kind: "ready", browser: firefox });
  });

  test("reports an insecure context before anything else", () => {
    expect(
      assessCompatibility({
        browser: browser({ version: 150 }),
        secureContext: false,
        hasModelContext: false,
      }).kind,
    ).toBe("insecure-context");
  });

  test("reports an unsupported browser for a non-Chromium engine", () => {
    expect(
      assessCompatibility({
        browser: browser({
          engine: "other",
          brand: "Firefox",
          version: 133,
          verified: false,
        }),
        secureContext: true,
        hasModelContext: false,
      }).kind,
    ).toBe("unsupported-browser");
  });

  test("asks for an update below the minimum Chromium version", () => {
    expect(
      assessCompatibility({
        browser: browser({ version: 145 }),
        secureContext: true,
        hasModelContext: false,
      }).kind,
    ).toBe("update-required");
  });

  test("asks for an update when the version is unknown", () => {
    expect(
      assessCompatibility({
        browser: browser({ version: null }),
        secureContext: true,
        hasModelContext: false,
      }).kind,
    ).toBe("update-required");
  });

  test("asks for the flag at the minimum Chromium version", () => {
    expect(
      assessCompatibility({
        browser: browser({ version: 146 }),
        secureContext: true,
        hasModelContext: false,
      }).kind,
    ).toBe("flag-required");
  });

  test("asks for the flag on an unverified Chromium browser", () => {
    const edge = browser({
      brand: "Microsoft Edge",
      version: 150,
      verified: false,
    });

    expect(
      assessCompatibility({
        browser: edge,
        secureContext: true,
        hasModelContext: false,
      }),
    ).toEqual({ kind: "flag-required", browser: edge });
  });
});
