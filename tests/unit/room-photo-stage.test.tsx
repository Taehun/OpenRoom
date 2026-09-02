import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createDemoScene } from "../../src/demo/demo-scene";
import { RoomPhotoStage } from "../../src/features/photo/room-photo-stage";
import { SceneStoreProvider } from "../../src/features/scene/scene-context";
import { createSceneStore } from "../../src/features/scene/scene-store";

const STAGE_RECT = {
  bottom: 550,
  height: 450,
  left: 100,
  right: 900,
  top: 100,
  width: 800,
  x: 100,
  y: 100,
  toJSON: () => ({}),
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderStage(store = createSceneStore()) {
  const result = render(
    <SceneStoreProvider store={store}>
      <RoomPhotoStage />
    </SceneStoreProvider>,
  );
  const stage = screen.getByRole("region", { name: "Editable room photo" });
  vi.spyOn(stage, "getBoundingClientRect").mockReturnValue(STAGE_RECT);
  return { ...result, stage, store };
}

function objectFromStore(store: ReturnType<typeof createSceneStore>, id: string) {
  const object = store.getState().scene.objects.find((item) => item.id === id);
  if (!object) throw new Error(`Missing scene object ${id}`);
  return object;
}

describe("RoomPhotoStage", () => {
  test("renders the six initial room objects as labelled button controls", () => {
    const { stage } = renderStage();

    const buttons = within(stage).getAllByRole("button");
    expect(buttons).toHaveLength(6);
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Sofa",
      "Coffee table",
      "Rug",
      "Floor lamp",
      "Chair",
      "Plant",
    ]);
    expect(
      screen.getByRole("button", { name: "Coffee table" }),
    ).toHaveAttribute("aria-pressed", "true");
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
      [expect.closeTo(0.8653846154), 0.21, -2.4],
      0,
    );
    expect(objectFromStore(store, "table_01").position).toEqual([
      expect.closeTo(0.8653846154),
      0.21,
      expect.closeTo(-2),
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

  test("rotates a focused non-rug by one keyboard command and omits rug rotation", () => {
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
    expect(fireEvent.keyDown(rug, { key: "ArrowRight" })).toBe(true);
    expect(commit).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByRole("button", { name: "Rotate Rug" }),
    ).not.toBeInTheDocument();
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
    expect(frame.style.transform).not.toContain("scale(");
    const floorAnchor = screen.getByTestId("photo-floor-anchor-table_01");
    const handle = screen.getByRole("button", { name: "Rotate Coffee table" });
    expect(frame).toContainElement(floorAnchor);
    expect(frame).toContainElement(handle);
  });
});
