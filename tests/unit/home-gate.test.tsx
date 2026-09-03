import { CORE_TOOL_MANIFEST } from "../../src/webmcp/core-tool-manifest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, test, vi } from "vitest";
import { HomeGate } from "../../src/features/home/home-gate";
import {
  CONNECT_COMMANDS,
  WebMcpGuide,
} from "../../src/features/home/webmcp-guide";
import type {
  BrowserInfo,
  CompatibilityStatus,
} from "../../src/webmcp/browser-compatibility";

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

/** A Chromium new enough for WebMCP but without the testing flag. */
const CHROMIUM_151: BrowserInfo = {
  engine: "chromium",
  brand: "Chromium",
  version: 151,
  verified: false,
};

/**
 * Renders the guide directly so a status variant can be asserted without
 * inventing the browser signals that would produce it.
 */
function renderGuide(
  status: {
    kind: CompatibilityStatus["kind"];
    browser?: Partial<BrowserInfo>;
  } | null,
  onCheckAgain: () => void = () => undefined,
) {
  render(
    <WebMcpGuide
      onCheckAgain={onCheckAgain}
      status={
        status === null
          ? null
          : { kind: status.kind, browser: { ...CHROMIUM_151, ...status.browser } }
      }
    />,
  );
}

afterEach(() => {
  cleanup();
  while (restores.length > 0) restores.pop()?.();
  window.history.replaceState({}, "", "/");
});

