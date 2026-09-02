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

import { createDemoScene } from "../../src/demo/demo-scene";
import { DEMO_PRODUCTS } from "../../src/features/demo/demo-data";
import { RoomPhotoStage } from "../../src/features/photo/room-photo-stage";
import { SceneStoreProvider } from "../../src/features/scene/scene-context";
import type { CommandResult } from "../../src/features/scene/scene-schema";
import { createSceneStore } from "../../src/features/scene/scene-store";

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

function renderStage(
  store = createSceneStore(),
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

function objectFromStore(store: ReturnType<typeof createSceneStore>, id: string) {
  const object = store.getState().scene.objects.find((item) => item.id === id);
  if (!object) throw new Error(`Missing scene object ${id}`);
  return object;
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

  test("keeps a failed projected rug labelled and selectable", () => {
    const scene = createDemoScene();
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
    const scene = createDemoScene();
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
    const store = createSceneStore();
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

  test("moves by the pointer delta without jumping the floor anchor", () => {
    const store = createSceneStore();
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
      const store = createSceneStore();
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
    const store = createSceneStore();
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
    const store = createSceneStore();
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
    const scene = createDemoScene();
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
      screen.queryByRole("button", { name: "Rotate Coffee table" }),
    ).not.toBeInTheDocument();
  });

  test("clears selection when the stage itself is clicked", () => {
    const store = createSceneStore();
    const { stage } = renderStage(store);

    fireEvent.click(stage);

    expect(store.getState().scene.selectedObjectId).toBeNull();
    expect(
      screen.getByRole("button", { name: "Coffee table" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  test("keeps an unknown photo asset as a labelled selectable fallback", async () => {
    const scene = createDemoScene();
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
    const firstScene = createDemoScene();
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
    const store = createSceneStore();
    store.getState().setToolMode("move");
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

  test("rotates focused vertical objects and rugs by keyboard", () => {
    const store = createSceneStore();
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
    expect(screen.getByRole("button", { name: "Rotate Rug" })).toBeVisible();
    expect(fireEvent.keyDown(rug, { key: "ArrowRight" })).toBe(false);
    expect(commit).toHaveBeenCalledTimes(3);
    expect(objectFromStore(store, "rug_01").rotation[1]).toBeCloseTo(
      initialRugRotation + (5 * Math.PI) / 180,
    );
  });

  test("previews and commits rug rotation from its aligned floor handle", () => {
    const store = createSceneStore();
    store.getState().selectObject("rug_01");
    store.getState().setToolMode("rotate");
    const commit = vi.spyOn(store.getState(), "commitTransform");
    renderStage(store);
    const rug = screen.getByRole("button", { name: "Rug" });
    const handle = screen.getByRole("button", { name: "Rotate Rug" });
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
    const store = createSceneStore();
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
    const store = createSceneStore();
    store.getState().setToolMode("rotate");
    const commit = vi.spyOn(store.getState(), "commitTransform");
    renderStage(store);
    const handle = screen.getByRole("button", { name: "Rotate Coffee table" });

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
    const scene = createDemoScene();
    scene.objects.find(({ id }) => id === "table_01")!.rotation[1] =
      Math.PI / 3;
    const store = createSceneStore(scene);
    store.getState().setToolMode("rotate");
    renderStage(store);
    const handle = screen.getByRole("button", { name: "Rotate Coffee table" });

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
    const store = createSceneStore();
    store.getState().setToolMode("rotate");
    const { stage } = renderStage(store);
    const table = screen.getByRole("button", { name: "Coffee table" });
    const handle = screen.getByRole("button", { name: "Rotate Coffee table" });
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

  test("anchors the object frame, floor marker, and rotation handle to the asset", () => {
    const store = createSceneStore();
    store.getState().setToolMode("rotate");
    renderStage(store);

    const frame = screen.getByTestId("photo-object-frame-table_01");
    expect(frame.style.getPropertyValue("--photo-anchor-x")).toBe("50.07%");
    expect(frame.style.getPropertyValue("--photo-anchor-y")).toBe("86.13%");
    expect(frame.style.left).toBe("50%");
    expect(frame.style.top).toBe("74%");
    expect(frame.style.transform).toBe(
      "translate(-50.07%, -86.13%) rotate(0deg)",
    );
    expect(frame.style.transformOrigin).toBe("50.07% 86.13%");
    const floorAnchor = screen.getByTestId("photo-floor-anchor-table_01");
    const object = screen.getByRole("button", { name: "Coffee table" });
    const handle = screen.getByRole("button", { name: "Rotate Coffee table" });
    expect(frame).toContainElement(floorAnchor);
    expect(frame).toContainElement(handle);
    expect(floorAnchor.style.left).toBe("50.07%");
    expect(floorAnchor.style.top).toBe("86.13%");
    expect(floorAnchor.style.transform).toBe("translate(-50%, -50%)");
    expect(object.style.width).toBe("100%");
    expect(object.style.transform).toBe("none");
    expect(handle.style.left).toBe("50.07%");
    expect(handle.style.top).toBe("0px");
    expect(handle.style.transform).toBe("translate(-50%, -100%)");
  });
});
