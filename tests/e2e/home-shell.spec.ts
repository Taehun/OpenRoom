import { expect, test, type Page } from "@playwright/test";

interface CapturedTool {
  name: string;
}

declare global {
  interface Window {
    __homeTools: Record<string, CapturedTool>;
  }
}

const CORE_6 = [
  "add_scene_to_cart",
  "get_scene",
  "get_selection",
  "move_object",
  "replace_object",
  "search_products",
] as const;

async function installModelContext(page: Page) {
  await page.addInitScript(() => {
    window.__homeTools = {};
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        async registerTool(tool: CapturedTool) {
          window.__homeTools[tool.name] = tool;
        },
      },
    });
  });
}

test("guides a browser without WebMCP to the flag and the demo", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: "OpenRoom" }),
  ).toBeVisible();

  const banner = page.getByRole("region", { name: "WebMCP in this browser" });
  await expect(banner).toBeVisible();
  // Playwright drives a Chromium new enough for WebMCP, but without the flag.
  await expect(banner.getByRole("status")).toHaveText(/^Needs a flag in /);
  await expect(
    banner.getByText("chrome://flags/#enable-webmcp-testing"),
  ).toBeVisible();
  await expect(
    banner.getByRole("button", { name: "Copy flag address" }),
  ).toBeVisible();
  // The hero link comes first; the banner and connect cards repeat the label.
  await expect(
    page.getByRole("link", { name: "Open the demo" }).first(),
  ).toHaveAttribute("href", "/demo");

  // Claude Desktop and Claude Code reach the Scene through the local
  // companion, so this browser must still be able to open the dashboard.
  const connect = page.getByRole("region", { name: "Connect an AI app" });
  await expect(connect).toBeVisible();
  // The client launches the companion behind the stderr-log wrapper; the
  // reader never starts a second one. `docs/local-mcp.md` is the source.
  await expect(
    connect.getByText(
      `claude mcp add --transport stdio openroom -- sh -c 'exec pnpm --silent --dir <repo> mcp:openroom 2>>"$HOME/openroom-mcp.log"'`,
    ),
  ).toBeVisible();
  await expect(
    connect.getByText("tail -f ~/openroom-mcp.log").first(),
  ).toBeVisible();
  const dashboard = connect
    .getByRole("link", { name: "Open the demo" })
    .first();
  await expect(dashboard).toHaveAttribute("href", "/?view=dashboard");
  await dashboard.click();

  await expect(page.getByRole("main", { name: "Room canvas" })).toBeVisible();
  await expect(
    page.getByRole("status", { name: "Desktop AI app status" }),
  ).toHaveText("Desktop AI app: Not connected");

  // The fields moved into a modal dialog; the composer keeps one button.
  await page.getByRole("button", { name: "Connect an AI app" }).click();
  const pairing = page.getByRole("dialog", { name: "Connect an AI app" });
  await expect(pairing).toBeVisible();
  await expect(pairing.getByLabel("Pairing code")).toBeVisible();
  await pairing.getByRole("button", { name: "Cancel" }).click();
  await expect(pairing).toBeHidden();

  await page.getByRole("link", { name: "Guide" }).click();
  await expect(
    page.getByRole("region", { name: "WebMCP in this browser" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "OpenRoom" }),
  ).toBeVisible();
});

test("renders the workspace as the dashboard when WebMCP is present", async ({
  page,
}) => {
  await installModelContext(page);
  await page.goto("/");

  await expect(page.getByRole("main", { name: "Room canvas" })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Object.keys(window.__homeTools).sort()))
    .toEqual([...CORE_6]);

  const guide = page.getByRole("link", { name: "Guide" });
  await expect(guide).toHaveAttribute("href", "/?view=guide");
  await guide.click();

  const banner = page.getByRole("region", { name: "WebMCP in this browser" });
  await expect(banner.getByRole("status")).toHaveText(
    "Ready — WebMCP detected",
  );
  await expect(
    banner.getByRole("link", { name: "Open the demo" }),
  ).toHaveAttribute("href", "/?view=dashboard");
  // The hero link comes first; the banner and connect cards repeat the label.
  await expect(
    page.getByRole("link", { name: "Open the demo" }).first(),
  ).toHaveAttribute("href", "/demo");
});

// The guide and the demo are two views of one room: the Scene store lives in
// the root layout, so both view switches have to be soft navigations.
test("keeps the room across the guide round trip from /demo", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/demo");

  const diagnostics = page.getByTestId("scene-diagnostics");
  const roomCanvas = page.getByRole("main", { name: "Room canvas" });
  const viewCart = page.getByRole("button", { name: /^View cart/ });
  await expect(roomCanvas).toBeVisible();

  await page.getByRole("button", { name: "Find alternatives" }).click();
  await page
    .getByRole("button", { name: "Place Oak Frame Table in room" })
    .click();
  await expect(diagnostics).toContainText("Revision 2");
  await expect(viewCart).toHaveText("View cart1");

  // `/demo` carries the guide link too, and it is a `next/link`: the workspace
  // unmounts, but the layout's store — and the room — outlives it.
  await page.getByRole("link", { name: "Guide" }).click();
  await expect(page).toHaveURL("/?view=guide");
  const connect = page.getByRole("region", { name: "Connect an AI app" });
  await expect(connect).toBeVisible();

  // The one link under the connect grid switches the view on the same route.
  await connect.getByRole("link", { name: "Open the demo" }).click();
  await expect(page).toHaveURL("/?view=dashboard");
  await expect(roomCanvas.getByText("Oak Frame Table")).toBeVisible();
  await expect(diagnostics).toContainText("Revision 2");
  await expect(viewCart).toHaveText("View cart1");

  // Back through both switches lands on the same room, not a fresh one.
  await page.goBack();
  await expect(page).toHaveURL("/?view=guide");
  await expect(connect).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL("/demo");
  await expect(roomCanvas.getByText("Oak Frame Table")).toBeVisible();
  await expect(diagnostics).toContainText("Revision 2");
  await expect(viewCart).toHaveText("View cart1");
});
