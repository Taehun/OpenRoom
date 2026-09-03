import { expect, test, type Locator, type Page } from "@playwright/test";

import { PHOTO_ASSETS } from "../../src/features/photo/photo-assets";
import { hasCirculationPath } from "../../src/features/placement/circulation";
import {
  footprintsOverlap,
  objectFootprint,
  openingClearanceZones,
} from "../../src/features/placement/footprint-geometry";
import type { Scene } from "../../src/features/scene/scene-schema";

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

type BrowserScene = Scene;

interface CartRequestObservation {
  method: string;
  resourceType: string;
  url: string;
}

declare global {
  interface Window {
    // Names collapse when two workspaces register the same tool; the counter
    // is what distinguishes a live leak from a clean re-registration.
    __photoActiveRegistrations: number;
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

// `replace_object` and `move_object` wrap the committed Scene next to their
// message, unlike `get_scene` which returns it directly.
function committedSceneFrom(result: BrowserToolResult) {
  return (result.structuredContent.data as { scene: BrowserScene }).scene;
}

function selectedObjectId(result: BrowserToolResult) {
  return (result.structuredContent.data as { id: string }).id;
}

// The chosen view replaces the old CSS rotation: a cutout is never tilted, so the
// truthful part of its presentation is which registered view is drawn and whether
// it is mirrored. Both live on the frame, which is the element itself or its ancestor.
async function visualPlacement(layer: Locator) {
  return layer.evaluate((element) => {
    const style = (element as HTMLElement).style;
    const frame = (element as HTMLElement).closest<HTMLElement>(
      '[data-testid^="photo-object-frame-"]',
    );
    return {
      left: style.getPropertyValue("--photo-left"),
      mirrored: frame?.getAttribute("data-photo-mirrored") ?? null,
      scale: style.getPropertyValue("--photo-scale"),
      top: style.getPropertyValue("--photo-top"),
      view: frame?.getAttribute("data-photo-view") ?? null,
      width: style.getPropertyValue("--photo-width"),
      zIndex: style.zIndex,
    };
  });
}

/** Every rendered frame transform, so a stray CSS rotation cannot hide. */
async function objectFrameTransforms(page: Page) {
  return page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[data-testid^="photo-object-frame-"]',
      ),
    ].map((frame) => frame.style.transform),
  );
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

/**
 * The point inside an object's rendered box that is closest to its center and still
 * hit-tests to that object. Photo cutouts overlap on the stage, so a neighbour's layer
 * can own the geometric center; a human aims at a pixel the object itself owns.
 */
async function pointerGrabPoint(stage: Locator, objectId: string) {
  const point = await stage.evaluate((stageElement, id) => {
    const target = stageElement.querySelector(`[data-object-id="${id}"]`);
    if (!target) throw new Error(`Missing stage object ${id}`);

    const bounds = target.getBoundingClientRect();
    const center = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    };
    const steps = 12;
    let closest: { distance: number; x: number; y: number } | null = null;

    for (let row = 1; row < steps; row += 1) {
      for (let column = 1; column < steps; column += 1) {
        const x = bounds.x + (bounds.width * column) / steps;
        const y = bounds.y + (bounds.height * row) / steps;
        const owner = document
          .elementFromPoint(x, y)
          ?.closest<HTMLElement>("[data-object-id]");
        if (owner?.dataset.objectId !== id) continue;

        const distance = Math.hypot(x - center.x, y - center.y);
        if (closest === null || distance < closest.distance) {
          closest = { distance, x, y };
        }
      }
    }

    return closest === null ? null : { x: closest.x, y: closest.y };
  }, objectId);

  if (!point) throw new Error(`No pointer-reachable pixel for ${objectId}`);
  return point;
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

// The deliberately poor but schema-valid layout the explicit-arrangement and
// performance journeys start from, applied through `move_object`.
const POOR_TARGETS = {
  sofa_01: { x: -1.8, z: 0.2 },
  table_01: { x: 1.2, z: 0.8 },
  rug_01: { x: 0.9, z: 0.9 },
  lamp_01: { x: 0.2, z: 1.8 },
  chair_01: { x: 2.2, z: -0.7 },
  plant_01: { x: -2.3, z: -1.5 },
} as const;

