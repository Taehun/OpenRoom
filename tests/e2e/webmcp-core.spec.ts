import { expect, test } from "@playwright/test";

interface BrowserToolResult {
  structuredContent: {
    ok: boolean;
    sceneRevision: number;
    stateVersion: number;
    data?: unknown;
    error?: {
      code: string;
      latestRevision?: number;
      latestStateVersion?: number;
    };
  };
}

interface BrowserTool {
  name: string;
  execute(
    input: unknown,
    options: { signal: AbortSignal },
  ): Promise<BrowserToolResult>;
}

declare global {
  interface Window {
    // Names collapse when two workspaces register the same tool; the counter
    // is what distinguishes a live leak from a clean re-registration.
    __webMcpActiveRegistrations: number;
    __webMcpActiveToolNames: Set<string>;
    __webMcpFetchCount: number;
    __webMcpTools: Record<string, BrowserTool>;
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

test("completes WebMCP Core 6 against the shared demo Scene", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const externalRequestsDuringCart: string[] = [];
  let appOrigin = "";
  let trackCartRequests = false;
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("request", (request) => {
    if (
      trackCartRequests &&
      appOrigin !== "" &&
      new URL(request.url()).origin !== appOrigin
    ) {
      externalRequestsDuringCart.push(request.url());
    }
  });
  await page.addInitScript(() => {
    window.__webMcpActiveRegistrations = 0;
    window.__webMcpActiveToolNames = new Set();
    window.__webMcpFetchCount = 0;
    window.__webMcpTools = {};
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        async registerTool(
          tool: BrowserTool,
          options?: { signal?: AbortSignal },
        ) {
          window.__webMcpTools[tool.name] = tool;
          window.__webMcpActiveToolNames.add(tool.name);
          window.__webMcpActiveRegistrations += 1;
          options?.signal?.addEventListener(
            "abort",
            () => {
              window.__webMcpActiveToolNames.delete(tool.name);
              window.__webMcpActiveRegistrations -= 1;
            },
            { once: true },
          );
        },
      },
    });
  });

  await page.goto("/demo");
  appOrigin = new URL(page.url()).origin;
  await expect
    .poll(() =>
      page.evaluate(() => Object.keys(window.__webMcpTools).sort()),
    )
    .toEqual([...CORE_6]);
  await expect
    .poll(() =>
      page.evaluate(() => [...window.__webMcpActiveToolNames].sort()),
    )
    .toEqual([...CORE_6]);

  const selection = await page.evaluate(() =>
    window.__webMcpTools.get_selection?.execute(
      {},
      { signal: new AbortController().signal },
    ),
  );
  expect(selection?.structuredContent).toMatchObject({
    ok: true,
    sceneRevision: 1,
    stateVersion: 1,
    data: { id: "table_01" },
  });

  const search = await page.evaluate(() =>
    window.__webMcpTools.search_products?.execute(
      { category: "coffee_table" },
      { signal: new AbortController().signal },
    ),
  );
  expect(search?.structuredContent).toMatchObject({
    ok: true,
    sceneRevision: 1,
    stateVersion: 1,
  });
  const results = search?.structuredContent.data as
    | { results: Array<{ id: string }> }
    | undefined;
  expect(results?.results[1]?.id).toBe("travertine-plinth-table");

  const replacement = await page.evaluate((productId) =>
    window.__webMcpTools.replace_object?.execute(
      {
        objectId: "table_01",
        productId,
        expectedRevision: 1,
        expectedStateVersion: 1,
      },
      { signal: new AbortController().signal },
    ), results?.results[1]?.id);
  expect(replacement?.structuredContent).toMatchObject({
    ok: true,
    sceneRevision: 2,
    stateVersion: 2,
  });
  const diagnostics = page.getByRole("status", { name: "Scene diagnostics" });
  await expect(diagnostics).toContainText(
    "Revision 2 · table_01 · travertine-plinth-table",
  );
  await expect(
    page.locator('[data-object-id="table_01"] img'),
  ).toHaveAttribute(
    "src",
    "/demo/photo/products/travertine-plinth-table.webp",
  );
  const sceneAfterReplacement = await page.evaluate(() =>
    window.__webMcpTools.get_scene?.execute(
      {},
      { signal: new AbortController().signal },
    ),
  );
  const sceneData = sceneAfterReplacement?.structuredContent.data as
    | {
        objects: Array<{
          id: string;
          product?: { id: string };
          source: string;
        }>;
      }
    | undefined;
  expect(
    sceneData?.objects.filter((object) => object.source === "product"),
  ).toEqual([
    expect.objectContaining({
      id: "table_01",
      product: expect.objectContaining({ id: "travertine-plinth-table" }),
    }),
  ]);

  const lamp = page.locator('[data-object-id="lamp_01"]');
  const lampStyleBeforeStaleMove = await lamp.getAttribute("style");
  const staleMove = await page.evaluate(() =>
    window.__webMcpTools.move_object?.execute(
      {
        objectId: "lamp_01",
        expectedRevision: 1,
        expectedStateVersion: 2,
        position: { x: 0, z: 0 },
      },
      { signal: new AbortController().signal },
    ),
  );
  expect(staleMove?.structuredContent).toMatchObject({
    ok: false,
    sceneRevision: 2,
    stateVersion: 2,
    error: {
      code: "SCENE_REVISION_CONFLICT",
      latestRevision: 2,
    },
  });
  await expect(diagnostics).toContainText(
    "Revision 2 · table_01 · travertine-plinth-table",
  );
  const sceneAfterStaleMove = await page.evaluate(() =>
    window.__webMcpTools.get_scene?.execute(
      {},
      { signal: new AbortController().signal },
    ),
  );
  expect(sceneAfterStaleMove?.structuredContent.data).toEqual(
    sceneAfterReplacement?.structuredContent.data,
  );
  expect(await lamp.getAttribute("style")).toBe(lampStyleBeforeStaleMove);

  await page.evaluate(() => {
    const fetch = window.fetch;
    window.fetch = (...args) => {
      window.__webMcpFetchCount += 1;
      return fetch(...args);
    };
  });
  trackCartRequests = true;
  const cart = await page.evaluate(() =>
    window.__webMcpTools.add_scene_to_cart?.execute(
      { expectedRevision: 2, expectedStateVersion: 2 },
      { signal: new AbortController().signal },
    ),
  );
  expect(cart?.structuredContent).toMatchObject({
    ok: true,
    sceneRevision: 2,
    stateVersion: 2,
  });
  const dialog = page.getByRole("dialog", { name: "Review your room" });
  await expect(dialog.getByRole("listitem")).toHaveCount(1);
  await expect(dialog.getByText("Travertine Plinth Table")).toBeVisible();
  await expect(dialog.getByText("$249 USD")).toBeVisible();
  await expect(dialog.getByText(/Scene revision 2/)).toBeVisible();
  expect(await page.evaluate(() => window.__webMcpFetchCount)).toBe(0);
  trackCartRequests = false;
  expect(externalRequestsDuringCart).toEqual([]);

  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "OpenInterior home" }).click();
  await expect(page).toHaveURL("/");
  // `/` is the dashboard whenever WebMCP is present, so it remounts the
  // workspace: exactly six registrations stay live. A `/demo` unmount that
  // stopped aborting would leave twelve behind the same six names.
  await expect
    .poll(() => page.evaluate(() => window.__webMcpActiveRegistrations))
    .toBe(6);
  // The guide is the workspace-free view that proves teardown.
  await page.getByRole("link", { name: "Guide" }).click();
  await expect(page).toHaveURL("/?view=guide");
  await expect
    .poll(() =>
      page.evaluate(() => window.__webMcpActiveToolNames.size),
    )
    .toBe(0);
  await expect
    .poll(() => page.evaluate(() => window.__webMcpActiveRegistrations))
    .toBe(0);
  expect(consoleErrors).toEqual([]);
});
