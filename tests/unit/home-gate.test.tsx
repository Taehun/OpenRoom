import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { HomeGate } from "../../src/features/home/home-gate";

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const FIREFOX_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0";

const restores: Array<() => void> = [];

function stub(target: object, property: string, value: unknown) {
  const original = Object.getOwnPropertyDescriptor(target, property);
  Object.defineProperty(target, property, { configurable: true, value });
  restores.push(() => {
    if (original) Object.defineProperty(target, property, original);
    else Reflect.deleteProperty(target, property);
  });
}

function stubBrowser(options: {
  brands?: ReadonlyArray<{ brand: string; version: string }>;
  secureContext: boolean;
  userAgent: string;
}) {
  stub(navigator, "userAgent", options.userAgent);
  stub(
    navigator,
    "userAgentData",
    options.brands ? { brands: options.brands } : undefined,
  );
  stub(window, "isSecureContext", options.secureContext);
}

function stubModelContext() {
  stub(document, "modelContext", { registerTool: async () => undefined });
}

afterEach(() => {
  cleanup();
  while (restores.length > 0) restores.pop()?.();
  window.history.replaceState({}, "", "/");
});

test("guides a supported Chromium browser through the testing flag", async () => {
  stubBrowser({
    brands: [
      { brand: "Not A(Brand", version: "99" },
      { brand: "Google Chrome", version: "151" },
      { brand: "Chromium", version: "151" },
    ],
    secureContext: true,
    userAgent: CHROME_UA,
  });

  render(<HomeGate />);

  expect(
    await screen.findByRole("heading", {
      level: 1,
      name: "The room becomes the storefront.",
    }),
  ).toBeVisible();
  expect(screen.getByRole("status").textContent).toBe(
    "WebMCP is available in Google Chrome 151 once the flag is enabled.",
  );
  expect(
    screen.getByRole("region", { name: "WebMCP compatibility" }),
  ).toBeVisible();
  expect(
    screen.getByText("chrome://flags/#enable-webmcp-testing"),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Copy flag address" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Check again" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Open the demo" })).toHaveAttribute(
    "href",
    "/demo",
  );
});

test("tells a non-Chromium browser which browser to install", async () => {
  stubBrowser({ secureContext: true, userAgent: FIREFOX_UA });

  render(<HomeGate />);

  expect(
    (await screen.findByRole("status")).textContent,
  ).toBe("WebMCP is not available in Firefox; use Google Chrome 146 or newer.");
  expect(
    screen.getByText(
      "Install Google Chrome 146 or newer. Firefox and Safari do not expose WebMCP today.",
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Copy flag address" }),
  ).toBeNull();
});

test("renders the workspace with a guide link when WebMCP is present", async () => {
  stubBrowser({
    brands: [{ brand: "Google Chrome", version: "151" }],
    secureContext: true,
    userAgent: CHROME_UA,
  });
  stubModelContext();

  render(<HomeGate />);

  expect(
    await screen.findByRole("main", { name: "Room canvas" }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "Guide" })).toHaveAttribute(
    "href",
    "/?view=guide",
  );
});

test("keeps the guide reachable at ?view=guide while WebMCP is present", async () => {
  stubBrowser({
    brands: [{ brand: "Google Chrome", version: "151" }],
    secureContext: true,
    userAgent: CHROME_UA,
  });
  stubModelContext();
  window.history.replaceState({}, "", "/?view=guide");

  render(<HomeGate />);

  expect((await screen.findByRole("status")).textContent).toBe(
    "WebMCP detected. Opening the dashboard.",
  );
  expect(screen.queryByRole("main", { name: "Room canvas" })).toBeNull();
  expect(screen.getByRole("link", { name: "Open the demo" })).toHaveAttribute(
    "href",
    "/demo",
  );
});

test("opens the dashboard for a Claude-only browser at ?view=dashboard", async () => {
  stubBrowser({ secureContext: true, userAgent: FIREFOX_UA });
  window.history.replaceState({}, "", "/?view=dashboard");

  render(<HomeGate />);

  expect(
    await screen.findByRole("main", { name: "Room canvas" }),
  ).toBeVisible();
  expect(
    screen.getByRole("status", { name: "Claude connection status" })
      .textContent,
  ).toBe("Claude: Not connected");
  expect(screen.getByLabelText("Pairing code")).toBeVisible();
  expect(screen.getByRole("link", { name: "Guide" })).toHaveAttribute(
    "href",
    "/?view=guide",
  );
});

test("points a browser without WebMCP at the local companion dashboard", async () => {
  stubBrowser({ secureContext: true, userAgent: FIREFOX_UA });
  window.history.replaceState({}, "", "/?view=guide");

  render(<HomeGate />);

  const dashboard = await screen.findByRole("link", {
    name: "Open the dashboard",
  });
  expect(dashboard).toHaveAttribute("href", "/?view=dashboard");
  expect(dashboard).toBeVisible();
  expect(dashboard.closest("p")?.textContent).toBe(
    "Using Claude Desktop or Claude Code? Open the dashboard and pair with the local companion.",
  );
  expect(screen.queryByRole("main", { name: "Room canvas" })).toBeNull();
});
