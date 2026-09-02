import { describe, expect, it } from "vitest";
import { PHOTO_ASSETS } from "../../src/features/photo/photo-assets";
import type { NormalizedQuad } from "../../src/features/photo/photo-assets";
import { NOOK_PHOTO_CALIBRATION } from "../../src/features/photo/photo-calibration";
import {
  layerOrder,
  objectVisualWidth,
  projectContactShadow,
  projectRoomPoint,
  projectRugPlacement,
  stableLayerOrder,
  unprojectStagePoint,
} from "../../src/features/photo/photo-projection";
import {
  applyProjectiveTransform,
  isValidFloorQuad,
  projectiveTransformCss,
  solveProjectiveTransform,
} from "../../src/features/photo/projective-transform";
import { completedProductScene } from "../helpers/natural-placement-fixtures";

const room = { width: 6, depth: 4.8, height: 2.8 };

describe("photo projection", () => {
  it("projects and inverts the room center", () => {
    const projected = projectRoomPoint({ x: 0, z: 0 }, room);
    const restored = unprojectStagePoint(projected, room);
    expect(restored.x).toBeCloseTo(0, 5);
    expect(restored.z).toBeCloseTo(0, 5);
  });

  it("maps back and front room corners to calibrated floor limits", () => {
    expect(projectRoomPoint({ x: -3, z: -2.4 }, room)).toMatchObject({
      left: NOOK_PHOTO_CALIBRATION.backLeft.x,
      top: NOOK_PHOTO_CALIBRATION.backFloorY,
      scale: NOOK_PHOTO_CALIBRATION.minScale,
    });
    expect(projectRoomPoint({ x: 3, z: 2.4 }, room)).toMatchObject({
      left: NOOK_PHOTO_CALIBRATION.frontRight.x,
      top: NOOK_PHOTO_CALIBRATION.frontFloorY,
      scale: NOOK_PHOTO_CALIBRATION.maxScale,
    });
  });

  it("clamps pointer coordinates before inversion", () => {
    expect(unprojectStagePoint({ x: -2, y: 3 }, room)).toEqual({
      x: -3,
      z: 2.4,
    });
  });

  it("keeps rugs below furniture at the same depth", () => {
    expect(layerOrder("rug", 700)).toBeLessThan(layerOrder("sofa", 700));
  });

  it("applies depth scale once before clamping width by object category", () => {
    expect(objectVisualWidth(2, 0.8, "sofa")).toBeCloseTo(28.8);
    expect(objectVisualWidth(2.2, 0.8, "sofa")).toBeGreaterThan(
      objectVisualWidth(1.8, 0.8, "sofa"),
    );
    expect(objectVisualWidth(0.45, 1, "floor_lamp")).toBeCloseTo(8.1);
  });

  it("preserves catalog physical-width ordering with one depth scale", () => {
    const depth = 0.8;
    expect(objectVisualWidth(2.4, depth, "rug")).toBeGreaterThan(
      objectVisualWidth(2.24, depth, "sofa"),
    );
    expect(objectVisualWidth(2.24, depth, "sofa")).toBeGreaterThan(
      objectVisualWidth(1.1, depth, "coffee_table"),
    );
    expect(objectVisualWidth(1.1, depth, "coffee_table")).toBeGreaterThan(
      objectVisualWidth(0.58, depth, "floor_lamp"),
    );
  });

  it("anchors a bounded contact shadow to the physical footprint", () => {
    const scene = completedProductScene();
    const sofa = scene.objects.find(({ id }) => id === "sofa_01")!;
    const shadow = projectContactShadow(sofa, scene.room);
    const anchor = projectRoomPoint(
      { x: sofa.position[0], z: sofa.position[2] },
      scene.room,
    );

    expect(shadow.left).toBeCloseTo(anchor.left, 6);
    expect(shadow.top).toBeCloseTo(anchor.top, 6);
    expect(shadow.width).toBeGreaterThan(shadow.height);
    expect(shadow.opacity).toBeGreaterThan(0);
    expect(shadow.opacity).toBeLessThanOrEqual(0.28);
  });

  it("uses lexical object IDs to stabilize equal-depth vertical layers", () => {
    const scene = completedProductScene();
    const chair = scene.objects.find(({ id }) => id === "chair_01")!;
    const table = scene.objects.find(({ id }) => id === "table_01")!;
    table.position[2] = chair.position[2];
    const placement = projectRoomPoint(
      { x: chair.position[0], z: chair.position[2] },
      scene.room,
    );
    const lexicalIds = [chair.id, table.id].toSorted();

    expect(
      stableLayerOrder(chair, placement, lexicalIds.indexOf(chair.id)),
    ).toBeLessThan(
      stableLayerOrder(table, placement, lexicalIds.indexOf(table.id)),
    );
  });

  it("keeps every rug underlay below every vertical object", () => {
    const scene = completedProductScene();
    const rug = scene.objects.find(({ id }) => id === "rug_01")!;
    const lamp = scene.objects.find(({ id }) => id === "lamp_01")!;
    const rugPlacement = projectRoomPoint(
      { x: rug.position[0], z: scene.room.depth / 2 },
      scene.room,
    );
    const lampPlacement = projectRoomPoint(
      { x: lamp.position[0], z: -scene.room.depth / 2 },
      scene.room,
    );

    expect(stableLayerOrder(rug, rugPlacement, 5)).toBeLessThan(
      stableLayerOrder(lamp, lampPlacement, 0),
    );
  });

  it("maps every registered rug corner to its projected physical footprint", () => {
    const scene = completedProductScene();
    const rug = scene.objects.find(({ id }) => id === "rug_01")!;
    const asset = PHOTO_ASSETS[rug.assetId!]!;
    const projection = projectRugPlacement(rug, asset, scene.room, {
      width: 1024,
      height: 576,
    });

    expect(asset.id).toBe("woven-jute-rug");
    expect(projection).not.toBeNull();
    const expectedSourcePixels = [
      { x: 780.288, y: 226.304 },
      { x: 1489.92, y: 329.728 },
      { x: 1161.216, y: 942.08 },
      { x: 18.432, y: 603.136 },
    ] as const;
    expectedSourcePixels.forEach((point, index) => {
      expect(projection!.sourcePixels[index]!.x).toBeCloseTo(point.x, 6);
      expect(projection!.sourcePixels[index]!.y).toBeCloseTo(point.y, 6);
    });
    expect(projection!.destinationNormalized).toEqual([
      { x: 0.37016666666666664, y: 0.6691666666666667 },
      { x: 0.6298333333333334, y: 0.6691666666666667 },
      { x: 0.6581666666666667, y: 0.8108333333333333 },
      { x: 0.3418333333333333, y: 0.8108333333333333 },
    ]);
    expect(projection!.destinationPixels).toEqual([
      { x: 379.05066666666664, y: 385.44 },
      { x: 644.9493333333334, y: 385.44 },
      { x: 673.9626666666667, y: 467.03999999999996 },
      { x: 350.0373333333333, y: 467.03999999999996 },
    ]);
    projection!.sourcePixels.forEach((source, index) => {
      const mapped = applyProjectiveTransform(projection!.transform, source);
      expect(mapped.x).toBeCloseTo(
        projection!.destinationPixels[index]!.x,
        2,
      );
      expect(mapped.y).toBeCloseTo(
        projection!.destinationPixels[index]!.y,
        2,
      );
    });
  });

  it("uses physical rug width and depth for the destination quadrilateral", () => {
    const scene = completedProductScene();
    const rug = structuredClone(
      scene.objects.find(({ id }) => id === "rug_01")!,
    );
    const asset = PHOTO_ASSETS[rug.assetId!]!;
    rug.dimensionsM = { ...rug.dimensionsM, width: 1.2, depth: 2 };

    expect(
      projectRugPlacement(rug, asset, scene.room, {
        width: 1024,
        height: 576,
      })?.destinationNormalized,
    ).toEqual([
      { x: 0.4363333333333333, y: 0.6566666666666667 },
      { x: 0.5636666666666666, y: 0.6566666666666667 },
      { x: 0.5803333333333333, y: 0.8233333333333333 },
      { x: 0.4196666666666666, y: 0.8233333333333333 },
    ]);
  });

  it("uses the Scene Y rotation for the destination quadrilateral", () => {
    const scene = completedProductScene();
    const rug = structuredClone(
      scene.objects.find(({ id }) => id === "rug_01")!,
    );
    const asset = PHOTO_ASSETS[rug.assetId!]!;
    rug.dimensionsM = { ...rug.dimensionsM, width: 1.2, depth: 2 };
    rug.rotation[1] = Math.PI / 2;

    const destination = projectRugPlacement(rug, asset, scene.room, {
      width: 1024,
      height: 576,
    })?.destinationNormalized;
    const expected = [
      { x: 0.6116666666666666, y: 0.69 },
      { x: 0.6283333333333333, y: 0.79 },
      { x: 0.37166666666666665, y: 0.79 },
      { x: 0.3883333333333333, y: 0.69 },
    ] as const;

    expect(destination).toHaveLength(4);
    expected.forEach((point, index) => {
      expect(destination![index]!.x).toBeCloseTo(point.x, 12);
      expect(destination![index]!.y).toBeCloseTo(point.y, 12);
    });
  });

  it.each([
    [
      "degenerate",
      [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.1, y: 0.9 },
      ],
    ],
    [
      "counter-clockwise",
      [
        { x: 0.1, y: 0.1 },
        { x: 0.1, y: 0.9 },
        { x: 0.9, y: 0.9 },
        { x: 0.9, y: 0.1 },
      ],
    ],
    [
      "out-of-range",
      [
        { x: -0.01, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.9, y: 0.9 },
        { x: 0.1, y: 0.9 },
      ],
    ],
    [
      "non-finite",
      [
        { x: Number.NaN, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.9, y: 0.9 },
        { x: 0.1, y: 0.9 },
      ],
    ],
    [
      "self-intersecting",
      [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.9 },
        { x: 0.9, y: 0.1 },
        { x: 0.1, y: 0.9 },
      ],
    ],
  ])("rejects a %s source floor quadrilateral", (_name, quad) => {
    expect(isValidFloorQuad(quad as unknown as NormalizedQuad)).toBe(false);
  });

  it("fails safely when a four-point transform is degenerate", () => {
    expect(
      solveProjectiveTransform(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 2, y: 0 },
          { x: 3, y: 0 },
        ],
        [
          { x: 10, y: 10 },
          { x: 20, y: 10 },
          { x: 20, y: 20 },
          { x: 10, y: 20 },
        ],
      ),
    ).toBeNull();
  });

  it("returns null for invalid or out-of-domain rug placements", () => {
    const scene = completedProductScene();
    const rug = structuredClone(
      scene.objects.find(({ id }) => id === "rug_01")!,
    );
    const asset = PHOTO_ASSETS[rug.assetId!]!;
    const stage = { width: 1024, height: 576 };
    const invalidAsset = {
      ...asset,
      floorQuad: [...asset.floorQuad!].reverse() as unknown as NormalizedQuad,
    };

    expect(projectRugPlacement({ ...rug, type: "chair" }, asset, scene.room, stage))
      .toBeNull();
    expect(projectRugPlacement(rug, { ...asset, floorQuad: undefined }, scene.room, stage))
      .toBeNull();
    expect(projectRugPlacement(rug, invalidAsset, scene.room, stage)).toBeNull();
    expect(projectRugPlacement(rug, asset, scene.room, { ...stage, width: 0 }))
      .toBeNull();
    expect(projectRugPlacement(rug, asset, scene.room, { ...stage, height: 0 }))
      .toBeNull();
    rug.position[0] = scene.room.width / 2;
    expect(projectRugPlacement(rug, asset, scene.room, stage)).toBeNull();
  });

  it("serializes a homography in DOMMatrix column order", () => {
    expect(projectiveTransformCss([1, 2, 3, 4, 5, 6, 7, 8, 1])).toBe(
      "matrix3d(1, 4, 0, 7, 2, 5, 0, 8, 0, 0, 1, 0, 3, 6, 0, 1)",
    );
  });
});
