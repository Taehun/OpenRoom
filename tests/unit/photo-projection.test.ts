import { describe, expect, it } from "vitest";
import { PHOTO_ASSETS } from "../../src/features/photo/photo-assets";
import type { NormalizedQuad } from "../../src/features/photo/photo-assets";
import { OPENROOM_PHOTO_CALIBRATION } from "../../src/features/photo/photo-calibration";
import {
  floorWidthAt,
  layerOrder,
  objectElevationOffset,
  objectVisualWidth,
  projectContactShadow,
  projectRoomPoint,
  projectRugPlacement,
  stableLayerOrder,
  supportedTopOffset,
  unprojectStagePoint,
  verticalScaleAt,
  silhouetteExtentM,
} from "../../src/features/photo/photo-projection";
import {
  applyProjectiveTransform,
  isValidFloorQuad,
  projectiveTransformCss,
  solveProjectiveTransform,
} from "../../src/features/photo/projective-transform";
import type { SceneObject } from "../../src/features/scene/scene-schema";
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
      left: OPENROOM_PHOTO_CALIBRATION.backLeft.x,
      top: OPENROOM_PHOTO_CALIBRATION.backFloorY,
      scale: OPENROOM_PHOTO_CALIBRATION.minScale,
    });
    expect(projectRoomPoint({ x: 3, z: 2.4 }, room)).toMatchObject({
      left: OPENROOM_PHOTO_CALIBRATION.frontRight.x,
      top: OPENROOM_PHOTO_CALIBRATION.frontFloorY,
      scale: OPENROOM_PHOTO_CALIBRATION.maxScale,
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

  // Spec §3: every cutout is sized from its real width and the calibrated floor
  // width where it stands, so the old `widthM * 18 * depthScale` heuristic and its
  // per-category clamps are gone. 0.52 of the stage spans the room at the back wall
  // and 0.92 at the front, so a 2 m object in a 6 m room always covers a third of it.
  const testObject = (overrides: Partial<SceneObject>): SceneObject => {
    const scene = completedProductScene();
    const sofa = structuredClone(
      scene.objects.find(({ id }) => id === "sofa_01")!,
    );
    return { ...sofa, ...overrides };
  };

  const boxAt = (
    widthM: number,
    z: number,
    overrides: Partial<SceneObject> = {},
  ): SceneObject =>
    testObject({
      position: [0, 0.5, z],
      rotation: [0, 0, 0],
      dimensionsM: { width: widthM, height: 1, depth: 0.9 },
      ...overrides,
    });

  it("sizes an axis-aligned object from the floor width at its depth", () => {
    expect(objectVisualWidth(boxAt(2, -room.depth / 2), room)).toBeCloseTo(
      (2 / 6) * 0.52 * 100,
      10,
    );
    expect(objectVisualWidth(boxAt(2, room.depth / 2), room)).toBeCloseTo(
      (2 / 6) * 0.92 * 100,
      10,
    );
    expect(objectVisualWidth(boxAt(2, 0), room)).toBeCloseTo(
      (2 / 6) * 0.72 * 100,
      10,
    );
  });

  it("interpolates the projected width between the calibrated depths", () => {
    const quarter = objectVisualWidth(boxAt(2, -room.depth / 4), room);

    expect(quarter).toBeCloseTo((2 / 6) * 0.62 * 100, 10);
    expect(quarter).toBeGreaterThan(
      objectVisualWidth(boxAt(2, -room.depth / 2), room),
    );
    expect(quarter).toBeLessThan(objectVisualWidth(boxAt(2, 0), room));
  });

  it("widens a rotated footprint to its projected lateral extent", () => {
    const square = { width: 1, height: 1, depth: 1 };
    const turned = objectVisualWidth(
      boxAt(1, 0, { dimensionsM: square, rotation: [0, Math.PI / 4, 0] }),
      room,
    );
    const aligned = objectVisualWidth(boxAt(1, 0, { dimensionsM: square }), room);

    expect(turned).toBeCloseTo((Math.SQRT2 / 6) * 0.72 * 100, 10);
    expect(aligned).toBeCloseTo((1 / 6) * 0.72 * 100, 10);
    expect(turned).toBeGreaterThan(aligned);
  });

  it("keeps catalog width ordering without per-category clamps", () => {
    expect(objectVisualWidth(boxAt(2.4, 0, { type: "rug" }), room)).toBeCloseTo(
      28.8,
      10,
    );
    expect(objectVisualWidth(boxAt(2.24, 0), room)).toBeCloseTo(26.88, 10);
    expect(
      objectVisualWidth(boxAt(1.1, 0, { type: "coffee_table" }), room),
    ).toBeCloseTo(13.2, 10);
    expect(
      objectVisualWidth(boxAt(0.58, 0, { type: "floor_lamp" }), room),
    ).toBeCloseTo(6.96, 10);
  });

  it("keeps a sliver-thin footprint readable with one global floor", () => {
    expect(objectVisualWidth(boxAt(0.2, 0), room)).toBeCloseTo(2.4, 10);
    expect(objectVisualWidth(boxAt(0.05, 0), room)).toBe(1.5);
  });

  it("derives the floor width and the vertical scale from the calibration", () => {
    expect(floorWidthAt(0)).toBeCloseTo(0.52, 12);
    expect(floorWidthAt(0.5)).toBeCloseTo(0.72, 12);
    expect(floorWidthAt(1)).toBeCloseTo(0.92, 12);
    expect(floorWidthAt(-3)).toBeCloseTo(floorWidthAt(0), 12);
    expect(floorWidthAt(4)).toBeCloseTo(floorWidthAt(1), 12);
    expect(verticalScaleAt(0, room)).toBeCloseTo(0.52 / 6, 12);
    expect(verticalScaleAt(0.5, room)).toBeCloseTo(0.72 / 6, 12);
    expect(verticalScaleAt(1, room)).toBeCloseTo(0.92 / 6, 12);
  });

  it("raises only an object standing above its resting height", () => {
    const lamp = { width: 0.35, height: 1.6, depth: 0.35 };
    const resting = boxAt(0.35, 0, {
      type: "floor_lamp",
      dimensionsM: lamp,
      position: [0, 0.8, 0],
    });
    const onTable = boxAt(0.35, 0, {
      type: "floor_lamp",
      dimensionsM: lamp,
      position: [0, 0.42 + 0.8, 0],
    });
    const onTableAtTheBackWall = boxAt(0.35, -room.depth / 2, {
      type: "floor_lamp",
      dimensionsM: lamp,
      position: [0, 0.42 + 0.8, -room.depth / 2],
    });

    expect(objectElevationOffset(resting, room)).toBe(0);
    expect(objectElevationOffset(onTable, room)).toBeCloseTo(
      0.42 * verticalScaleAt(0.5, room),
      12,
    );
    expect(objectElevationOffset(onTableAtTheBackWall, room)).toBeCloseTo(
      0.42 * verticalScaleAt(0, room),
      12,
    );
  });

  // Important QA regression: the calibrated lift drew a lamp standing on a table's
  // lower shelf. A cutout is scaled by its width and keeps its picture's aspect, so
  // the supporter's drawn top is where the photograph puts it, not where the
  // calibration says the object ends.
  describe("standing on a supporter's drawn top", () => {
    const table = boxAt(1.2, 0, {
      type: "coffee_table",
      dimensionsM: { width: 1.2, height: 0.42, depth: 0.6 },
      position: [0, 0.21, 0],
      rotation: [0, 0, 0],
    });
    // A 3:2 picture whose furniture fills the middle 70% of its height.
    const tablePresentation = {
      view: "front-quarter" as const,
      symmetry: "front-back" as const,
      contentBox: { left: 0, right: 1, top: 0.2, bottom: 0.9 },
      intrinsicWidth: 1536,
      intrinsicHeight: 1024,
    };
    const stage = { width: 1024, height: 576 };
    const lampAt = (z: number) => ({ position: [0, 1.22, z] as SceneObject["position"] });

    it("anchors the object to the top the supporter's picture draws", () => {
      // 1.2·cos35° + 0.6·sin35° = 1.32713 m spans 15.9256% of a 6 m room at mid
      // depth, so the 3:2 picture is 18.8747% of the 16:9 stage's height and its
      // silhouette 70% of that, 13.2123%. The calibration gives the table
      // 0.42 · 0.12 · 16/9 = 8.96% of it; the remaining 4.2523% is its top surface
      // seen from above, and the lamp rides half of that back from the front edge.
      const centre = supportedTopOffset(
        lampAt(0),
        table,
        tablePresentation,
        room,
        stage,
      );
      const back = supportedTopOffset(
        lampAt(-0.3),
        table,
        tablePresentation,
        room,
        stage,
      );
      const front = supportedTopOffset(
        lampAt(0.3),
        table,
        tablePresentation,
        room,
        stage,
      );

      expect(centre).toBeCloseTo(0.1108615, 6);
      expect(back).toBeCloseTo(0.0896, 6);
      expect(front).toBeCloseTo(0.132123, 6);
      expect(centre).toBeCloseTo(((back ?? 0) + (front ?? 0)) / 2, 12);
      // The calibrated lift is the same number in the wrong unit: a fraction of the
      // stage width where a fraction of its height is needed.
      expect(centre).toBeGreaterThan(
        objectElevationOffset(
          boxAt(0.35, 0, {
            type: "floor_lamp",
            dimensionsM: { width: 0.35, height: 1.6, depth: 0.35 },
            position: [0, 1.22, 0],
          }),
          room,
        ),
      );
    });

    it("declines a supporter with no measured picture, so the caller can fall back", () => {
      expect(
        supportedTopOffset(lampAt(0), table, {}, room, stage),
      ).toBeNull();
      expect(
        supportedTopOffset(
          lampAt(0),
          table,
          { ...tablePresentation, intrinsicWidth: 0 },
          room,
          stage,
        ),
      ).toBeNull();
    });

    it("falls back to the stylesheet's 16:9 box before the stage is measured", () => {
      expect(
        supportedTopOffset(lampAt(0), table, tablePresentation, room),
      ).toBeCloseTo(
        supportedTopOffset(lampAt(0), table, tablePresentation, room, stage)!,
        12,
      );
      expect(
        supportedTopOffset(lampAt(0), table, tablePresentation, room, {
          width: 0,
          height: 0,
        }),
      ).toBeCloseTo(0.1108615, 6);
    });
  });

  it("keeps a rug lying at its 0.01 resting height on the floor", () => {
    const rug = boxAt(2.4, 0, {
      type: "rug",
      dimensionsM: { width: 2.4, height: 0.01, depth: 1.7 },
      position: [0, 0.01, 0],
    });

    expect(objectElevationOffset(rug, room)).toBe(0);
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

  it("derives a 45-degree shadow once from its projected screen axes", () => {
    const scene = completedProductScene();
    const sofa = structuredClone(
      scene.objects.find(({ id }) => id === "sofa_01")!,
    );
    sofa.position = [0, sofa.position[1], 0];
    sofa.dimensionsM = { ...sofa.dimensionsM, width: 2, depth: 1 };
    sofa.rotation[1] = Math.PI / 4;

    const shadow = projectContactShadow(sofa, scene.room);

    // Centred on the projected footprint centre, exactly where the cutout is anchored.
    expect(shadow.left).toBeCloseTo(0.5, 12);
    expect(shadow.top).toBeCloseTo(0.74, 12);
    expect(shadow.width).toBeCloseTo(13.117943817534822, 12);
    expect(shadow.height).toBeCloseTo(5.668247328564432, 12);
    expect(shadow.rotationDegrees).toBeCloseTo(21.33685929180563, 12);
  });

  it("keeps a 90-degree shadow aligned to the projected physical axes", () => {
    const scene = completedProductScene();
    const sofa = structuredClone(
      scene.objects.find(({ id }) => id === "sofa_01")!,
    );
    sofa.position = [0, sofa.position[1], 0];
    sofa.dimensionsM = { ...sofa.dimensionsM, width: 2, depth: 1 };
    sofa.rotation[1] = Math.PI / 2;

    const shadow = projectContactShadow(sofa, scene.room);

    expect(shadow.left).toBeCloseTo(0.5, 12);
    expect(shadow.top).toBeCloseTo(0.74, 12);
    expect(shadow.width).toBeCloseTo(6.75, 12);
    expect(shadow.height).toBeCloseTo(7.46666666666667, 12);
    expect(shadow.rotationDegrees).toBeCloseTo(90, 12);
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

describe("silhouette-aware visual width", () => {
  const room = { width: 3.4, depth: 2.72 };
  const sofa = {
    id: "sofa_01", type: "sofa" as const, source: "placeholder" as const,
    position: [0, 0.425, -0.55] as [number, number, number], rotation: [0, 0, 0] as [number, number, number],
    scale: [1, 1, 1] as [number, number, number], dimensionsM: { width: 2, height: 0.85, depth: 0.9 },
    locked: false, styleTags: [], addedBy: "seed" as const,
  };

  it("measures a front-quarter silhouette as width·cos35° + depth·sin35°", () => {
    const extent = silhouetteExtentM({ width: 2, depth: 0.9 }, { view: "front-quarter", symmetry: "none" });
    expect(extent).toBeCloseTo(2 * Math.cos((35 * Math.PI) / 180) + 0.9 * Math.sin((35 * Math.PI) / 180), 6);
    expect(silhouetteExtentM({ width: 0.35, depth: 0.35 }, { symmetry: "radial" })).toBe(0.35);
    expect(silhouetteExtentM({ width: 2, depth: 0.9 }, { view: "side", symmetry: "none" })).toBe(0.9);
    expect(silhouetteExtentM({ width: 2, depth: 0.9 }, { view: "back", symmetry: "none" })).toBe(2);
  });

  it("scales the image up by the inverse of its content fill", () => {
    const full = objectVisualWidth(sofa, room, { view: "front-quarter", symmetry: "none" });
    const half = objectVisualWidth(sofa, room, {
      view: "front-quarter", symmetry: "none", contentBox: { left: 0.25, right: 0.75, top: 0, bottom: 1 },
    });
    expect(half).toBeCloseTo(full * 2, 9);
  });

  it("keeps the picture the same width whatever the yaw", () => {
    const turned = { ...sofa, rotation: [0, Math.PI / 2, 0] as [number, number, number] };
    const presentation = { view: "front-quarter" as const, symmetry: "none" as const };
    expect(objectVisualWidth(turned, room, presentation)).toBeCloseTo(objectVisualWidth(sofa, room, presentation), 9);
  });

  it("falls back to the projected footprint extent without a presentation", () => {
    const depth = (sofa.position[2] + room.depth / 2) / room.depth;
    const expected = (2 / room.width) * floorWidthAt(depth) * 100;
    expect(objectVisualWidth(sofa, room)).toBeCloseTo(expected, 9);
  });
});