// Every non-rug object, with the rail control that selects it so its floor marker renders.
const VERTICAL_OBJECTS = [
  { objectId: "sofa_01", label: "Sofa" },
  { objectId: "table_01", label: "Coffee table" },
  { objectId: "lamp_01", label: "Floor lamp" },
  { objectId: "chair_01", label: "Chair" },
  { objectId: "plant_01", label: "Plant" },
] as const;

interface SceneTokens {
  revision: number;
  stateVersion: number;
}

function changedObjectIds(before: BrowserScene, after: BrowserScene) {
  return after.objects
    .filter((object) => {
      const previous = before.objects.find(({ id }) => id === object.id);
      return previous !== undefined &&
        (previous.position[0] !== object.position[0] ||
          previous.position[2] !== object.position[2]);
    })
    .map(({ id }) => id);
}

function placementStatus(page: Page) {
  return page.getByRole("status", { name: "Placement status" });
}

// The status region holds the message span next to an optional Undo control, so
// the message itself is asserted on the span to keep an exact-text assertion.
function placementMessage(page: Page) {
  return placementStatus(page).locator("span");
}

function arrangeControl(page: Page) {
  return page.getByRole("button", { name: "Arrange naturally" });
}

function undoPlacementControl(page: Page) {
  return page.getByRole("button", { name: "Undo placement" });
}

async function captureModelContextTools(page: Page) {
  await page.addInitScript(() => {
    window.__photoActiveRegistrations = 0;
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
          window.__photoActiveRegistrations += 1;
          options?.signal?.addEventListener(
            "abort",
            () => {
              window.__photoActiveToolNames.delete(tool.name);
              window.__photoActiveRegistrations -= 1;
            },
            { once: true },
          );
        },
      },
    });
  });
}

async function expectCore6Registered(page: Page) {
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
}

/**
 * Runs the six-product redesign through the Core 6 tools and asserts the exact
 * automatic-arrangement trigger: replacements one through five leave every X/Z
 * untouched, and only the sixth — the completion transition — arranges the room
 * inside the same replace revision.
 */
async function redesignRoomThroughCore6(page: Page): Promise<SceneTokens> {
  const initial = await callTool(page, "get_scene", {});
  expect(initial.structuredContent.ok).toBe(true);
  let revision = initial.structuredContent.sceneRevision;
  let stateVersion = initial.structuredContent.stateVersion;
  let scene = sceneFrom(initial);

  for (const [index, replacement] of REPLACEMENTS.entries()) {
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

    const replacedScene = committedSceneFrom(replaced);
    if (index < REPLACEMENTS.length - 1) {
      expect(changedObjectIds(scene, replacedScene)).toEqual([]);
      await expect(placementStatus(page)).toHaveCount(0);
    } else {
      await expect(placementStatus(page)).toHaveText("Redesign arranged");
      expect(changedObjectIds(scene, replacedScene).length).toBeGreaterThan(1);
    }

    revision = replaced.structuredContent.sceneRevision;
    stateVersion = replaced.structuredContent.stateVersion;
    scene = replacedScene;
  }

  expect(revision).toBe(initial.structuredContent.sceneRevision + 6);
  return { revision, stateVersion };
}

async function currentTokens(page: Page): Promise<SceneTokens> {
  const scene = await callTool(page, "get_scene", {});
  expect(scene.structuredContent.ok).toBe(true);
  return {
    revision: scene.structuredContent.sceneRevision,
    stateVersion: scene.structuredContent.stateVersion,
  };
}

async function moveObject(
  page: Page,
  tokens: SceneTokens,
  objectId: string,
  position: { x: number; z: number },
): Promise<SceneTokens> {
  const moved = await callTool(page, "move_object", {
    objectId,
    expectedRevision: tokens.revision,
    expectedStateVersion: tokens.stateVersion,
    position,
  });
  expect(moved.structuredContent.ok).toBe(true);
  expect(moved.structuredContent.sceneRevision).toBe(tokens.revision + 1);
  expect(moved.structuredContent.stateVersion).toBe(tokens.stateVersion + 1);

  return {
    revision: moved.structuredContent.sceneRevision,
    stateVersion: moved.structuredContent.stateVersion,
  };
}

