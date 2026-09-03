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
    page.getByRole("heading", {
      level: 1,
      name: "The room becomes the storefront.",
    }),
  ).toBeVisible();

  const card = page.getByRole("region", { name: "WebMCP compatibility" });
  await expect(card).toBeVisible();
  // Playwright drives a Chromium new enough for WebMCP, but without the flag.
  await expect(card.getByRole("status")).toHaveText(
    /once the flag is enabled\.$/,
  );
  await expect(
    card.getByText("chrome://flags/#enable-webmcp-testing"),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open the demo" }),
  ).toHaveAttribute("href", "/demo");
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

  const card = page.getByRole("region", { name: "WebMCP compatibility" });
  await expect(card.getByRole("status")).toHaveText(
    "WebMCP detected. Opening the dashboard.",
  );
  await expect(
    page.getByRole("link", { name: "Open the demo" }),
  ).toHaveAttribute("href", "/demo");
});
