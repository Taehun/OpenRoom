import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  floorDepthFraction,
  objectElevationOffset,
  objectVisualWidth,
  projectRoomPoint,
  supportedTopOffset,
  verticalScaleAt,
  type CutoutPresentation,
} from "../../src/features/photo/photo-projection";
import { getPhotoAssetSet } from "../../src/features/photo/photo-views";
import { selectPhotoView } from "../../src/features/photo/photo-views";
import { createDemoScene } from "../../src/demo/demo-scene";
import { DEMO_PRODUCTS } from "../../src/features/demo/demo-data";
import { RoomPhotoStage } from "../../src/features/photo/room-photo-stage";
import { SceneStoreProvider } from "../../src/features/scene/scene-context";
import type {
  CommandResult,
  SceneObject,
} from "../../src/features/scene/scene-schema";
import { createSceneStore } from "../../src/features/scene/scene-store";
import { supportOf } from "../../src/features/scene/support";

const STAGE_RECT = {
  bottom: 676,
  height: 576,
  left: 100,
  right: 1124,
  top: 100,
  width: 1024,
  x: 100,
  y: 100,
  toJSON: () => ({}),
};

const ZERO_STAGE_RECT = {
  ...STAGE_RECT,
  bottom: 100,
  height: 0,
  right: 100,
  width: 0,
};

const resizeObservers: Array<{
  callback: ResizeObserverCallback;
  disconnect: ReturnType<typeof vi.fn>;
  observe: ReturnType<typeof vi.fn>;
}> = [];

class ResizeObserverStub {
  readonly disconnect = vi.fn();
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();

  constructor(readonly callback: ResizeObserverCallback) {
    resizeObservers.push({
      callback,
      disconnect: this.disconnect,
      observe: this.observe,
    });
  }
}

beforeEach(() => {
  resizeObservers.length = 0;
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * The pinned pixels in this file were measured in the original 6 m demo room with the
 * analysis-anchored seed (sofa on the left wall, table at the origin). The calibrated
 * 3.4 m photo room has its own placement, so the pins render this fixture instead and
 * the width-independent checks run on the real seed explicitly.
 */
const FIXTURE_ROOM_WIDTH_M = 6;

function fixtureScene() {
  return createDemoScene({ widthM: FIXTURE_ROOM_WIDTH_M });
}

function fixtureStore() {
  return createSceneStore(fixtureScene());
}

function renderStage(
  store = fixtureStore(),
  stageRect: typeof STAGE_RECT = STAGE_RECT,
) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    stageRect,
  );
  const result = render(
    <SceneStoreProvider store={store}>
      <RoomPhotoStage />
    </SceneStoreProvider>,
  );
  const stage = screen.getByRole("region", { name: "Editable room photo" });
  return { ...result, stage, store };
}

interface QuadPoint {
  x: number;
  y: number;
}

/** The floor quad an element is tagged with, in stage-normalized coordinates. */
function parseDestinationQuad(element: Element): readonly QuadPoint[] {
  const attribute = element.getAttribute("data-destination-quad");
  if (!attribute) throw new Error("Missing data-destination-quad");
  return attribute.split(" ").map((pair) => {
    const [x, y] = pair.split(",").map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`Malformed destination quad point "${pair}"`);
    }
    return { x: x!, y: y! };
  });
}

function percentageFraction(value: string, label: string): number {
  const match = /^(-?\d+(?:\.\d+)?)%$/.exec(value.trim());
  if (!match) {
    throw new Error(`Expected ${label} as a percentage, received "${value}"`);
  }
  return Number(match[1]) / 100;
}

/** Winding test against a convex quad, so the anchor is checked against the clip polygon
 * rather than the box around it. */
function pointInsideQuad(point: QuadPoint, quad: readonly QuadPoint[]): boolean {
  let positive = 0;
  let negative = 0;
  for (let index = 0; index < quad.length; index += 1) {
    const start = quad[index]!;
    const end = quad[(index + 1) % quad.length]!;
    const side =
      (end.x - start.x) * (point.y - start.y) -
      (end.y - start.y) * (point.x - start.x);
    if (side > 0) positive += 1;
    if (side < 0) negative += 1;
  }
  return positive === 0 || negative === 0;
}

function objectFromStore(store: ReturnType<typeof createSceneStore>, id: string) {
  const object = store.getState().scene.objects.find((item) => item.id === id);
  if (!object) throw new Error(`Missing scene object ${id}`);
  return object;
}

const STAGE_SIZE = { width: STAGE_RECT.width, height: STAGE_RECT.height };
const STAGE_ASPECT = STAGE_RECT.width / STAGE_RECT.height;

/** What the compositor knows about the picture it draws for one object. */
function presentationOf(object: SceneObject): CutoutPresentation {
  const set = getPhotoAssetSet(object);
  const selected = set ? selectPhotoView(object, set) : null;
  return {
    view: selected?.view.view,
    symmetry: set?.symmetry,
    contentBox: selected?.view.contentBox,
    intrinsicWidth: selected?.view.intrinsicWidth,
    intrinsicHeight: selected?.view.intrinsicHeight,
  };
}

/**
 * Where a rendered cutout's measured silhouette sits on the stage, as fractions of the
 * stage height. jsdom lays nothing out, so the geometry is read back from the styles
 * the compositor wrote: the frame's `top` is the object's floor anchor, its `width` is
 * a percentage of the stage width, and the picture keeps its intrinsic aspect, so the
 * stage's own 16:9 ratio turns that width into the drawn image's height.
 */
function silhouetteBounds(objectId: string, object: SceneObject) {
  const frame = screen.getByTestId(`photo-object-frame-${objectId}`);
  const view = selectPhotoView(object, getPhotoAssetSet(object)!);
  const box = view.view.contentBox;
  if (!box) throw new Error(`Missing content box for ${objectId}`);
  const imageHeight =
    (Number.parseFloat(frame.style.width) / 100) *
    (view.view.intrinsicHeight / view.view.intrinsicWidth) *
    STAGE_ASPECT;
  const anchor = Number.parseFloat(frame.style.top) / 100;
  const frameTop = anchor - view.view.anchorY * imageHeight;

  return {
    anchor,
    top: frameTop + box.top * imageHeight,
    bottom: frameTop + box.bottom * imageHeight,
  };
}