async function applyPoorLayout(
  page: Page,
  tokens: SceneTokens,
): Promise<SceneTokens> {
  let current = tokens;
  for (const [objectId, position] of Object.entries(POOR_TARGETS)) {
    current = await moveObject(page, current, objectId, position);
  }

  return current;
}

function nonRugFootprints(scene: BrowserScene) {
  return scene.objects
    .filter(({ type }) => type !== "rug")
    .map((object) => objectFootprint(object));
}

function collidingObjectIds(scene: BrowserScene) {
  const footprints = nonRugFootprints(scene);
  const collisions: string[] = [];

  for (let first = 0; first < footprints.length; first += 1) {
    for (let second = first + 1; second < footprints.length; second += 1) {
      if (footprintsOverlap(footprints[first]!, footprints[second]!)) {
        collisions.push(
          `${footprints[first]!.objectId}/${footprints[second]!.objectId}`,
        );
      }
    }
  }

  return collisions;
}

function openingBlockingObjectIds(scene: BrowserScene) {
  const zones = openingClearanceZones(scene);
  return scene.objects
    .filter((object) =>
      zones.some((zone) => footprintsOverlap(objectFootprint(object), zone)),
    )
    .map(({ id }) => id);
}

function reachesOpening(scene: BrowserScene) {
  return hasCirculationPath(
    scene,
    scene.objects.map((object) => objectFootprint(object)),
    scene.objects.filter(({ type }) => type === "rug"),
  );
}

function placementSignature(scene: BrowserScene) {
  return scene.objects.map(({ id, position, rotation }) => ({
    id,
    rotationY: rotation[1],
    x: position[0],
    z: position[2],
  }));
}

async function computedLayer(locator: Locator) {
  return Number(
    await locator.evaluate((element) => getComputedStyle(element).zIndex),
  );
}

/**
 * Distance, in stage CSS pixels, between every registered floor-quad corner as the
 * browser actually renders it and the destination polygon the rug projection asked for.
 *
 * The rug image carries the projective `matrix3d` about `transform-origin: 0 0`, so a
 * source corner in intrinsic image pixels lands at `layoutOffset + matrix · corner`:
 * `layoutOffset` is the image's untransformed position inside the stage, which the
 * offsetParent chain still reports because transforms never move layout boxes, and the
 * homogeneous divide is applied here because `DOMMatrix.transformPoint` leaves `w`
 * undivided.
 */
async function rugCornerDeviations(
  stage: Locator,
  objectId: string,
  sourceQuad: readonly { x: number; y: number }[],
  intrinsic: { height: number; width: number },
) {
  return stage.evaluate(
    (stageElement, { corners, height, id, width }) => {
      const visual = stageElement.querySelector<HTMLElement>(
        `[data-testid="photo-rug-visual-${id}"]`,
      );
      const button = stageElement.querySelector<HTMLElement>(
        `[data-object-id="${id}"]`,
      );
      const image = visual?.querySelector("img");
      const destinationQuad = button?.dataset.destinationQuad;
      if (!visual || !image || !destinationQuad) {
        throw new Error(`Missing floor projection markers for ${id}`);
      }

      const stageBounds = stageElement.getBoundingClientRect();
      const destination = destinationQuad.split(" ").map((pair) => {
        const [x, y] = pair.split(",").map(Number);
        return { x: x * stageBounds.width, y: y * stageBounds.height };
      });

      let offsetX = 0;
      let offsetY = 0;
      let node: HTMLElement | null = image;
      while (node !== null && node !== stageElement) {
        offsetX += node.offsetLeft;
        offsetY += node.offsetTop;
        node = node.offsetParent as HTMLElement | null;
      }
      if (node !== stageElement) {
        throw new Error(`Rug ${id} is not laid out inside the stage`);
      }

      const matrix = new DOMMatrix(getComputedStyle(image).transform);
      return corners.map(({ x, y }, index) => {
        const projected = matrix.transformPoint(
          new DOMPoint(x * width, y * height, 0, 1),
        );
        const target = destination[index];
        return Math.hypot(
          offsetX + projected.x / projected.w - target.x,
          offsetY + projected.y / projected.w - target.y,
        );
      });
    },
    {
      corners: sourceQuad.map(({ x, y }) => ({ x, y })),
      height: intrinsic.height,
      id: objectId,
      width: intrinsic.width,
    },
  );
}

