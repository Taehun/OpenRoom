import { describe, expect, it } from "vitest";
import { createDemoScene } from "../../src/demo/demo-scene";
import { PHOTO_ASSETS } from "../../src/features/photo/photo-assets";
import { FRONT_VECTORS, facingOf } from "../../src/features/photo/photo-facing";
import {
  GeneratedViewManifestSchema,
  PHOTO_ASSET_SETS,
  PHOTO_VIEW_SYMMETRY,
  buildPhotoAssetSets,
  buildRotationOptions,
  getPhotoAssetSet,
  rotationOptionsFor,
  selectPhotoView,
  viewFidelity,
  type PhotoAssetSet,
} from "../../src/features/photo/photo-views";
import manifest from "../../src/features/photo/photo-views.generated.json";

const sofaSet = () => PHOTO_ASSET_SETS["hinoki-low-sofa"]!;

const objectAt = (
  x: number,
  yaw: number,
  type: "sofa" | "chair" | "coffee_table" | "floor_lamp" = "sofa",
) => ({
  position: [x, 0.4, 0] as [number, number, number],
  rotation: [0, yaw, 0] as [number, number, number],
  type,
});

function withViews(
  set: PhotoAssetSet,
  views: Array<"side" | "back-quarter" | "back">,
): PhotoAssetSet {
  return {
    ...set,
    views: [
      ...set.views,
      ...views.map((view) => ({
        ...set.views[0]!,
        view,
        frontVector: FRONT_VECTORS[view],
        origin: "generated" as const,
        src: `/x/${view}.webp`,
      })),
    ],
  };
}

