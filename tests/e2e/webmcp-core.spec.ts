import { expect, test } from "@playwright/test";

import { CORE_TOOL_MANIFEST } from "../../src/webmcp/core-tool-manifest";

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
  description: string;
  execute(
    input: unknown,
    options?: { signal?: AbortSignal },
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
  // Native registration and the local MCP companion must serve one manifest:
  // whatever the page registers here is exactly what `tools/list` reports over
  // stdio, so a description edited on only one side fails here.
  expect(
    await page.evaluate(() =>
      Object.values(window.__webMcpTools)
        .map((tool) => [tool.name, tool.description] as const)
        .sort((left, right) => left[0].localeCompare(right[0])),
    ),
  ).toEqual(
    CORE_TOOL_MANIFEST.map((entry) => [entry.name, entry.description]).sort(
      (left, right) => left[0].localeCompare(right[0]),
    ),
  );

  // The Codex in-app browser invokes `execute(input)` with no options bag at
  // all; a descriptor that needed `options.signal` threw before returning.
  const sceneWithoutOptions = await page.evaluate(() =>
    window.__webMcpTools.get_scene?.execute({}),
  );
  expect(sceneWithoutOptions?.structuredContent).toMatchObject({
    ok: true,
    sceneRevision: 1,
    stateVersion: 1,
  });
  // Facing is derived from `rotation[1]` on the way out: the seed room is
  // unrotated, so every object faces the camera side.
  const seedScene = sceneWithoutOptions?.structuredContent.data as
    | { objects: Array<{ id: string; facing: { x: number; z: number } }> }
    | undefined;
  expect(seedScene?.objects[0]).toMatchObject({
    id: "sofa_01",
    facing: { x: 0, z: 1 },
  });

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
  const diagnostics = page.getByTestId("scene-diagnostics");
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
  await expect(
    dialog.getByText(
      "Approving opens Shopify checkout in a new tab. OpenRoom sends nothing itself.",
    ),
  ).toBeVisible();
  expect(await page.evaluate(() => window.__webMcpFetchCount)).toBe(0);
  trackCartRequests = false;
  expect(externalRequestsDuringCart).toEqual([]);

  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "OpenRoom home" }).click();

  // Orientation can arrive as a facing vector instead of degrees: facing -x is
  // +90° of stored yaw, and the Scene reports the same direction back.
  const beforeFacingMove = await page.evaluate(() =>
    window.__webMcpTools.get_scene?.execute(
      {},
      { signal: new AbortController().signal },
    ),
  );
  const facingMove = await page.evaluate(
    (state) =>
      window.__webMcpTools.move_object?.execute(
        {
          objectId: "chair_01",
          position: { x: 1, z: 0.5 },
          facing: { x: -2, z: 0 },
          expectedRevision: state.sceneRevision,
          expectedStateVersion: state.stateVersion,
        },
        { signal: new AbortController().signal },
      ),
    {
      sceneRevision: beforeFacingMove?.structuredContent.sceneRevision ?? 0,
      stateVersion: beforeFacingMove?.structuredContent.stateVersion ?? 0,
    },
  );
  expect(facingMove?.structuredContent).toMatchObject({
    ok: true,
    sceneRevision: (beforeFacingMove?.structuredContent.sceneRevision ?? 0) + 1,
  });
  const facedScene = await page.evaluate(() =>
    window.__webMcpTools.get_scene?.execute(
      {},
      { signal: new AbortController().signal },
    ),
  );
  const chair = (
    facedScene?.structuredContent.data as
      | {
          objects: Array<{
            id: string;
            rotation: [number, number, number];
            facing: { x: number; z: number };
          }>;
        }
      | undefined
  )?.objects.find((object) => object.id === "chair_01");
  expect(chair?.rotation[1]).toBeCloseTo(Math.PI / 2, 9);
  expect(chair?.facing).toEqual({ x: -1, z: 0 });

  // Spec §5: a lamp moved onto a table stands on it. The Scene reports the
  // supporter, and the lamp's Y is the table height plus half the lamp height,
  // well above the 0.42 m coffee-table top it now rests on.
  // The store lives in the root layout, so a workspace remount can no longer
  // replace it: the revision read here is still current one call later.
  type StackScene = {
    sceneRevision: number;
    stateVersion: number;
    data: {
      objects: Array<{
        id: string;
        position: [number, number, number];
        supportedBy: string | null;
      }>;
    };
  };
  const beforeStack = (await page.evaluate(() =>
    window.__webMcpTools.get_scene?.execute(
      {},
      { signal: new AbortController().signal },
    ),
  ))?.structuredContent as StackScene | undefined;
  const tableBefore = beforeStack?.data.objects.find(
    (object) => object.id === "table_01",
  );
  expect(
    beforeStack?.data.objects.find((object) => object.id === "lamp_01")
      ?.supportedBy,
  ).toBeNull();
  const stackMove = await page.evaluate(
    (state) =>
      window.__webMcpTools.move_object?.execute(
        {
          objectId: "lamp_01",
          position: { x: state.x, z: state.z },
          expectedRevision: state.sceneRevision,
          expectedStateVersion: state.stateVersion,
        },
        { signal: new AbortController().signal },
      ),
    {
      x: tableBefore?.position[0] ?? 0,
      z: tableBefore?.position[2] ?? 0,
      sceneRevision: beforeStack?.sceneRevision ?? 0,
      stateVersion: beforeStack?.stateVersion ?? 0,
    },
  );
  expect(stackMove?.structuredContent.ok).toBe(true);
  const stackedLamp = (
    stackMove?.structuredContent.data as
      | {
          scene: {
            objects: Array<{
              id: string;
              position: [number, number, number];
              supportedBy: string | null;
            }>;
          };
        }
      | undefined
  )?.scene.objects.find((object) => object.id === "lamp_01");
  expect(stackedLamp?.supportedBy).toBe("table_01");
  expect(stackedLamp?.position[1]).toBeGreaterThan(0.42);

  await page.getByRole("link", { name: "OpenRoom home" }).click();
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