/**
 * Stage-pixel offset between a vertical object's contact-shadow center and the floor
 * marker it is anchored to. Both are rotated about their own centers, so the center of
 * each rendered box is the projected floor point itself.
 */
async function contactShadowOffset(stage: Locator, objectId: string) {
  return stage.evaluate((stageElement, id) => {
    const anchor = stageElement.querySelector(
      `[data-testid="photo-floor-anchor-${id}"]`,
    );
    const shadow = stageElement.querySelector(
      `[data-testid="photo-contact-shadow-${id}"]`,
    );
    if (!anchor || !shadow) {
      throw new Error(`Missing floor grounding markers for ${id}`);
    }

    const anchorBounds = anchor.getBoundingClientRect();
    const shadowBounds = shadow.getBoundingClientRect();
    return {
      x: Math.abs(
        anchorBounds.x +
          anchorBounds.width / 2 -
          (shadowBounds.x + shadowBounds.width / 2),
      ),
      y: Math.abs(
        anchorBounds.y +
          anchorBounds.height / 2 -
          (shadowBounds.y + shadowBounds.height / 2),
      ),
    };
  }, objectId);
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
  await captureModelContextTools(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/demo");
  appOrigin = new URL(page.url()).origin;

  const stage = page.getByRole("region", { name: "Editable room photo" });
  await expectLampVisibleBeyondChair(stage);

  await expectCore6Registered(page);

  await redesignRoomThroughCore6(page);
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

  const { x: startX, y: startY } = await pointerGrabPoint(stage, "table_01");
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

  const staleTarget = { x: 1.25, z: -0.75 };
  expect(afterUndoTable?.position[0]).not.toBe(staleTarget.x);
  expect(afterUndoTable?.position[2]).not.toBe(staleTarget.z);
  const placementBeforeStaleMove = await visualPlacement(table);
  const sceneBeforeStaleMove = sceneFrom(afterUndo);
  const staleMove = await callTool(page, "move_object", {
    objectId: "table_01",
    expectedRevision: afterUndo.structuredContent.sceneRevision - 1,
    expectedStateVersion: afterUndo.structuredContent.stateVersion,
    position: staleTarget,
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

  await page.getByRole("link", { name: "OpenInterior home" }).click();
  await expect(page).toHaveURL("/");
  // `/` is the dashboard whenever WebMCP is present, so it remounts the
  // workspace: exactly six registrations stay live. A `/demo` unmount that
  // stopped aborting would leave twelve behind the same six names.
  await expect
    .poll(() => page.evaluate(() => window.__photoActiveRegistrations))
    .toBe(6);
  // The guide is the workspace-free view that proves teardown.
  await page.getByRole("link", { name: "Guide" }).click();
  await expect(page).toHaveURL("/?view=guide");
  await expect
    .poll(() =>
      page.evaluate(() => [...window.__photoActiveToolNames].sort()),
    )
    .toEqual([]);
  await expect
    .poll(() => page.evaluate(() => window.__photoActiveRegistrations))
    .toBe(0);
  expect(consoleErrors).toEqual([]);
});

test("arranges the room explicitly, settles, and restores it with one undo", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await captureModelContextTools(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/demo");
  await expectCore6Registered(page);

  const poorTokens = await applyPoorLayout(
    page,
    await redesignRoomThroughCore6(page),
  );
  const poor = await callTool(page, "get_scene", {});
  const poorScene = sceneFrom(poor);
  const poorSelection = await callTool(page, "get_selection", {});
  expect(poor.structuredContent.sceneRevision).toBe(poorTokens.revision);
  expect(poor.structuredContent.stateVersion).toBe(poorTokens.stateVersion);
  // `move_object` clamps X into the room inset, so the saved layout is whatever the tool
  // committed rather than the requested literals.
  const savedPlacement = placementSignature(poorScene);

  await arrangeControl(page).click();
  await expect(placementMessage(page)).toHaveText("Placement improved");
  await expect(undoPlacementControl(page)).toBeVisible();

  const arranged = await callTool(page, "get_scene", {});
  const arrangedScene = sceneFrom(arranged);
  expect(arranged.structuredContent.sceneRevision).toBe(
    poorTokens.revision + 1,
  );
  expect(arranged.structuredContent.stateVersion).toBe(
    poorTokens.stateVersion + 1,
  );
  const arrangedSelection = await callTool(page, "get_selection", {});
  // The selected object's own transform is expected to move; only the selection itself
  // has to survive the arrangement.
  expect(selectedObjectId(arrangedSelection)).toBe(
    selectedObjectId(poorSelection),
  );
  expect(arrangedScene.selectedObjectId).toBe(poorScene.selectedObjectId);
  expect(collidingObjectIds(arrangedScene)).toEqual([]);
  expect(openingBlockingObjectIds(arrangedScene)).toEqual([]);
  expect(reachesOpening(arrangedScene)).toBe(true);
  expect(placementSignature(arrangedScene)).not.toEqual(savedPlacement);

  // The solver turns the chair a quarter turn to flank the sofa's right end and face the
  // table (spec 8.5). Only the photographed front-quarter pair is registered, whose
  // native front is turned to the viewer's right, so a chair facing the other way is
  // shown by that same cutout mirrored - never by a CSS rotation.
  const arrangedChair = arrangedScene.objects.find(
    (object) => object.id === "chair_01",
  );
  const arrangedSofa = arrangedScene.objects.find(
    (object) => object.id === "sofa_01",
  );
  if (!arrangedChair || !arrangedSofa) {
    throw new Error("Missing chair_01 or sofa_01 after arranging");
  }
  expect(arrangedChair.rotation[1]).toBeCloseTo(Math.PI / 4, 9);
  expect(arrangedChair.position[0]).toBeGreaterThan(arrangedSofa.position[0] + 1.2);
  const chairFrame = page.getByTestId("photo-object-frame-chair_01");
  await expect(chairFrame).toHaveAttribute("data-photo-mirrored", "true");
  await expect(chairFrame).toHaveAttribute("data-photo-view", "front-quarter");
  const arrangedTransforms = await objectFrameTransforms(page);
  expect(arrangedTransforms).toHaveLength(5);
  for (const transform of arrangedTransforms) {
    expect(transform).not.toContain("rotate(");
  }

  await arrangeControl(page).click();
  await expect(placementStatus(page)).toHaveText(
    "Current placement is already the safest option",
  );
  await expect(undoPlacementControl(page)).toHaveCount(0);
  const settled = await callTool(page, "get_scene", {});
  expect(settled.structuredContent.sceneRevision).toBe(
    arranged.structuredContent.sceneRevision,
  );
  expect(settled.structuredContent.stateVersion).toBe(
    arranged.structuredContent.stateVersion,
  );
  expect(sceneFrom(settled)).toEqual(arrangedScene);

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  const restored = await callTool(page, "get_scene", {});
  expect(placementSignature(sceneFrom(restored))).toEqual(savedPlacement);
  expect(restored.structuredContent.sceneRevision).toBe(poorTokens.revision);
  expect(restored.structuredContent.stateVersion).toBe(
    settled.structuredContent.stateVersion + 1,
  );
  await expect(placementStatus(page)).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});

test("grounds the redesigned room on the photo floor plane", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await captureModelContextTools(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/demo");
  await expectCore6Registered(page);

  await redesignRoomThroughCore6(page);
  const stage = page.getByRole("region", { name: "Editable room photo" });
  const objectRail = page.getByRole("region", { name: "Objects in room" });
  const redesignedScene = sceneFrom(await callTool(page, "get_scene", {}));
  const rugs = redesignedScene.objects.filter(({ type }) => type === "rug");
  expect(rugs.map(({ id }) => id)).toEqual(["rug_01"]);

  for (const rug of rugs) {
    const asset = rug.assetId ? PHOTO_ASSETS[rug.assetId] : undefined;
    const floorQuad = asset?.floorQuad;
    if (!asset || !floorQuad) throw new Error(`Missing floor quad for ${rug.id}`);

    await expect(
      stage.locator(`[data-testid="photo-rug-visual-${rug.id}"]`),
    ).toHaveAttribute("data-floor-projected", "true");
    const deviations = await rugCornerDeviations(stage, rug.id, floorQuad, {
      height: asset.intrinsicHeight,
      width: asset.intrinsicWidth,
    });
    expect(deviations).toHaveLength(4);
    for (const deviation of deviations) expect(deviation).toBeLessThan(1);
  }

  for (const { label, objectId } of VERTICAL_OBJECTS) {
    await objectRail.getByRole("button", { name: label, exact: true }).click();
    await expect(
      stage.locator(`[data-testid="photo-floor-anchor-${objectId}"]`),
    ).toHaveCount(1);
    const offset = await contactShadowOffset(stage, objectId);
    expect(offset.x).toBeLessThan(1);
    expect(offset.y).toBeLessThan(1);
  }

  const rugLayer = await computedLayer(stage.locator('[data-object-id="rug_01"]'));
  for (const { objectId } of VERTICAL_OBJECTS) {
    expect(rugLayer).toBeLessThan(
      await computedLayer(
        stage.locator(`[data-testid="photo-object-frame-${objectId}"]`),
      ),
    );
  }

  // Two verticals at one depth tie on projected depth, so only the sorted object ids can
  // separate them; swapping their X must not reorder the rendered layers.
  const chair = stage.locator('[data-testid="photo-object-frame-chair_01"]');
  const lamp = stage.locator('[data-testid="photo-object-frame-lamp_01"]');
  // Selecting each object bumped the state version, so the tie moves need fresh tokens.
  let tokens = await currentTokens(page);
  tokens = await moveObject(page, tokens, "chair_01", { x: -1.2, z: 0.4 });
  tokens = await moveObject(page, tokens, "lamp_01", { x: 1.2, z: 0.4 });
  const tiedChairPlacement = await visualPlacement(chair);
  expect((await visualPlacement(lamp)).top).toBe(tiedChairPlacement.top);
  const tiedChairLayer = await computedLayer(chair);
  const tiedLampLayer = await computedLayer(lamp);
  expect(tiedChairLayer).toBeLessThan(tiedLampLayer);

  tokens = await moveObject(page, tokens, "chair_01", { x: 1.2, z: 0.4 });
  await moveObject(page, tokens, "lamp_01", { x: -1.2, z: 0.4 });
  expect((await visualPlacement(lamp)).top).toBe(tiedChairPlacement.top);
  expect(await computedLayer(chair)).toBe(tiedChairLayer);
  expect(await computedLayer(lamp)).toBe(tiedLampLayer);
  expect(consoleErrors).toEqual([]);
});

test("keeps natural placement below 16ms p95 in the browser", async ({
  page,
}) => {
  // The 16ms p95 target is a production-build measurement on the project's
  // reference machine (see the natural-placement spec §6.2 and the Task 8
  // gate). Shared CI runners serve the dev build on slower CPUs, so the gate
  // is skipped there and stays authoritative locally.
  test.skip(
    Boolean(process.env.CI),
    "performance gate runs on the reference machine against a production build",
  );
  await captureModelContextTools(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/demo");
  await expectCore6Registered(page);

  await applyPoorLayout(page, await redesignRoomThroughCore6(page));

  // The completion transition already measured one proposal; only the 30 explicit
  // requests below are sampled.
  await page.evaluate(() => performance.clearMeasures("openinterior-natural-placement"));
  const arrange = arrangeControl(page);
  const message = placementMessage(page);
  for (let index = 0; index < 30; index += 1) {
    await arrange.click();
    await expect(message).toHaveText(
      index === 0
        ? "Placement improved"
        : "Current placement is already the safest option",
    );
  }

  const durations = await page.evaluate(() =>
    performance
      .getEntriesByName("openinterior-natural-placement")
      .map(({ duration }) => duration)
      .sort((first, second) => first - second),
  );
  const p95 = durations[Math.ceil(durations.length * 0.95) - 1]!;

  expect(durations).toHaveLength(30);
  expect(p95).toBeLessThan(16);
});