describe("the one-screen guide", () => {
  it("renders the one-screen guide for a flag-required browser", () => {
    renderGuide({
      kind: "flag-required",
      browser: { brand: "Chromium", version: 151, verified: false },
    });

    expect(
      screen.getByRole("heading", { level: 1, name: "OpenRoom" }),
    ).toBeVisible();
    expect(
      screen.getByText("AI Room Planner & Furniture Shopping"),
    ).toBeVisible();

    const banner = screen.getByRole("region", {
      name: "WebMCP in this browser",
    });
    expect(within(banner).getByRole("status")).toHaveTextContent(
      "Needs a flag in Chromium 151",
    );
    expect(
      within(banner).getByText("Chromium 151 · secure context"),
    ).toBeVisible();
    expect(
      within(banner).getByText("chrome://flags/#enable-webmcp-testing"),
    ).toBeVisible();
    expect(
      within(banner).getByRole("button", { name: "Copy flag address" }),
    ).toBeVisible();
    expect(
      within(banner).getByRole("button", { name: "Check again" }),
    ).toBeVisible();

    const connect = screen.getByRole("region", { name: "Connect an AI app" });
    expect(
      within(connect).getAllByRole("link", { name: "Open the dashboard" }),
    ).toHaveLength(3);
    expect(within(connect).getByText(CONNECT_COMMANDS.claude)).toBeVisible();
    expect(within(connect).getByText(CONNECT_COMMANDS.codex)).toBeVisible();

    expect(screen.getByRole("link", { name: "Open the demo" })).toHaveAttribute(
      "href",
      "/demo",
    );
    for (const group of screen.getAllByRole("group"))
      expect(group).not.toHaveAttribute("open");
  });

  it.each([
    [
      "update-required",
      { brand: "Chromium", version: 140 },
      "Update Chrome to 146 or newer",
      "You are on Chromium 140.",
    ],
    [
      "unsupported-browser",
      { engine: "other" as const, brand: "Safari", version: 18 },
      "Not available in Safari",
      "Use Google Chrome 146 or newer.",
    ],
    [
      "insecure-context",
      {},
      "Needs HTTPS or localhost",
      "Open this page over HTTPS or on http://localhost.",
    ],
  ])("titles the %s banner", (kind, browser, title, body) => {
    renderGuide({
      kind: kind as CompatibilityStatus["kind"],
      browser,
    });

    const banner = screen.getByRole("region", {
      name: "WebMCP in this browser",
    });
    expect(within(banner).getByRole("status")).toHaveTextContent(title);
    expect(within(banner).getByText(body)).toBeVisible();
    // Only one action, and it is not the flag-required pair.
    expect(
      within(banner).getByRole("button", { name: "Check again" }),
    ).toBeVisible();
    expect(within(banner).getAllByRole("button")).toHaveLength(1);
    expect(
      within(banner).queryByRole("link", { name: "Open the dashboard" }),
    ).toBeNull();
  });

  it("titles the ready banner and offers the dashboard", () => {
    renderGuide({ kind: "ready" });

    const banner = screen.getByRole("region", {
      name: "WebMCP in this browser",
    });
    expect(within(banner).getByRole("status")).toHaveTextContent(
      "Ready — WebMCP detected",
    );
    expect(
      within(banner).getByRole("link", { name: "Open the dashboard" }),
    ).toHaveAttribute("href", "/?view=dashboard");
    expect(within(banner).queryByRole("button")).toBeNull();
  });

  it("offers no action while the browser is still being read", () => {
    renderGuide(null);

    const banner = screen.getByRole("region", {
      name: "WebMCP in this browser",
    });
    expect(within(banner).getByRole("status")).toHaveTextContent(
      "Checking your browser…",
    );
    expect(within(banner).queryByRole("button")).toBeNull();
    expect(within(banner).queryByRole("link")).toBeNull();
  });

  it("copies the flag address and the connect commands verbatim", async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    renderGuide({ kind: "flag-required" });

    await user.click(
      screen.getByRole("button", { name: "Copy flag address" }),
    );
    expect(writeText).toHaveBeenLastCalledWith(
      "chrome://flags/#enable-webmcp-testing",
    );
    expect(screen.getByRole("button", { name: "Copied" })).toBeVisible();

    const claudeCard = screen.getByRole("article", {
      name: "Claude Code & Claude Desktop",
    });
    const copies = within(claudeCard).getAllByRole("button", { name: "Copy" });
    expect(copies).toHaveLength(2);
    await user.click(copies[0]!);
    expect(writeText).toHaveBeenLastCalledWith(CONNECT_COMMANDS.start);
    await user.click(copies[1]!);
    expect(writeText).toHaveBeenLastCalledWith(CONNECT_COMMANDS.claude);
  });

  it("lists the six agent tools from the core manifest", () => {
    renderGuide({ kind: "flag-required" });

    const tools = screen.getByText("What an agent can do").closest("details");
    if (tools === null) throw new Error("Missing the tool disclosure");
    expect(within(tools).getAllByRole("listitem")).toHaveLength(6);
    // The disclosure is closed, so the entries are present but not visible.
    const getScene = CORE_TOOL_MANIFEST.find(({ name }) => name === "get_scene");
    if (!getScene) throw new Error("Missing get_scene in the manifest");
    expect(
      within(tools).getByText(`— ${getScene.description}`),
    ).toBeInTheDocument();
  });

  it("calls back when the reader checks the browser again", async () => {
    const user = userEvent.setup();
    const onCheckAgain = vi.fn();
    renderGuide({ kind: "flag-required" }, onCheckAgain);

    await user.click(screen.getByRole("button", { name: "Check again" }));

    expect(onCheckAgain).toHaveBeenCalledTimes(1);
  });
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
    await screen.findByRole("heading", { level: 1, name: "OpenRoom" }),
  ).toBeVisible();
  expect(screen.getByRole("status").textContent).toBe(
    "Needs a flag in Google Chrome 151",
  );
  expect(
    screen.getByRole("region", { name: "WebMCP in this browser" }),
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

  expect((await screen.findByRole("status")).textContent).toBe(
    "Not available in Firefox",
  );
  expect(screen.getByText("Use Google Chrome 146 or newer.")).toBeVisible();
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
    "Ready — WebMCP detected",
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
    screen.getByRole("status", { name: "Local agent connection status" })
      .textContent,
  ).toBe("Local agent: Not connected");
  expect(
    screen.getByRole("button", { name: "Connect an AI app" }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "Guide" })).toHaveAttribute(
    "href",
    "/?view=guide",
  );
});

test("points a browser without WebMCP at the local companion dashboard", async () => {
  stubBrowser({ secureContext: true, userAgent: FIREFOX_UA });
  window.history.replaceState({}, "", "/?view=guide");

  render(<HomeGate />);

  const connect = await screen.findByRole("region", {
    name: "Connect an AI app",
  });
  for (const dashboard of within(connect).getAllByRole("link", {
    name: "Open the dashboard",
  }))
    expect(dashboard).toHaveAttribute("href", "/?view=dashboard");
  expect(
    within(connect).getByRole("article", {
      name: "Claude Code & Claude Desktop",
    }),
  ).toBeVisible();
  expect(screen.queryByRole("main", { name: "Room canvas" })).toBeNull();
});