describe("photo view registry", () => {
  it("builds one set per base asset with a photographed front-quarter view", () => {
    expect(Object.keys(PHOTO_ASSET_SETS)).toHaveLength(
      Object.keys(PHOTO_ASSETS).length,
    );
    for (const set of Object.values(PHOTO_ASSET_SETS)) {
      expect(set.views[0]).toMatchObject({
        view: "front-quarter",
        origin: "photographed",
        frontVector: FRONT_VECTORS["front-quarter"],
      });
      expect(set.type).not.toBe("unknown");
      expect(set.symmetry).toBe(PHOTO_VIEW_SYMMETRY[set.type]);
    }
    expect(PHOTO_ASSET_SETS["woven-jute-rug"]!.floorQuad).toBeDefined();
  });

  it("resolves a set by asset id", () => {
    expect(getPhotoAssetSet({ assetId: "hinoki-low-sofa" })?.id).toBe(
      "hinoki-low-sofa",
    );
    expect(getPhotoAssetSet({ assetId: "not-an-asset" })).toBeNull();
    expect(getPhotoAssetSet({})).toBeNull();
  });

  it("refuses a set with no views", () => {
    expect(() =>
      selectPhotoView(objectAt(0, 0), { ...sofaSet(), views: [] }),
    ).toThrow(/no views/i);
  });

  it("validates the checked-in manifest", () => {
    expect(GeneratedViewManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it("rejects manifest entries for unknown assets, duplicates, and front-quarter", () => {
    const entry = {
      assetId: "hinoki-low-sofa",
      view: "side",
      src: "/demo/photo/products/hinoki-low-sofa--side.webp",
      intrinsicWidth: 1536,
      intrinsicHeight: 1024,
      anchorX: 0.5,
      anchorY: 0.9,
      model: "gpt-image-1",
      generatedAt: "2026-09-03T00:00:00.000Z",
    } as const;
    const types = { "hinoki-low-sofa": "sofa" } as const;
    const base = { "hinoki-low-sofa": PHOTO_ASSETS["hinoki-low-sofa"]! };
    expect(() =>
      buildPhotoAssetSets(base, types, {
        version: 1,
        views: [{ ...entry, assetId: "nope" }],
      }),
    ).toThrow(/unknown asset/i);
    expect(() =>
      buildPhotoAssetSets(base, types, { version: 1, views: [entry, entry] }),
    ).toThrow(/duplicate/i);
    expect(
      GeneratedViewManifestSchema.safeParse({
        version: 1,
        views: [{ ...entry, view: "front-quarter" }],
      }).success,
    ).toBe(false);
    const built = buildPhotoAssetSets(base, types, {
      version: 1,
      views: [entry],
    });
    expect(built["hinoki-low-sofa"]!.views.map((v) => v.view)).toEqual([
      "front-quarter",
      "side",
    ]);
    expect(built["hinoki-low-sofa"]!.views[1]).not.toHaveProperty("model");
  });
});

describe("selectPhotoView", () => {
  it("keeps the un-mirrored front-quarter for a rotation-0 object left of centre", () => {
    const pick = selectPhotoView(objectAt(-1.7, 0), sofaSet());
    expect(pick).toMatchObject({ mirrored: false, exact: true });
    expect(pick.angleDegrees).toBeCloseTo(35, 1);
    expect(pick.anchorX).toBe(sofaSet().views[0]!.anchorX);
  });

  it("mirrors the front-quarter for a rotation-0 object right of centre", () => {
    const pick = selectPhotoView(objectAt(1.8, 0), sofaSet());
    expect(pick.mirrored).toBe(true);
    expect(pick.frontVector.x).toBeLessThan(0);
    expect(pick.anchorX).toBeCloseTo(1 - sofaSet().views[0]!.anchorX, 12);
  });

  it("uses the native view for a right-turned object anywhere", () => {
    expect(
      selectPhotoView(objectAt(1.8, -Math.PI / 4), sofaSet()).mirrored,
    ).toBe(false);
    expect(
      selectPhotoView(objectAt(-1.8, Math.PI / 4), sofaSet()).mirrored,
    ).toBe(true);
  });

  it("marks a 90° turn approximate without a side view and exact with one", () => {
    expect(selectPhotoView(objectAt(0, Math.PI / 2), sofaSet()).exact).toBe(
      false,
    );
    const pick = selectPhotoView(
      objectAt(0, -Math.PI / 2),
      withViews(sofaSet(), ["side"]),
    );
    expect(pick).toMatchObject({ mirrored: false, exact: true });
    expect(pick.view.view).toBe("side");
    expect(pick.angleDegrees).toBeCloseTo(0, 9);
  });

  it("treats a coffee table's back as its front", () => {
    const table = PHOTO_ASSET_SETS["oak-frame-table"]!;
    const pick = selectPhotoView(objectAt(-1, Math.PI, "coffee_table"), table);
    expect(pick).toMatchObject({ mirrored: false, exact: true });
  });

  it("never mirrors radial objects", () => {
    const lamp = PHOTO_ASSET_SETS["brass-globe-lamp"]!;
    expect(
      selectPhotoView(objectAt(2, Math.PI * 0.7, "floor_lamp"), lamp),
    ).toMatchObject({ mirrored: false, exact: true, angleDegrees: 0 });
  });
});

describe("viewFidelity and rotation options", () => {
  it("scores photographed, mirrored, and generated coverage", () => {
    const set = withViews(sofaSet(), ["side"]);
    expect(viewFidelity(facingOf(0), sofaSet())).toBe(1);
    expect(viewFidelity(facingOf(Math.PI / 4), sofaSet())).toBeCloseTo(0.95, 12);
    expect(viewFidelity(facingOf(-Math.PI / 2), sofaSet())).toBe(0);
    expect(viewFidelity(facingOf(-Math.PI / 2), set)).toBeCloseTo(0.8, 12);
    expect(viewFidelity(facingOf(Math.PI / 2), set)).toBeCloseTo(0.76, 12);
  });

  it("offers 0 and ±45° for photographed-only seating", () => {
    const options = rotationOptionsFor(
      { rotation: [0, 0, 0], type: "sofa", assetId: "hinoki-low-sofa" },
      sofaSet(),
    );
    expect(
      options
        .map((o) => Math.round((o.rotationY * 180) / Math.PI))
        .sort((a, b) => a - b),
    ).toEqual([-45, 0, 45]);
    expect(options.find((o) => o.rotationY === 0)?.fidelity).toBe(1);
  });

  it("offers every 45° step with the full generated set", () => {
    const full = withViews(sofaSet(), ["side", "back-quarter", "back"]);
    const options = rotationOptionsFor(
      { rotation: [0, 0, 0], type: "sofa", assetId: "hinoki-low-sofa" },
      full,
    );
    expect(options).toHaveLength(8);
  });

  it("offers front-back symmetric steps for coffee tables and keeps a current off-grid rotation", () => {
    const table = PHOTO_ASSET_SETS["oak-frame-table"]!;
    const options = rotationOptionsFor(
      { rotation: [0, 0.3, 0], type: "coffee_table", assetId: "oak-frame-table" },
      table,
    );
    const degrees = options
      .map((o) => Math.round((o.rotationY * 180) / Math.PI))
      .sort((a, b) => a - b);
    expect(degrees).toEqual([-135, -45, 0, 17, 45, 135, 180]);
  });

  it("gives radial and unregistered objects only their current rotation at fidelity 1", () => {
    expect(
      rotationOptionsFor(
        { rotation: [0, 1, 0], type: "floor_lamp", assetId: "brass-globe-lamp" },
        PHOTO_ASSET_SETS["brass-globe-lamp"]!,
      ),
    ).toEqual([{ rotationY: 1, fidelity: 1 }]);
    expect(
      rotationOptionsFor({ rotation: [0, 1, 0], type: "sofa" }, null),
    ).toEqual([{ rotationY: 1, fidelity: 1 }]);
  });

  it("builds options for every demo object by id", () => {
    const options = buildRotationOptions(createDemoScene());
    expect(Object.keys(options).sort()).toEqual([
      "chair_01",
      "lamp_01",
      "plant_01",
      "rug_01",
      "sofa_01",
      "table_01",
    ]);
    expect(options.rug_01).toEqual([{ rotationY: 0, fidelity: 1 }]);
    expect(options.chair_01).toHaveLength(3);
  });
});
