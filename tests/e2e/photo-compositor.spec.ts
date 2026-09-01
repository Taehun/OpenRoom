import { expect, test, type Locator, type Page } from "@playwright/test";

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

interface CapturedTool {
  name: string;
  execute(
    input: unknown,
    options: { signal: AbortSignal },
  ): Promise<BrowserToolResult>;
}

interface BrowserSceneObject {
  assetId?: string;
  id: string;
  position: [number, number, number];
  product?: { id: string };
  source: string;
}

interface BrowserScene {
  objects: BrowserSceneObject[];
  revision: number;
}

interface CartRequestObservation {
  method: string;
  resourceType: string;
  url: string;
}

declare global {
  interface Window {
    __photoActiveToolNames: Set<string>;
    __photoFetchCount: number;
    __photoTools: Record<string, CapturedTool>;
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

const REPLACEMENTS = [
  {
    objectId: "sofa_01",
    category: "sofa",
    productId: "boucle-curve-sofa",
    title: "Boucle Curve Sofa",
  },
  {
    objectId: "table_01",
    category: "coffee_table",
    productId: "travertine-plinth-table",
    title: "Travertine Plinth Table",
  },
  {
    objectId: "rug_01",
    category: "rug",
    productId: "wool-pebble-rug",
    title: "Wool Pebble Rug",
  },
  {
    objectId: "lamp_01",
    category: "floor_lamp",
    productId: "linen-dome-lamp",
    title: "Linen Dome Lamp",
  },
  {
    objectId: "chair_01",
    category: "chair",
    productId: "boucle-barrel-chair",
    title: "Boucle Barrel Chair",
  },
  {
    objectId: "plant_01",
    category: "plant",
    productId: "stone-planter-ficus",
    title: "Stone Planter Ficus",
  },
] as const;

async function callTool(page: Page, name: string, input: unknown) {
  return page.evaluate(
    async ({ toolName, toolInput }) => {
      const tool = window.__photoTools[toolName];
      if (!tool) throw new Error(`Missing captured tool ${toolName}`);
      return tool.execute(toolInput, {
        signal: new AbortController().signal,
      });
    },
    { toolName: name, toolInput: input },
  );
}

function sceneFrom(result: BrowserToolResult) {
  return result.structuredContent.data as BrowserScene;
}

async function visualPlacement(layer: Locator) {
  return layer.evaluate((element) => {
    const style = (element as HTMLElement).style;
    return {
      left: style.getPropertyValue("--photo-left"),
      rotation: style.getPropertyValue("--photo-rotation"),
      scale: style.getPropertyValue("--photo-scale"),
      top: style.getPropertyValue("--photo-top"),
      width: style.getPropertyValue("--photo-width"),
      zIndex: style.zIndex,
    };
  });
}

async function largestExposedHorizontalEdgeRatio(
  layer: Locator,
  occluder: Locator,
) {
  const [layerBounds, occluderBounds] = await Promise.all([
    layer.boundingBox(),
    occluder.boundingBox(),
  ]);
  if (!layerBounds || !occluderBounds) {
    throw new Error("Missing photo layer bounds");
  }

  const layerRight = layerBounds.x + layerBounds.width;
  const occluderRight = occluderBounds.x + occluderBounds.width;
  const exposedLeft = Math.max(
    0,
    Math.min(layerRight, occluderBounds.x) - layerBounds.x,
  );
  const exposedRight = Math.max(
    0,
    layerRight - Math.max(layerBounds.x, occluderRight),
  );

  return Math.max(exposedLeft, exposedRight) / layerBounds.width;
}

async function expectLampVisibleBeyondChair(stage: Locator) {
  const lamp = stage.locator('[data-object-id="lamp_01"]');
  const chair = stage.locator('[data-object-id="chair_01"]');
  await expect(lamp).toBeVisible();
  await expect(chair).toBeVisible();
  expect(await largestExposedHorizontalEdgeRatio(lamp, chair)).toBeGreaterThan(
    0.2,
  );
}

test("redesigns the whole photo room through Core 6 and preserves human transforms", async ({
  page,
}) => {
  const cartRequests: CartRequestObservation[] = [];
  const consoleErrors: string[] = [];
  const externalRequestsDuringCart: string[] = [];
  let appOrigin = "";
  let trackCartRequests = false;

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const requestOrigin = new URL(request.url()).origin;
    if (trackCartRequests) {
      cartRequests.push({
        method: request.method(),
        resourceType: request.resourceType(),
        url: request.url(),
      });
      if (appOrigin !== "" && requestOrigin !== appOrigin) {
        externalRequestsDuringCart.push(request.url());
      }
    }
    await route.continue();
  });
  await page.addInitScript(() => {
    window.__photoActiveToolNames = new Set();
    window.__photoFetchCount = 0;
    window.__photoTools = {};
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        async registerTool(
          tool: CapturedTool,
          options?: { signal?: AbortSignal },
        ) {
          window.__photoTools[tool.name] = tool;
          window.__photoActiveToolNames.add(tool.name);
          options?.signal?.addEventListener(
            "abort",
            () => window.__photoActiveToolNames.delete(tool.name),
            { once: true },
          );
        },
      },
    });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/demo");
  appOrigin = new URL(page.url()).origin;

  const stage = page.getByRole("region", { name: "Editable room photo" });
  await expectLampVisibleBeyondChair(stage);

  await expect
    .poll(() =>
      page.evaluate(() => Object.keys(window.__photoTools).sort()),
    )
    .toEqual([...CORE_6]);
  await expect
    .poll(() =>
      page.evaluate(() => [...window.__photoActiveToolNames].sort()),
    )
    .toEqual([...CORE_6]);
  await expect(page.locator("canvas")).toHaveCount(0);

  const initial = await callTool(page, "get_scene", {});
  expect(initial.structuredContent.ok).toBe(true);
  let revision = initial.structuredContent.sceneRevision;
  let stateVersion = initial.structuredContent.stateVersion;

  for (const replacement of REPLACEMENTS) {
    const search = await callTool(page, "search_products", {
      category: replacement.category,
      limit: 3,
    });
    expect(search.structuredContent).toMatchObject({
      ok: true,
      sceneRevision: revision,
      stateVersion,
    });
    const results = search.structuredContent.data as {
      results: Array<{ id: string }>;
    };
    expect(results.results[1]?.id).toBe(replacement.productId);

    const replaced = await callTool(page, "replace_object", {
      objectId: replacement.objectId,
      productId: replacement.productId,
      expectedRevision: revision,
      expectedStateVersion: stateVersion,
    });
    expect(replaced.structuredContent.ok).toBe(true);
    expect(replaced.structuredContent.sceneRevision).toBe(revision + 1);
    expect(replaced.structuredContent.stateVersion).toBe(stateVersion + 1);
    revision = replaced.structuredContent.sceneRevision;
    stateVersion = replaced.structuredContent.stateVersion;
  }

  expect(revision).toBe(initial.structuredContent.sceneRevision + 6);
  const redesigned = await callTool(page, "get_scene", {});
  const redesignedScene = sceneFrom(redesigned);
  expect(
    redesignedScene.objects.filter(
      (object) => object.source === "product" && object.product,
    ),
  ).toHaveLength(6);
  expect(
    redesignedScene.objects.map((object) => ({
      assetId: object.assetId,
      id: object.id,
      productId: object.product?.id,
    })),
  ).toEqual(
    REPLACEMENTS.map(({ objectId, productId }) => ({
      assetId: productId,
      id: objectId,
      productId,
    })),
  );

  const objectRail = page.getByRole("region", { name: "Objects in room" });
  const stageBounds = await stage.boundingBox();
  if (!stageBounds) throw new Error("Missing editable photo bounds");
  expect(stageBounds.width / stageBounds.height).toBeCloseTo(16 / 9, 2);
  await expect(stage.locator('[data-object-id]')).toHaveCount(6);
  await expect(objectRail.getByRole("button")).toHaveCount(6);
  for (const { objectId, productId } of REPLACEMENTS) {
    await expect(
      stage.locator(`[data-object-id="${objectId}"] img`),
    ).toHaveAttribute("src", `/demo/photo/products/${productId}.webp`);
  }
  await expectLampVisibleBeyondChair(stage);

  const table = stage.locator('[data-object-id="table_01"]');
  const beforeDrag = await callTool(page, "get_scene", {});
  const beforeDragScene = sceneFrom(beforeDrag);
  const beforeDragTable = beforeDragScene.objects.find(
    (object) => object.id === "table_01",
  );
  if (!beforeDragTable) throw new Error("Missing table_01 before drag");
  const beforeDragPosition = structuredClone(beforeDragTable.position);
  const beforeDragPlacement = await visualPlacement(table);
  const tableBounds = await table.boundingBox();
  if (!tableBounds) throw new Error("Missing table_01 bounds");

  const startX = tableBounds.x + tableBounds.width / 2;
  const startY = tableBounds.y + tableBounds.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 70, startY - 30, { steps: 5 });
  await page.mouse.up();

  const afterDrag = await callTool(page, "get_scene", {});
  const afterDragTable = sceneFrom(afterDrag).objects.find(
    (object) => object.id === "table_01",
  );
  if (!afterDragTable) throw new Error("Missing table_01 after drag");
  expect(afterDrag.structuredContent.sceneRevision).toBe(
    beforeDrag.structuredContent.sceneRevision + 1,
  );
  expect(afterDragTable.position).not.toEqual(beforeDragPosition);
  expect(await visualPlacement(table)).not.toEqual(beforeDragPlacement);

  await page.getByRole("button", { name: "Undo" }).click();
  const afterUndo = await callTool(page, "get_scene", {});
  const afterUndoTable = sceneFrom(afterUndo).objects.find(
    (object) => object.id === "table_01",
  );
  expect(afterUndoTable?.position).toEqual(beforeDragPosition);
  expect(await visualPlacement(table)).toEqual(beforeDragPlacement);

  const placementBeforeStaleMove = await visualPlacement(table);
  const sceneBeforeStaleMove = sceneFrom(afterUndo);
  const staleMove = await callTool(page, "move_object", {
    objectId: "table_01",
    expectedRevision: afterUndo.structuredContent.sceneRevision - 1,
    expectedStateVersion: afterUndo.structuredContent.stateVersion,
    position: { x: 0, z: 0 },
  });
  expect(staleMove.structuredContent).toMatchObject({
    ok: false,
    sceneRevision: afterUndo.structuredContent.sceneRevision,
    stateVersion: afterUndo.structuredContent.stateVersion,
    error: {
      code: "SCENE_REVISION_CONFLICT",
      latestRevision: afterUndo.structuredContent.sceneRevision,
      latestStateVersion: afterUndo.structuredContent.stateVersion,
    },
  });
  const sceneAfterStaleMove = await callTool(page, "get_scene", {});
  expect(sceneFrom(sceneAfterStaleMove)).toEqual(sceneBeforeStaleMove);
  expect(await visualPlacement(table)).toEqual(placementBeforeStaleMove);

  await page.evaluate(() => {
    const originalFetch = window.fetch;
    window.fetch = (...args) => {
      window.__photoFetchCount += 1;
      return originalFetch(...args);
    };
  });
  trackCartRequests = true;
  const cart = await callTool(page, "add_scene_to_cart", {
    expectedRevision: sceneAfterStaleMove.structuredContent.sceneRevision,
    expectedStateVersion: sceneAfterStaleMove.structuredContent.stateVersion,
  });
  expect(cart.structuredContent.ok).toBe(true);
  const dialog = page.getByRole("dialog", { name: "Review your room" });
  await expect(dialog.getByRole("listitem")).toHaveCount(6);
  for (const { title } of REPLACEMENTS) {
    await expect(dialog.getByText(title)).toBeVisible();
  }
  await dialog.getByRole("button", { name: /Approve Scene cart/ }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => window.__photoFetchCount)).toBe(0);
  trackCartRequests = false;
  expect(
    cartRequests.filter(
      ({ method }) => !["GET", "HEAD", "OPTIONS"].includes(method),
    ),
  ).toEqual([]);
  expect(
    cartRequests.filter(({ url }) =>
      /(?:^|\/)(?:api\/)?(?:cart|checkout)(?:\/|$)/i.test(
        new URL(url).pathname,
      ),
    ),
  ).toEqual([]);
  expect(externalRequestsDuringCart).toEqual([]);

  await page.getByRole("link", { name: "Nook home" }).click();
  await expect(page).toHaveURL("/");
  await expect
    .poll(() =>
      page.evaluate(() => [...window.__photoActiveToolNames].sort()),
    )
    .toEqual([]);
  expect(consoleErrors).toEqual([]);
});
