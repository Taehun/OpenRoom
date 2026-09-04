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


/** Commands render one span per token, so match the whole `<code>` text. */
function commandText(command: string) {
  return (_content: string, node: Element | null) =>
    node?.tagName === "CODE" && node.textContent === command;
}

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
      screen.getByText("AI room planner and furniture shopping"),
    ).toBeVisible();

    const banner = screen.getByRole("region", {
      name: "WebMCP in this browser",
    });
    expect(within(banner).getByRole("status")).toHaveTextContent(
      "Needs a flag in Chromium 151",
    );
    // The facts line names the browser and nothing else: every page but the
    // insecure one is a secure context, and that one says so in its title.
    expect(within(banner).getByText("Chromium 151")).toBeVisible();
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
      within(connect).getAllByRole("link", { name: "Open the demo" }),
    ).toHaveLength(3);
    expect(within(connect).getByText(commandText(CONNECT_COMMANDS.claude))).toBeVisible();
    expect(within(connect).getByText(commandText(CONNECT_COMMANDS.codex))).toBeVisible();
    // Each CLI card tails the log the registered command appends to.
    expect(
      within(connect).getAllByText(commandText(CONNECT_COMMANDS.log)),
    ).toHaveLength(2);
    // The client starts the companion, so the guide never asks the reader to
    // run a second one: that fails with EADDRINUSE or pairs nothing.
    expect(within(connect).queryByText("pnpm mcp:openroom")).toBeNull();

    expect(screen.getAllByRole("link", { name: "Open the demo" })[0]).toHaveAttribute(
      "href",
      "/demo",
    );

    const repoLink = screen.getByRole("link", { name: /^OpenRoom on GitHub/ });
    expect(repoLink).toHaveAttribute(
      "href",
      "https://github.com/Taehun/OpenRoom",
    );
    expect(repoLink).toHaveAttribute("target", "_blank");
    expect(repoLink.getAttribute("rel")).toContain("noopener");

    for (const group of screen.getAllByRole("group"))
      expect(group).not.toHaveAttribute("open");
  });

  it.each([
    {
      kind: "update-required" as const,
      browser: { brand: "Chromium", version: 140 },
      title: "Update Chrome to 146 or newer",
      // The facts line under the banner already names Chromium 140.
      body: null,
      checkAgain: true,
    },
    {
      kind: "unsupported-browser" as const,
      browser: { engine: "other" as const, brand: "Safari", version: 18 },
      title: "Not available in Safari",
      body: "Use Google Chrome 146 or newer.",
      // Checking again in Safari can never change the answer, so the banner
      // offers nothing to press.
      checkAgain: false,
    },
    {
      kind: "insecure-context" as const,
      browser: {},
      title: "Needs HTTPS or localhost",
      body: "Open this page over HTTPS or on http://localhost.",
      checkAgain: true,
    },
  ])(
    "titles the $kind banner",
    ({ body, browser, checkAgain, kind, title }) => {
      renderGuide({ kind, browser });

      const banner = screen.getByRole("region", {
        name: "WebMCP in this browser",
      });
      expect(within(banner).getByRole("status")).toHaveTextContent(title);
      if (body === null)
        expect(banner.querySelector(".md-banner-body")).toBeNull();
      else expect(within(banner).getByText(body)).toBeVisible();

      if (checkAgain) {
        // Only one action, and it is not the flag-required pair.
        expect(
          within(banner).getByRole("button", { name: "Check again" }),
        ).toBeVisible();
        expect(within(banner).getAllByRole("button")).toHaveLength(1);
      } else {
        expect(within(banner).queryByRole("button")).toBeNull();
      }
      expect(
        within(banner).queryByRole("link", { name: "Open the demo" }),
      ).toBeNull();
    },
  );

  it("titles the ready banner and offers the dashboard", () => {
    renderGuide({ kind: "ready" });

    const banner = screen.getByRole("region", {
      name: "WebMCP in this browser",
    });
    expect(within(banner).getByRole("status")).toHaveTextContent(
      "Ready — WebMCP detected",
    );
    expect(
      within(banner).getByRole("link", { name: "Open the demo" }),
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
    const copies = within(claudeCard).getAllByRole("button", { name: /^Copy Claude/ });
    expect(copies).toHaveLength(2);
    // The client launches the companion: the first step registers it behind
    // the stderr-log wrapper, the second tails that log for the pair code.
    await user.click(copies[0]!);
    expect(writeText).toHaveBeenLastCalledWith(CONNECT_COMMANDS.claude);
    await user.click(copies[1]!);
    expect(writeText).toHaveBeenLastCalledWith(CONNECT_COMMANDS.log);
  });

  it("lists the six agent tools from the core manifest", () => {
    renderGuide({ kind: "flag-required" });

    const tools = screen.getByText("What your AI app can do").closest("details");
    if (tools === null) throw new Error("Missing the tool disclosure");
    expect(within(tools).getAllByRole("listitem")).toHaveLength(6);
    // The disclosure is closed, so the entries are present but not visible.
    // Every manifest tool is named, but described in a shopper's words.
    for (const { name, description } of CORE_TOOL_MANIFEST) {
      expect(within(tools).getByText(name)).toBeInTheDocument();
      expect(within(tools).queryByText(description)).toBeNull();
    }
    expect(
      within(tools).getByText("See the room and every piece in it"),
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
  expect(screen.getAllByRole("link", { name: "Open the demo" })[0]).toHaveAttribute(
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
  expect(screen.getAllByRole("link", { name: "Open the demo" })[0]).toHaveAttribute(
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
    screen.getByRole("status", { name: "Desktop AI app status" })
      .textContent,
  ).toBe("Desktop AI app: Not connected");
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
    name: "Open the demo",
  }))
    expect(dashboard).toHaveAttribute("href", "/?view=dashboard");
  expect(
    within(connect).getByRole("article", {
      name: "Claude Code & Claude Desktop",
    }),
  ).toBeVisible();
  expect(screen.queryByRole("main", { name: "Room canvas" })).toBeNull();
});