describe("RoomPhotoStage", () => {
  test("measures and observes the 16:9 stage for projective composition", () => {
    const { stage, unmount } = renderStage();

    expect(resizeObservers).toHaveLength(1);
    expect(resizeObservers[0]!.observe).toHaveBeenCalledWith(stage);
    unmount();
    expect(resizeObservers[0]!.disconnect).toHaveBeenCalledOnce();
  });

  test("renders the six initial room objects as labelled button controls", () => {
    const { stage } = renderStage();

    const buttons = within(stage).getAllByRole("button");
    expect(buttons).toHaveLength(6);
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Rug",
      "Sofa",
      "Coffee table",
      "Floor lamp",
      "Chair",
      "Plant",
    ]);
    expect(
      screen.getByRole("button", { name: "Coffee table" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("projects the rug, five physical shadows, and aligned floor chrome", () => {
    renderStage();

    const rugVisual = screen.getByTestId("photo-rug-visual-rug_01");
    const rug = screen.getByRole("button", { name: "Rug" });
    const destinationQuad = rug.getAttribute("data-destination-quad");
    expect(rugVisual).toHaveAttribute("data-floor-projected", "true");
    expect(rug.style.clipPath).toContain("polygon(");
    expect(destinationQuad).toBeTruthy();
    expect(rugVisual.querySelector("img")?.style.transform).toContain(
      "matrix3d(",
    );
    expect(screen.getAllByTestId(/photo-contact-shadow-/)).toHaveLength(5);
    expect(screen.getByTestId("photo-contact-shadow-sofa_01")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    const sofaShadow = screen.getByTestId("photo-contact-shadow-sofa_01");
    const sofaFrame = screen.getByTestId("photo-object-frame-sofa_01");
    const selection = screen.getByTestId("photo-rug-selection-rug_01");
    expect(Number.parseFloat(sofaShadow.style.left)).toBeCloseTo(27.2, 10);
    expect(Number.parseFloat(sofaShadow.style.top)).toBeCloseTo(74, 10);
    expect(Number.parseFloat(sofaShadow.style.width)).toBeCloseTo(17.28, 10);
    expect(Number.parseFloat(sofaShadow.style.height)).toBeCloseTo(
      3.0123831364044356,
      10,
    );
    expect(Number.parseFloat(sofaShadow.style.filter.slice(5))).toBeCloseTo(
      7,
      10,
    );
    expect(Number.parseFloat(sofaShadow.style.opacity)).toBeCloseTo(0.198, 10);
    expect(sofaShadow.style.transform).toBe(
      "translate(-50%, -50%) rotate(0deg)",
    );
    expect(getComputedStyle(sofaShadow).pointerEvents).toBe("none");
    expect(Number(rug.style.zIndex)).toBeLessThan(
      Number(sofaShadow.style.zIndex),
    );
    expect(Number(sofaShadow.style.zIndex)).toBeLessThan(
      Number(sofaFrame.style.zIndex),
    );
    expect(Number(sofaFrame.style.zIndex)).toBeLessThan(
      Number(selection.style.zIndex),
    );

    fireEvent.click(rug);
    expect(rug).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByTestId("photo-rug-selection-rug_01"),
    ).toHaveAttribute("data-destination-quad", destinationQuad);
    expect(screen.getByTestId("photo-floor-anchor-rug_01")).toHaveAttribute(
      "data-destination-quad",
      destinationQuad,
    );
  });

  test("gives a focused projected rug a fixed visible floor outline", () => {
    renderStage();
    const rug = screen.getByRole("button", { name: "Rug" });
    // The halo is drawn first so it sits under the ring it backs; the ring
    // itself is the second polygon.
    const polygons = screen
      .getByTestId("photo-rug-selection-rug_01")
      .querySelectorAll("polygon");
    const [halo, outline] = polygons;
    if (!halo || !outline) throw new Error("Missing rug focus polygons");

    rug.focus();

    expect(rug).toHaveFocus();
    expect(outline).toHaveAttribute("vector-effect", "non-scaling-stroke");
    expect(outline).toHaveAttribute("stroke-width", "3");
    expect(halo).toHaveAttribute("vector-effect", "non-scaling-stroke");
    expect(halo).toHaveAttribute("stroke-width", "11");
    expect(halo).toHaveAttribute("points", outline.getAttribute("points"));
  });

  test("keeps a failed projected rug labelled and selectable", () => {
    const scene = fixtureScene();
    scene.selectedObjectId = null;
    const store = createSceneStore(scene);
    renderStage(store);
    const rug = screen.getByRole("button", { name: "Rug" });
    const image = rug.querySelector("img");
    if (!image) throw new Error("Missing registered rug image");

    fireEvent.error(image);
    expect(
      within(rug).getByRole("img", { name: "Rug preview unavailable" }),
    ).toBeVisible();
    expect(rug).not.toBeDisabled();
    fireEvent.click(rug);
    expect(store.getState().scene.selectedObjectId).toBe("rug_01");
  });

  test("uses the registered anchor layout for a zero-size stage rug", () => {
    const scene = fixtureScene();
    scene.selectedObjectId = null;
    const store = createSceneStore(scene);
    renderStage(store, ZERO_STAGE_RECT);
    const rug = screen.getByRole("button", { name: "Rug" });
    const rugVisual = screen.getByTestId("photo-rug-visual-rug_01");

    expect(rugVisual).toHaveAttribute("data-floor-projected", "false");
    expect(rug.querySelector("img")).toHaveAttribute(
      "src",
      "/demo/photo/seed/seed-pattern-rug.webp",
    );
    expect(rug.style.getPropertyValue("--photo-left")).not.toBe("");
    expect(rug).toHaveAccessibleName("Rug");
    fireEvent.click(rug);
    expect(store.getState().scene.selectedObjectId).toBe("rug_01");
  });

  test("commits one move when an unlocked cutout drag ends", () => {
    const store = fixtureStore();
    const commit = vi.spyOn(store.getState(), "commitTransform");
    const originalTable = structuredClone(objectFromStore(store, "table_01"));
    const { stage } = renderStage(store);
    const table = screen.getByRole("button", { name: "Coffee table" });
    const originalLeft = table.style.getPropertyValue("--photo-left");

    fireEvent.pointerDown(table, {
      pointerId: 7,
      clientX: 500,
      clientY: 300,
    });
    expect(store.getState().isTransforming).toBe(true);
    fireEvent.pointerMove(table, {
      pointerId: 7,
      clientX: 560,
      clientY: 340,
    });

    expect(commit).not.toHaveBeenCalled();
    expect(store.getState().scene.revision).toBe(1);
    expect(objectFromStore(store, "table_01").position).toEqual(
      originalTable.position,
    );
    expect(table.style.getPropertyValue("--photo-left")).not.toBe(originalLeft);

    fireEvent.pointerUp(table, {
      pointerId: 7,
      clientX: 560,
      clientY: 340,
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(store.getState().scene.revision).toBe(2);
    expect(store.getState().history).toHaveLength(1);
    expect(store.getState().isTransforming).toBe(false);
    expect(stage).toContainElement(table);
  });

  test("previews and commits canonical rug movement through its clipped hit target", () => {
    const store = fixtureStore();
    const commit = vi.spyOn(store.getState(), "commitTransform");
    const originalRug = structuredClone(objectFromStore(store, "rug_01"));
    renderStage(store);
    const rug = screen.getByRole("button", { name: "Rug" });
    const originalQuad = rug.getAttribute("data-destination-quad");

    fireEvent.pointerDown(rug, {
      pointerId: 72,
      clientX: 612,
      clientY: 526.24,
    });
    fireEvent.pointerMove(rug, {
      pointerId: 72,
      clientX: 652,
      clientY: 546.24,
    });

    expect(store.getState().scene.selectedObjectId).toBe("rug_01");
    expect(store.getState().isTransforming).toBe(true);
    expect(commit).not.toHaveBeenCalled();
    expect(objectFromStore(store, "rug_01").position).toEqual(
      originalRug.position,
    );
    expect(rug.getAttribute("data-destination-quad")).not.toBe(originalQuad);

    fireEvent.pointerUp(rug, {
      pointerId: 72,
      clientX: 652,
      clientY: 546.24,
    });

    expect(commit).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith(
      "rug_01",
      [expect.any(Number), originalRug.position[1], expect.any(Number)],
      originalRug.rotation[1],
    );
    expect(objectFromStore(store, "rug_01").position).not.toEqual(
      originalRug.position,
    );
    expect(store.getState().scene.revision).toBe(2);
    expect(store.getState().history).toHaveLength(1);
    expect(store.getState().isTransforming).toBe(false);
  });

  test("moves by the pointer delta without jumping the floor anchor", () => {
    const store = fixtureStore();
    const start = structuredClone(objectFromStore(store, "table_01"));
    renderStage(store);
    const table = screen.getByRole("button", { name: "Coffee table" });

    fireEvent.pointerDown(table, {
      pointerId: 31,
      clientX: 430,
      clientY: 360,
    });
    fireEvent.pointerMove(table, {
      pointerId: 31,
      clientX: 430,
      clientY: 360,
    });
    fireEvent.pointerUp(table, {
      pointerId: 31,
      clientX: 430,
      clientY: 360,
    });

    expect(objectFromStore(store, "table_01").position).toEqual(start.position);
    expect(store.getState().scene.revision).toBe(1);
  });

  test("applies the same scene delta from any point inside a cutout", () => {
    function movedPosition(startX: number, startY: number, pointerId: number) {
      const store = fixtureStore();
      const start = structuredClone(objectFromStore(store, "table_01"));
      const { unmount } = renderStage(store);
      const table = screen.getByRole("button", { name: "Coffee table" });

      fireEvent.pointerDown(table, { pointerId, clientX: startX, clientY: startY });
      fireEvent.pointerMove(table, {
        pointerId,
        clientX: startX + 60,
        clientY: startY + 30,
      });
      fireEvent.pointerUp(table, {
        pointerId,
        clientX: startX + 60,
        clientY: startY + 30,
      });

      const position = structuredClone(objectFromStore(store, "table_01").position);
      unmount();
      return position.map((coordinate, index) => coordinate - start.position[index]);
    }

    const firstDelta = movedPosition(410, 330, 41);
    const secondDelta = movedPosition(530, 390, 42);
    expect(secondDelta[0]).toBeCloseTo(firstDelta[0]);
    expect(secondDelta[1]).toBeCloseTo(firstDelta[1]);
    expect(secondDelta[2]).toBeCloseTo(firstDelta[2]);
  });

  test("keeps the first pointer as the sole gesture owner", () => {
    const store = fixtureStore();
    const commit = vi.spyOn(store.getState(), "commitTransform");
    const originalPosition = [...objectFromStore(store, "table_01").position];
    renderStage(store);
    const table = screen.getByRole("button", { name: "Coffee table" });

    fireEvent.pointerDown(table, {
      pointerId: 21,
      clientX: 500,
      clientY: 433,
    });
    fireEvent.pointerMove(table, {
      pointerId: 21,
      clientX: 560,
      clientY: 340,
    });

    fireEvent.pointerDown(table, {
      pointerId: 22,
      clientX: 500,
      clientY: 433,
    });
    fireEvent.pointerMove(table, {
      pointerId: 22,
      clientX: 760,
      clientY: 500,
    });
    fireEvent.pointerUp(table, {
      pointerId: 22,
      clientX: 760,
      clientY: 500,
    });

    expect(commit).not.toHaveBeenCalled();
    expect(store.getState().isTransforming).toBe(true);
    expect(objectFromStore(store, "table_01").position).toEqual(originalPosition);

    fireEvent.pointerUp(table, {
      pointerId: 21,
      clientX: 560,
      clientY: 340,
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(
      "table_01",
      [expect.closeTo(0.6294293174), 0.21, expect.closeTo(-1.9375)],
      0,
    );
    expect(objectFromStore(store, "table_01").position).toEqual([
      expect.closeTo(0.6294293174),
      0.21,
      expect.closeTo(-1.9375),
    ]);
    expect(store.getState().scene.revision).toBe(2);
    expect(store.getState().history).toHaveLength(1);
    expect(store.getState().isTransforming).toBe(false);
  });

  test("discards a changed drag preview when the pointer is cancelled", () => {
    const store = fixtureStore();
    const commit = vi.spyOn(store.getState(), "commitTransform");
    const originalPosition = [...objectFromStore(store, "table_01").position];
    renderStage(store);
    const table = screen.getByRole("button", { name: "Coffee table" });

    fireEvent.pointerDown(table, {
      pointerId: 9,
      clientX: 500,
      clientY: 300,
    });
    fireEvent.pointerMove(table, {
      pointerId: 9,
      clientX: 620,
      clientY: 390,
    });
    fireEvent.pointerCancel(table, { pointerId: 9 });

    expect(commit).not.toHaveBeenCalled();
    expect(objectFromStore(store, "table_01").position).toEqual(originalPosition);
    expect(store.getState().scene.revision).toBe(1);
    expect(store.getState().isTransforming).toBe(false);
  });

  test("selects a locked object without exposing a transform handle", () => {
    const scene = fixtureScene();
    scene.selectedObjectId = null;
    const table = scene.objects.find(({ id }) => id === "table_01")!;
    table.locked = true;
    const store = createSceneStore(scene);
    store.getState().setToolMode("rotate");
    renderStage(store);

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Coffee table" }),
      { pointerId: 4, clientX: 500, clientY: 300 },
    );

    expect(store.getState().scene.selectedObjectId).toBe("table_01");
    expect(store.getState().isTransforming).toBe(false);
    expect(
      screen.queryByTestId("rotation-handle-table_01"),
    ).not.toBeInTheDocument();
  });

  test("anchors a locked projected rug's badge to its floor quad", () => {
    const scene = fixtureScene();
    scene.selectedObjectId = null;
    const rug = scene.objects.find(({ id }) => id === "rug_01")!;
    rug.locked = true;
    renderStage(createSceneStore(scene));

    const rugButton = screen.getByRole("button", { name: "Rug" });
    const quad = parseDestinationQuad(rugButton);
    expect(quad).toHaveLength(4);

    const badge = within(
      screen.getByTestId("photo-rug-visual-rug_01"),
    ).getByText("Locked");
    expect(badge).toHaveAttribute("aria-hidden", "true");

    const anchorPoint = {
      x: percentageFraction(badge.style.left, "the locked badge left"),
      y: percentageFraction(badge.style.top, "the locked badge top"),
    };
    const bounds = {
      minimumX: Math.min(...quad.map(({ x }) => x)),
      maximumX: Math.max(...quad.map(({ x }) => x)),
      minimumY: Math.min(...quad.map(({ y }) => y)),
      maximumY: Math.max(...quad.map(({ y }) => y)),
    };

    expect(anchorPoint.x).toBeGreaterThanOrEqual(bounds.minimumX);
    expect(anchorPoint.x).toBeLessThanOrEqual(bounds.maximumX);
    expect(anchorPoint.y).toBeGreaterThanOrEqual(bounds.minimumY);
    expect(anchorPoint.y).toBeLessThanOrEqual(bounds.maximumY);
    // The rug button is clipped to the quad, so only a point inside the polygon itself
    // is ever painted.
    expect(pointInsideQuad(anchorPoint, quad)).toBe(true);
  });

  test("clears selection when the stage itself is clicked", () => {
    const store = fixtureStore();
    const { stage } = renderStage(store);

    fireEvent.click(stage);

    expect(store.getState().scene.selectedObjectId).toBeNull();
    expect(
      screen.getByRole("button", { name: "Coffee table" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  test("keeps an unknown photo asset as a labelled selectable fallback", async () => {
    const scene = fixtureScene();
    scene.selectedObjectId = null;
    scene.objects.find(({ id }) => id === "table_01")!.assetId =
      "missing-table-cutout";
    const store = createSceneStore(scene);
    const user = userEvent.setup();
    renderStage(store);

    const table = screen.getByRole("button", { name: "Coffee table" });
    expect(
      within(table).getByRole("img", {
        name: "Coffee table preview unavailable",
      }),
    ).toBeVisible();

    await user.click(table);
    expect(store.getState().scene.selectedObjectId).toBe("table_01");
  });

  test("keeps a failed registered photo asset selectable and resets failure for a new source", () => {
    const firstScene = fixtureScene();
    firstScene.selectedObjectId = null;
    const firstStore = createSceneStore(firstScene);
    renderStage(firstStore);
    const firstTable = screen.getByRole("button", { name: "Coffee table" });
    const firstImage = firstTable.querySelector("img");
    if (!firstImage) throw new Error("Missing registered coffee-table image");

    fireEvent.error(firstImage);
    expect(screen.getByRole("button", { name: "Coffee table" })).toBe(firstTable);
    expect(firstTable).not.toBeDisabled();
    expect(
      within(firstTable).getByRole("img", {
        name: "Coffee table preview unavailable",
      }),
    ).toBeVisible();
    fireEvent.click(firstTable);
    expect(firstStore.getState().scene.selectedObjectId).toBe("table_01");

    const replacement = DEMO_PRODUCTS.find(
      ({ id }) => id === "travertine-plinth-table",
    );
    if (!replacement) throw new Error("Missing travertine table product");
    let replacementResult: CommandResult | undefined;
    act(() => {
      replacementResult = firstStore.getState().applyCommand({
        actor: "human",
        expectedRevision: firstStore.getState().scene.revision,
        command: {
          type: "replace",
          objectId: "table_01",
          product: {
            id: replacement.id,
            variantId: replacement.variantId,
            title: replacement.title,
            category: replacement.category,
            price: replacement.price,
            dimensionsCm: replacement.dimensionsCm,
            styleTags: replacement.styleTags,
            color: replacement.color,
            material: replacement.material,
          },
        },
      });
    });
    if (!replacementResult) throw new Error("Replacement command did not run");
    expect(replacementResult.ok).toBe(true);

    const secondTable = screen.getByRole("button", {
      name: "Travertine Plinth Table",
    });
    expect(secondTable).toBe(firstTable);
    const secondImage = secondTable.querySelector("img");
    if (!secondImage) throw new Error("New registered image did not reset failure");
    expect(secondImage).toHaveAttribute(
      "src",
      "/demo/photo/products/travertine-plinth-table.webp",
    );

    fireEvent.error(secondImage);
    expect(
      screen.getByRole("button", { name: "Travertine Plinth Table" }),
    ).toBe(secondTable);
    expect(
      within(secondTable).getByRole("img", {
        name: "Travertine Plinth Table preview unavailable",
      }),
    ).toBeVisible();
    fireEvent.click(secondTable);
    expect(firstStore.getState().scene.selectedObjectId).toBe("table_01");
  });

  test("moves a focused object by one keyboard command with normal and Shift steps", () => {
    const store = fixtureStore();
    // Select is the default tool: the arrows nudge without picking anything.
    expect(store.getState().toolMode).toBe("select");
    const commit = vi.spyOn(store.getState(), "commitTransform");
    const initial = structuredClone(objectFromStore(store, "table_01"));
    renderStage(store);
    const table = screen.getByRole("button", { name: "Coffee table" });

    const right = fireEvent.keyDown(table, { key: "ArrowRight" });
    expect(right).toBe(false);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(objectFromStore(store, "table_01").position[0]).toBeCloseTo(
      initial.position[0] + 0.08,
    );

    const up = fireEvent.keyDown(table, { key: "ArrowUp", shiftKey: true });
    expect(up).toBe(false);
    expect(commit).toHaveBeenCalledTimes(2);
    expect(objectFromStore(store, "table_01").position[2]).toBeCloseTo(
      initial.position[2] - 0.24,
    );
  });

  // A keyboard nudge moved pixels and said nothing; the room now narrates it.
  test("announces each keyboard nudge and turn in a polite live region", () => {
    const store = fixtureStore();
    const { stage } = renderStage(store);
    const table = screen.getByRole("button", { name: "Coffee table" });
    const note = within(stage).getByRole("status");
    expect(note).toHaveAttribute("aria-live", "polite");
    expect(note).toHaveTextContent("");

    fireEvent.keyDown(table, { key: "ArrowRight" });
    expect(note).toHaveTextContent("Coffee table moved right");
    fireEvent.keyDown(table, { key: "ArrowUp" });
    expect(note).toHaveTextContent("Coffee table moved back");
    fireEvent.keyDown(table, { key: "ArrowDown" });
    expect(note).toHaveTextContent("Coffee table moved forward");
    fireEvent.keyDown(table, { key: "ArrowLeft" });
    expect(note).toHaveTextContent("Coffee table moved left");

    act(() => store.getState().setToolMode("rotate"));
    fireEvent.keyDown(table, { key: "ArrowRight", shiftKey: true });
    expect(note).toHaveTextContent("Coffee table turned 15° to the right");
    fireEvent.keyDown(table, { key: "ArrowLeft" });
    expect(note).toHaveTextContent("Coffee table turned 5° to the left");
  });

  test("rotates focused vertical objects and rugs by keyboard", () => {
    const store = fixtureStore();
    store.getState().setToolMode("rotate");
    const commit = vi.spyOn(store.getState(), "commitTransform");
    const initialRotation = objectFromStore(store, "table_01").rotation[1];
    renderStage(store);
    const table = screen.getByRole("button", { name: "Coffee table" });

    const left = fireEvent.keyDown(table, { key: "ArrowLeft" });
    expect(left).toBe(false);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(objectFromStore(store, "table_01").rotation[1]).toBeCloseTo(
      initialRotation - (5 * Math.PI) / 180,
    );

    const right = fireEvent.keyDown(table, {
      key: "ArrowRight",
      shiftKey: true,
    });
    expect(right).toBe(false);
    expect(commit).toHaveBeenCalledTimes(2);
    expect(objectFromStore(store, "table_01").rotation[1]).toBeCloseTo(
      initialRotation + (10 * Math.PI) / 180,
    );

    const rug = screen.getByRole("button", { name: "Rug" });
    const initialRugRotation = objectFromStore(store, "rug_01").rotation[1];
    fireEvent.click(rug);
    expect(screen.getByTestId("rotation-handle-rug_01")).toBeVisible();
    expect(fireEvent.keyDown(rug, { key: "ArrowRight" })).toBe(false);
    expect(commit).toHaveBeenCalledTimes(3);
    expect(objectFromStore(store, "rug_01").rotation[1]).toBeCloseTo(
      initialRugRotation + (5 * Math.PI) / 180,
    );
  });

  test("previews and commits rug rotation from its aligned floor handle", () => {
    const store = fixtureStore();
    store.getState().selectObject("rug_01");
    store.getState().setToolMode("rotate");
    const commit = vi.spyOn(store.getState(), "commitTransform");
    renderStage(store);
    const rug = screen.getByRole("button", { name: "Rug" });
    const handle = screen.getByTestId("rotation-handle-rug_01");
    const initialQuad = rug.getAttribute("data-destination-quad");

    expect(handle).toHaveAttribute("data-destination-quad", initialQuad);
    fireEvent.pointerDown(handle, {
      pointerId: 71,
      clientX: 612,
      clientY: 470,
    });
    fireEvent.pointerMove(handle, {
      pointerId: 71,
      clientX: 700,
      clientY: 520,
    });
    expect(rug.getAttribute("data-destination-quad")).not.toBe(initialQuad);
    expect(commit).not.toHaveBeenCalled();
    fireEvent.pointerUp(handle, {
      pointerId: 71,
      clientX: 700,
      clientY: 520,
    });

    expect(commit).toHaveBeenCalledOnce();
    expect(store.getState().history).toHaveLength(1);
    expect(store.getState().isTransforming).toBe(false);
  });

  test("selects a focused object with Enter or Space in any tool mode", () => {
    const store = fixtureStore();
    store.getState().selectObject(null);
    store.getState().setToolMode("rotate");
    renderStage(store);
    const chair = screen.getByRole("button", { name: "Chair" });
    const plant = screen.getByRole("button", { name: "Plant" });

    expect(fireEvent.keyDown(chair, { key: "Enter" })).toBe(false);
    expect(store.getState().scene.selectedObjectId).toBe("chair_01");
    expect(fireEvent.keyDown(plant, { key: " " })).toBe(false);
    expect(store.getState().scene.selectedObjectId).toBe("plant_01");
    expect(fireEvent.keyDown(plant, { key: "Tab" })).toBe(true);
  });

  test("commits one rotation only when a rotation-handle gesture ends", () => {
    const store = fixtureStore();
    store.getState().setToolMode("rotate");
    const commit = vi.spyOn(store.getState(), "commitTransform");
    renderStage(store);
    const handle = screen.getByTestId("rotation-handle-table_01");

    fireEvent.pointerDown(handle, {
      pointerId: 12,
      clientX: 500,
      clientY: 300,
    });
    fireEvent.pointerMove(handle, {
      pointerId: 12,
      clientX: 650,
      clientY: 260,
    });
    expect(commit).not.toHaveBeenCalled();
    fireEvent.pointerUp(handle, {
      pointerId: 12,
      clientX: 650,
      clientY: 260,
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(store.getState().scene.revision).toBe(2);
    expect(store.getState().history).toHaveLength(1);
    expect(store.getState().isTransforming).toBe(false);
  });

  test("adds rotation pointer-angle delta to the starting rotation", () => {
    const scene = fixtureScene();
    scene.objects.find(({ id }) => id === "table_01")!.rotation[1] =
      Math.PI / 3;
    const store = createSceneStore(scene);
    store.getState().setToolMode("rotate");
    renderStage(store);
    const handle = screen.getByTestId("rotation-handle-table_01");

    fireEvent.pointerDown(handle, {
      pointerId: 32,
      clientX: 500,
      clientY: 250,
    });
    fireEvent.pointerMove(handle, {
      pointerId: 32,
      clientX: 500,
      clientY: 250,
    });
    fireEvent.pointerUp(handle, {
      pointerId: 32,
      clientX: 500,
      clientY: 250,
    });

    expect(objectFromStore(store, "table_01").rotation[1]).toBeCloseTo(
      Math.PI / 3,
    );
    expect(store.getState().scene.revision).toBe(1);
  });

  test("uses the shortest signed rotation delta across the angle boundary", () => {
    const store = fixtureStore();
    store.getState().setToolMode("rotate");
    const { stage } = renderStage(store);
    const table = screen.getByRole("button", { name: "Coffee table" });
    const handle = screen.getByTestId("rotation-handle-table_01");
    const anchorX =
      STAGE_RECT.left +
      (Number.parseFloat(table.style.getPropertyValue("--photo-left")) / 100) *
        STAGE_RECT.width;
    const anchorY =
      STAGE_RECT.top +
      (Number.parseFloat(table.style.getPropertyValue("--photo-top")) / 100) *
        STAGE_RECT.height;

    fireEvent.pointerDown(handle, {
      pointerId: 33,
      clientX: anchorX - 2,
      clientY: anchorY + 100,
    });
    fireEvent.pointerMove(handle, {
      pointerId: 33,
      clientX: anchorX + 2,
      clientY: anchorY + 100,
    });
    fireEvent.pointerUp(handle, {
      pointerId: 33,
      clientX: anchorX + 2,
      clientY: anchorY + 100,
    });

    expect(objectFromStore(store, "table_01").rotation[1]).toBeCloseTo(
      -2 * Math.atan2(2 / STAGE_RECT.width, 100 / STAGE_RECT.height),
    );
    expect(stage).toContainElement(table);
  });

  // The seed table sits at x = 0, where the tie between the front-quarter pair
  // resolves to the photographed cutout, so every piece of floor chrome has to
  // follow its native anchor 0.5007.
  test("anchors the object frame, floor marker, and rotation handle to the selected view", () => {
    const store = fixtureStore();
    store.getState().setToolMode("rotate");
    renderStage(store);

    const frame = screen.getByTestId("photo-object-frame-table_01");
    expect(frame.dataset.photoMirrored).toBe("false");
    expect(frame.style.getPropertyValue("--photo-anchor-x")).toBe("50.07%");
    expect(frame.style.getPropertyValue("--photo-anchor-y")).toBe("86.13%");
    expect(frame.style.left).toBe("50%");
    expect(frame.style.top).toBe("74%");
    expect(frame.style.transform).toBe("translate(-50.07%, -86.13%)");
    expect(frame.style.transformOrigin).toBe("50.07% 86.13%");
    const floorAnchor = screen.getByTestId("photo-floor-anchor-table_01");
    const object = screen.getByRole("button", { name: "Coffee table" });
    const handle = screen.getByTestId("rotation-handle-table_01");
    expect(frame).toContainElement(floorAnchor);
    expect(frame).toContainElement(handle);
    expect(floorAnchor.style.left).toBe("50.07%");
    expect(floorAnchor.style.top).toBe("86.13%");
    expect(floorAnchor.style.transform).toBe("translate(-50%, -50%)");
    expect(object.style.width).toBe("100%");
    expect(object.style.transform).toBe("none");
    expect(handle.style.left).toBe("50.07%");
    // The handle sits on the silhouette's top edge, not the image box's.
    const tableView = selectPhotoView(
      objectFromStore(store, "table_01"),
      getPhotoAssetSet(objectFromStore(store, "table_01"))!,
    );
    const tableBox = tableView.view.contentBox!;
    expect(handle.style.top).toBe(`${tableBox.top * 100}%`);
    expect(handle.style.transform).toBe("translate(-50%, -100%)");
  });

  // QA regression: with the handle on the silhouette's top edge it sits inside
  // the cutout's box, so the button must not carry a z-index of its own.
  test("keeps the rotate handle above the cutout it belongs to", () => {
    const store = fixtureStore();
    store.getState().setToolMode("rotate");
    renderStage(store);

    const button = screen.getByRole("button", { name: "Coffee table" });
    const frame = screen.getByTestId("photo-object-frame-table_01");
    const handle = screen.getByTestId("rotation-handle-table_01");
    expect(button.style.zIndex).toBe("");
    expect(frame.style.zIndex).not.toBe("");
    expect(handle.getAttribute("aria-hidden")).toBe("true");
    expect(handle.tabIndex).toBe(-1);
    expect(frame).toContainElement(handle);
  });

  // Minor QA finding: the selection used to wrap the padded image box. With a
  // measured content box the outline hugs the furniture, and a mirrored twin
  // flips the box with the pixels.
  test("outlines the selected silhouette and mirrors the box with the view", () => {
    const store = fixtureStore();
    renderStage(store);

    const table = objectFromStore(store, "table_01");
    const tableBox = selectPhotoView(table, getPhotoAssetSet(table)!).view
      .contentBox!;
    const outline = screen.getByTestId("photo-silhouette-table_01");
    expect(outline.style.left).toBe(`${tableBox.left * 100}%`);
    expect(outline.style.top).toBe(`${tableBox.top * 100}%`);
    expect(outline.style.width).toBe(`${(tableBox.right - tableBox.left) * 100}%`);
    expect(outline.style.height).toBe(`${(tableBox.bottom - tableBox.top) * 100}%`);
    // The span is the room's only ring and is always rendered; the stylesheet
    // colours it, so an unselected chair says so through aria-pressed instead.
    expect(screen.getByTestId("photo-silhouette-chair_01")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chair" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    act(() => store.getState().selectObject("chair_01"));
    const chair = objectFromStore(store, "chair_01");
    const chairView = selectPhotoView(chair, getPhotoAssetSet(chair)!);
    expect(chairView.mirrored).toBe(true);
    const chairBox = chairView.view.contentBox!;
    const chairOutline = screen.getByTestId("photo-silhouette-chair_01");
    expect(chairOutline.style.left).toBe(`${(1 - chairBox.right) * 100}%`);
    expect(chairOutline.style.width).toBe(`${(chairBox.right - chairBox.left) * 100}%`);
  });

  // Spec §3: a cutout's width is its real width scaled by the calibrated floor width
  // where it stands. The fixture room is 6 m wide and the floor spans 0.72 of the stage
  // at mid depth, so the 2 m sofa covers 24% of the stage and the 0.8 m chair 9.6%.
  test("sizes every seed cutout from its real width at its own depth", () => {
    renderStage();

    const sofa = screen.getByTestId("photo-object-frame-sofa_01");
    const chair = screen.getByTestId("photo-object-frame-chair_01");
    const table = screen.getByTestId("photo-object-frame-table_01");

    // The picture is sized from its chosen view's silhouette extent and the
    // image's measured content fill, not from the raw footprint.
    const scene = fixtureScene();
    const expected = (id: string) => {
      const object = scene.objects.find((entry) => entry.id === id)!;
      const set = getPhotoAssetSet(object)!;
      const view = selectPhotoView(object, set);
      return objectVisualWidth(object, scene.room, {
        view: view.view.view,
        symmetry: set.symmetry,
        contentBox: view.view.contentBox,
      });
    };
    expect(Number.parseFloat(sofa.style.width)).toBeCloseTo(expected("sofa_01"), 6);
    expect(Number.parseFloat(chair.style.width)).toBeCloseTo(expected("chair_01"), 6);
    expect(Number.parseFloat(table.style.width)).toBeCloseTo(expected("table_01"), 6);
    expect(expected("sofa_01")).toBeGreaterThan(24);
  });

  // Spec §3: a supported object is anchored to the top its supporter's photograph
  // actually draws, draws one depth band above it, and leaves its contact shadow on
  // the floor. The calibrated lift alone is not enough: it is a fraction of the stage
  // width used where a fraction of the stage height is needed, and it measures the
  // supporter's real height rather than the height of its picture.
  test("raises a stacked cutout above the floor and above its supporter", () => {
    const scene = fixtureScene();
    const table = scene.objects.find(({ id }) => id === "table_01")!;
    const lamp = scene.objects.find(({ id }) => id === "lamp_01")!;
    lamp.position = [
      table.position[0],
      table.dimensionsM.height + lamp.dimensionsM.height / 2,
      table.position[2],
    ];
    scene.selectedObjectId = "lamp_01";
    renderStage(createSceneStore(scene));

    const lampFrame = screen.getByTestId("photo-object-frame-lamp_01");
    const tableFrame = screen.getByTestId("photo-object-frame-table_01");
    const lampShadow = screen.getByTestId("photo-contact-shadow-lamp_01");

    const offset = supportedTopOffset(
      lamp,
      table,
      presentationOf(table),
      scene.room,
      STAGE_SIZE,
    );
    if (offset === null) throw new Error("Missing supported top offset");
    expect(Number.parseFloat(lampFrame.style.top)).toBeCloseTo(
      74 - offset * 100,
      10,
    );
    expect(offset).toBeGreaterThan(objectElevationOffset(lamp, scene.room));
    expect(Number.parseFloat(tableFrame.style.top)).toBeCloseTo(74, 10);
    expect(Number.parseFloat(lampShadow.style.top)).toBeCloseTo(74, 10);
    expect(Number(lampFrame.style.zIndex)).toBeGreaterThan(
      Number(tableFrame.style.zIndex),
    );
    expect(lampFrame).toContainElement(
      screen.getByTestId("photo-floor-anchor-lamp_01"),
    );
  });

  // Important QA regression: `move_object lamp_01 -> {x: -0.2, z: 0.4}` put the lamp
  // on the Oak Frame Table by the inspector's reckoning while drawing it standing on
  // the table's lower shelf. The lamp's own silhouette now bottoms out on the drawn
  // tabletop.
  test("stands a lamp moved onto the table on the tabletop it is drawn with", () => {
    const store = createSceneStore(createDemoScene());
    renderStage(store);
    act(() => {
      store.getState().commitTransform("lamp_01", [-0.2, 0, 0.4], 0);
    });

    const table = objectFromStore(store, "table_01");
    const lamp = objectFromStore(store, "lamp_01");
    expect(supportOf(store.getState().scene, lamp)?.id).toBe("table_01");

    const tableSilhouette = silhouetteBounds("table_01", table);
    const lampSilhouette = silhouetteBounds("lamp_01", lamp);
    const tableHeight = tableSilhouette.bottom - tableSilhouette.top;

    // Inside the top 40% of the table's silhouette: on the top, not on the shelf.
    expect(lampSilhouette.bottom).toBeGreaterThanOrEqual(tableSilhouette.top);
    expect(lampSilhouette.bottom).toBeLessThanOrEqual(
      tableSilhouette.top + 0.4 * tableHeight,
    );

    // And never below the table's own floor projection less the visible depth of
    // its top surface, which is the lowest point the tabletop reaches.
    const tableFloor = projectRoomPoint(
      { x: table.position[0], z: table.position[2] },
      store.getState().scene.room,
    ).top;
    const drawnTableHeight =
      table.dimensionsM.height *
      verticalScaleAt(
        floorDepthFraction(table.position[2], store.getState().scene.room),
        store.getState().scene.room,
      ) *
      STAGE_ASPECT;
    expect(lampSilhouette.bottom).toBeLessThanOrEqual(
      tableFloor - (tableHeight - drawnTableHeight),
    );

    // The calibrated lift alone would have left the lamp below the tabletop.
    const calibrated = tableFloor - objectElevationOffset(lamp, store.getState().scene.room);
    expect(calibrated).toBeGreaterThan(tableSilhouette.top + 0.4 * tableHeight);
  });

  test("renders the chair on the right with the mirrored front-quarter view and no CSS rotation", () => {
    const { stage } = renderStage();

    const frame = screen.getByTestId("photo-object-frame-chair_01");
    expect(frame.dataset.photoView).toBe("front-quarter");
    expect(frame.dataset.photoMirrored).toBe("true");
    expect(frame.dataset.photoApproximate).toBe("false");
    expect(frame.style.transform).not.toContain("rotate(");
    const image = within(frame).getByRole("button").querySelector("img");
    if (!image) throw new Error("Missing chair cutout image");
    expect(getComputedStyle(image).transform || image.style.transform).toContain(
      "scaleX(-1)",
    );
    expect(image.dataset.photoView).toBe("front-quarter");
    expect(image.dataset.photoMirrored).toBe("true");

    for (const objectFrame of within(stage).getAllByTestId(
      /^photo-object-frame-/,
    )) {
      expect((objectFrame as HTMLElement).style.transform).not.toContain(
        "rotate(",
      );
    }
  });

  test("keeps the sofa on the left un-mirrored", () => {
    renderStage();

    const frame = screen.getByTestId("photo-object-frame-sofa_01");
    expect(frame.dataset.photoView).toBe("front-quarter");
    expect(frame.dataset.photoMirrored).toBe("false");
    expect(frame.dataset.photoApproximate).toBe("false");
    const image = within(frame).getByRole("button").querySelector("img");
    if (!image) throw new Error("Missing sofa cutout image");
    expect(
      getComputedStyle(image).transform || image.style.transform,
    ).not.toContain("scaleX(-1)");
  });

  test("marks a 90° keyboard rotation approximate when no side view exists", () => {
    const store = fixtureStore();
    store.getState().selectObject("sofa_01");
    store.getState().setToolMode("rotate");
    renderStage(store);
    const sofa = screen.getByRole("button", { name: "Sofa" });

    for (let step = 0; step < 6; step += 1) {
      fireEvent.keyDown(sofa, { key: "ArrowRight", shiftKey: true });
    }

    expect(objectFromStore(store, "sofa_01").rotation[1]).toBeCloseTo(
      Math.PI / 2,
    );
    const frame = screen.getByTestId("photo-object-frame-sofa_01");
    expect(frame.dataset.photoApproximate).toBe("true");
    expect(frame.dataset.photoMirrored).toBe("true");
    expect(frame.style.transform).not.toContain("rotate(");
    expect(screen.getByText(/approximate/i)).toBeInTheDocument();
  });
});

describe("keyboard focus", () => {
  test("follows a new selection onto that object's cutout", () => {
    const { store } = renderStage();
    expect(document.activeElement).toBe(document.body);

    act(() => store.getState().selectObject("chair_01"));

    const chair = screen.getByRole("button", { name: "Chair" });
    expect(chair).toHaveAttribute("data-object-id", "chair_01");
    expect(document.activeElement).toBe(chair);
  });

  test("leaves focus where it is when the user is typing", () => {
    const store = fixtureStore();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      STAGE_RECT,
    );
    render(
      <SceneStoreProvider store={store}>
        <input aria-label="Ask OpenRoom" />
        <RoomPhotoStage />
      </SceneStoreProvider>,
    );
    const field = screen.getByRole("textbox", { name: "Ask OpenRoom" });
    act(() => field.focus());

    act(() => store.getState().selectObject("chair_01"));

    expect(document.activeElement).toBe(field);
    expect(store.getState().scene.selectedObjectId).toBe("chair_01");
  });

  test("moves off another object's cutout, where the arrows would be dead", () => {
    const { store } = renderStage();
    const chair = screen.getByRole("button", { name: "Chair" });
    act(() => chair.focus());

    act(() => store.getState().selectObject("plant_01"));

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Plant" }),
    );
  });

  // Important QA regression: Escape cleared the selection but left focus on the
  // cutout, so the room kept a ring on a piece the inspector called unselected.
  test("selecting null moves focus out of the stage and back to the rail", () => {
    const store = fixtureStore();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      STAGE_RECT,
    );
    render(
      <SceneStoreProvider store={store}>
        <button data-rail-object-id="chair_01" type="button">
          Chair rail
        </button>
        <RoomPhotoStage />
      </SceneStoreProvider>,
    );
    const stage = screen.getByRole("region", { name: "Editable room photo" });
    const rail = screen.getByRole("button", { name: "Chair rail" });

    act(() => store.getState().selectObject("chair_01"));
    expect(stage.contains(document.activeElement)).toBe(true);

    act(() => store.getState().selectObject(null));

    expect(stage.contains(document.activeElement)).toBe(false);
    expect(document.activeElement).toBe(rail);
  });

  test("parks focus on the stage when the cleared object has no rail button", () => {
    const { stage, store } = renderStage();
    act(() => store.getState().selectObject("chair_01"));
    const chair = screen.getByRole("button", { name: "Chair" });
    expect(document.activeElement).toBe(chair);

    act(() => store.getState().selectObject(null));

    expect(document.activeElement).toBe(stage);
    expect(chair).not.toHaveFocus();
  });

  test("leaves focus outside the room alone when the selection is cleared", () => {
    const store = fixtureStore();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      STAGE_RECT,
    );
    render(
      <SceneStoreProvider store={store}>
        <input aria-label="Ask OpenRoom" />
        <RoomPhotoStage />
      </SceneStoreProvider>,
    );
    const field = screen.getByRole("textbox", { name: "Ask OpenRoom" });
    act(() => field.focus());

    act(() => store.getState().selectObject(null));

    expect(document.activeElement).toBe(field);
  });

  test("reaches the cutout when a tool is picked, so arrows reach the piece", () => {
    const { store } = renderStage();
    expect(store.getState().scene.selectedObjectId).toBe("table_01");
    const before = objectFromStore(store, "table_01").rotation[1];

    act(() => store.getState().setToolMode("rotate"));

    const table = screen.getByRole("button", { name: "Coffee table" });
    expect(document.activeElement).toBe(table);

    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });

    expect(objectFromStore(store, "table_01").rotation[1]).toBeCloseTo(
      before + (5 * Math.PI) / 180,
    );
  });

  // Important QA regression: clicking the already-active tool, or the rail item
  // for the already-selected piece, was a silent no-op that left focus (and so
  // the arrow keys) on the button that was clicked.
  test("clicking Rotate twice keeps arrows working", () => {
    const store = fixtureStore();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      STAGE_RECT,
    );
    render(
      <SceneStoreProvider store={store}>
        <button
          data-rail-object-id="table_01"
          onClick={() => store.getState().selectObject("table_01")}
          type="button"
        >
          Coffee table rail
        </button>
        <RoomPhotoStage />
      </SceneStoreProvider>,
    );
    const rotateTool = () => act(() => store.getState().setToolMode("rotate"));
    const table = screen.getByRole("button", { name: "Coffee table" });
    const rail = screen.getByRole("button", { name: "Coffee table rail" });

    rotateTool();
    expect(document.activeElement).toBe(table);

    // The keyboard user walks back to the rail, then re-picks the same tool.
    act(() => rail.focus());
    rotateTool();
    expect(document.activeElement).toBe(table);

    const before = objectFromStore(store, "table_01").rotation[1];
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(objectFromStore(store, "table_01").rotation[1]).toBeCloseTo(
      before + (5 * Math.PI) / 180,
    );

    // And re-clicking the rail item for the piece that is already selected.
    act(() => rail.focus());
    fireEvent.click(rail);
    expect(document.activeElement).toBe(table);
  });
});
