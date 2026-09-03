import { describe, expect, it } from "vitest";

import { createDemoScene } from "../../src/demo/demo-scene";
import { hasCirculationPath } from "../../src/features/placement/circulation";
import {
  footprintExtent,
  footprintInsideRoom,
  footprintProjection,
  footprintsOverlap,
  objectFootprint,
  openingClearanceZones,
} from "../../src/features/placement/footprint-geometry";
import {
  bookshelfCandidates,
  chairCandidates,
  flattenPerimeterLanes,
  proposeNaturalPlacement,
  resolvePlacementSearch,
  sofaCandidates,
  type EvaluatedLayout,
} from "../../src/features/placement/natural-placement";
import { validateAndApplyPlacement } from "../../src/features/scene/natural-placement-command";
import {
  PHOTO_VIEW_SYMMETRY,
  buildRotationOptions,
  rotationOptionsFor,
  type PhotoAssetSet,
} from "../../src/features/photo/photo-views";
import { FRONT_VECTORS } from "../../src/features/photo/photo-facing";
import { CATEGORY_DIMENSIONS } from "../../src/features/room/room-engine";
import { SceneSchema } from "../../src/features/scene/scene-schema";
import {
  PLACEMENT_LIMITS,
  PLACEMENT_SCORE_WEIGHTS,
} from "../../src/features/placement/placement-profile";
import {
  PLACEMENT_PROFILE_VERSION,
  type NaturalPlacementResult,
  type PlacementOptions,
  type ProposedPlacement,
  type RotationOption,
} from "../../src/features/placement/placement-types";
import { applySceneCommand } from "../../src/features/scene/scene-commands";
import type {
  Scene,
  SceneCommand,
  SceneObject,
} from "../../src/features/scene/scene-schema";
import { DEMO_PRODUCTS } from "../../src/features/demo/demo-data";
import {
  FIXTURE_ROOM_WIDTH_M,
  completedProductScene,
} from "../helpers/natural-placement-fixtures";

function applyPlacements(
  scene: Scene,
  placements: readonly ProposedPlacement[],
): Scene {
  const next = structuredClone(scene);
  const byId = new Map(placements.map((placement) => [placement.objectId, placement]));

  for (const object of next.objects) {
    const placement = byId.get(object.id);
    if (!placement) continue;
    object.position = [...placement.position];
    object.rotation = [object.rotation[0], placement.rotationY, object.rotation[2]];
  }

  return next;
}

function pointInsideObjectFootprint(
  point: { x: number; z: number },
  object: SceneObject,
): boolean {
  const footprint = objectFootprint(object);
  const deltaX = point.x - footprint.center.x;
  const deltaZ = point.z - footprint.center.z;
  const cosine = Math.cos(footprint.rotationY);
  const sine = Math.sin(footprint.rotationY);
  const localX = deltaX * cosine + deltaZ * sine;
  const localZ = -deltaX * sine + deltaZ * cosine;
  return (
    Math.abs(localX) <= footprint.halfWidth &&
    Math.abs(localZ) <= footprint.halfDepth
  );
}

function keepObjects(scene: Scene, ...ids: string[]): Scene {
  const next = structuredClone(scene);
  next.objects = next.objects.filter(({ id }) => ids.includes(id));
  next.selectedObjectId = null;
  return next;
}

function thresholdScene(rugX: number): Scene {
  const scene = completedProductScene();
  const placements: readonly ProposedPlacement[] = [
    { objectId: "sofa_01", position: [-1.3, 0.36, -1.8], rotationY: 0 },
    { objectId: "rug_01", position: [rugX, 0.01, -0.6], rotationY: 0 },
    { objectId: "table_01", position: [-1.3, 0.2, -0.6], rotationY: 0 },
    {
      objectId: "chair_01",
      position: [-1.3, 0.38, 0.5],
      rotationY: Math.PI,
    },
    { objectId: "lamp_01", position: [1.8, 0.79, -2.1], rotationY: 0 },
    { objectId: "plant_01", position: [-2.4, 0.85, 0.3], rotationY: 0 },
  ];
  return applyPlacements(scene, placements);
}

// The six-product redesign, then six `move_object` calls to a deliberately poor layout
// (the browser journey the compositor E2E once performed; the spec now only makes the
// tie-break moves, but the solver pins below were measured on this layout). Both Scenes
// are built through the same command layer the store commits, so the room the solver
// sees matches the committed browser Scene, `clampPositionToRoom` included.
const REDESIGN_PRODUCT_IDS: Readonly<Record<string, string>> = {
  sofa_01: "boucle-curve-sofa",
  table_01: "travertine-plinth-table",
  rug_01: "wool-pebble-rug",
  lamp_01: "linen-dome-lamp",
  chair_01: "boucle-barrel-chair",
  plant_01: "stone-planter-ficus",
};

const POOR_JOURNEY_TARGETS: Readonly<Record<string, { x: number; z: number }>> = {
  sofa_01: { x: -1.8, z: 0.2 },
  table_01: { x: 1.2, z: 0.8 },
  rug_01: { x: 0.9, z: 0.9 },
  lamp_01: { x: 0.2, z: 1.8 },
  chair_01: { x: 2.2, z: -0.7 },
  plant_01: { x: -2.3, z: -1.5 },
};

function catalogProduct(productId: string) {
  const product = DEMO_PRODUCTS.find(({ id }) => id === productId);
  if (!product) throw new Error(`Missing catalog product ${productId}`);
  return {
    id: product.id,
    variantId: product.variantId,
    title: product.title,
    category: product.category,
    price: structuredClone(product.price),
    dimensionsCm: structuredClone(product.dimensionsCm),
    styleTags: [...product.styleTags],
    color: product.color,
    material: product.material,
  };
}

function commit(scene: Scene, command: SceneCommand): Scene {
  const result = applySceneCommand(scene, {
    expectedRevision: scene.revision,
    actor: "agent",
    command,
  });
  if (!result.ok) throw new Error(`${command.type} command rejected`);
  return result.scene;
}

/**
 * The seed placeholder room at the fixture width. Every absolute coordinate and pinned
 * solver output in this file was measured in the 6 m room; the calibrated 3.4 m seed
 * is too tight for the solver to arrange its six pieces at all.
 */
function seedRoomScene(): Scene {
  return createDemoScene({ widthM: FIXTURE_ROOM_WIDTH_M });
}

/** The Scene the sixth `replace_object` commits, before any arrangement runs. */
function redesignedProductScene(): Scene {
  let scene = seedRoomScene();
  for (const [objectId, productId] of Object.entries(REDESIGN_PRODUCT_IDS)) {
    scene = commit(scene, {
      type: "replace",
      objectId,
      product: catalogProduct(productId),
    });
  }
  return scene;
}

/** The redesigned room dragged to the plan's verbatim poor targets. */
function poorRedesignedJourneyScene(): Scene {
  let scene = redesignedProductScene();
  for (const [objectId, position] of Object.entries(POOR_JOURNEY_TARGETS)) {
    scene = commit(scene, { type: "move", objectId, position });
  }
  return scene;
}

/** The three real-data journeys Task 2b measured, in the order it reports them. */
const REAL_DATA_JOURNEYS: readonly (readonly [string, () => Scene])[] = [
  ["the seed placeholder room", seedRoomScene],
  ["the six-product redesign before arrangement", redesignedProductScene],
  ["the redesign dragged to the poor journey layout", poorRedesignedJourneyScene],
];

/** The sofa's local forward axis, spelled out here so the test does not borrow the
 * solver's own helper to check the solver's answer. */
function forwardAxis(rotationY: number): { x: number; z: number } {
  return { x: -Math.sin(rotationY), z: Math.cos(rotationY) };
}

function forwardProjection(
  sofa: SceneObject,
  object: SceneObject,
): number {
  const forward = forwardAxis(sofa.rotation[1]);
  return (
    (object.position[0] - sofa.position[0]) * forward.x +
    (object.position[2] - sofa.position[2]) * forward.z
  );
}

/** The grid-aligned centre bound an object of the given half extent can reach on an axis
 * of the given span, matching the inset the solver samples. */
function insetBound(span: number, half: number): { minimum: number; maximum: number } {
  const grid = PLACEMENT_LIMITS.gridM;
  const round = (value: number) => Number(value.toFixed(6));
  return {
    minimum: round(
      Math.ceil((-span / 2 + PLACEMENT_LIMITS.roomInsetM + half - 1e-9) / grid) * grid,
    ),
    maximum: round(
      Math.floor((span / 2 - PLACEMENT_LIMITS.roomInsetM - half + 1e-9) / grid) * grid,
    ),
  };
}

/** A bare 6.0 x 6.0 room holding one sofa at the given placement. */
function singleSofaScene(rotationY: number, x: number, z: number): Scene {
  const scene = keepObjects(completedProductScene(), "sofa_01");
  scene.id = "sofa-wall-candidates";
  scene.source = "upload";
  scene.room = { width: 6, height: 2.5, depth: 6 };
  scene.openings = [];
  const sofa = scene.objects[0]!;
  sofa.position = [x, sofa.position[1], z];
  sofa.rotation = [0, rotationY, 0];
  return scene;
}

function objectAt(object: SceneObject, point: { x: number; z: number }): SceneObject {
  return { ...object, position: [point.x, object.position[1], point.z] };
}

/** The inset perimeter positions the solver samples for an accessory. */
function insetPerimeterRing(
  scene: Scene,
  object: SceneObject,
): readonly { x: number; z: number }[] {
  const grid = PLACEMENT_LIMITS.gridM;
  const round = (value: number) => Number(value.toFixed(6));
  const bound = (half: number, span: number) => ({
    minimum: round(
      Math.ceil((-span / 2 + PLACEMENT_LIMITS.roomInsetM + half - 1e-9) / grid) * grid,
    ),
    maximum: round(
      Math.floor((span / 2 - PLACEMENT_LIMITS.roomInsetM - half + 1e-9) / grid) * grid,
    ),
  });
  const x = bound(object.dimensionsM.width / 2, scene.room.width);
  const z = bound(object.dimensionsM.depth / 2, scene.room.depth);
  const ring: { x: number; z: number }[] = [];
  for (let value = x.minimum; value <= x.maximum + 1e-9; value += grid) {
    ring.push({ x: round(value), z: z.minimum });
    ring.push({ x: round(value), z: z.maximum });
  }
  for (let value = z.minimum + grid; value < z.maximum - 1e-9; value += grid) {
    ring.push({ x: x.minimum, z: round(value) });
    ring.push({ x: x.maximum, z: round(value) });
  }
  return ring;
}

/**
 * A 6.0 x 1.2 room whose locked sofa covers the left two thirds of the inset perimeter.
 * Every ring position within reach of the lamp's corner is blocked while the right half
 * of the ring is free, so a candidate list sorted by distance from the lamp and cut at
 * 48 entries never reaches a usable position.
 */
function blockedAccessoryArcScene(): Scene {
  const scene = keepObjects(completedProductScene(), "sofa_01", "lamp_01");
  scene.id = "blocked-accessory-arc";
  scene.source = "upload";
  scene.room = { width: 6, height: 2.5, depth: 1.2 };
  scene.openings = [];
  const sofa = scene.objects.find(({ id }) => id === "sofa_01")!;
  const lamp = scene.objects.find(({ id }) => id === "lamp_01")!;
  sofa.position = [-1.6, sofa.position[1], 0];
  sofa.locked = true;
  lamp.position = [-2.7, lamp.position[1], -0.3];
  return scene;
}

describe("natural placement", () => {
  it("returns byte-equivalent proposals without mutating its Scene", () => {
    const scene = completedProductScene();
    const before = structuredClone(scene);
    const first = proposeNaturalPlacement(scene);
    const second = proposeNaturalPlacement(scene);
    expect(first).toEqual(second);
    expect(scene).toEqual(before);
    expect(first.kind).toBe("changed");
  });

  it("keeps locked objects exact and includes every movable known object", () => {
    const scene = completedProductScene();
    const locked = scene.objects.find(({ id }) => id === "sofa_01")!;
    locked.locked = true;
    const before = structuredClone(locked);
    const result = proposeNaturalPlacement(scene);
    expect(result.kind).toBe("changed");
    if (result.kind !== "changed") return;
    expect(result.placements.some(({ objectId }) => objectId === locked.id)).toBe(false);
    expect(result.placements).toHaveLength(scene.objects.length - 1);
    expect(scene.objects.find(({ id }) => id === locked.id)).toEqual(before);
  });

  it("preserves the exact Y rotation of every non-rug cutout", () => {
    const scene = completedProductScene();
    const result = proposeNaturalPlacement(scene);
    expect(result.kind).toBe("changed");
    if (result.kind !== "changed") return;

    for (const placement of result.placements) {
      const object = scene.objects.find(({ id }) => id === placement.objectId)!;
      if (object.type === "rug") continue;
      expect(placement.rotationY).toBe(object.rotation[1]);
    }
  });

  it("fails closed for an unlocked unknown object", () => {
    const scene = completedProductScene();
    scene.objects[0]!.type = "unknown";
    expect(proposeNaturalPlacement(scene)).toEqual({ kind: "failed", reason: "invalid-input" });
  });

  it("produces a safe relational layout that is unchanged on a second pass", () => {
    const scene = completedProductScene();
    const initialSofa = scene.objects.find(({ id }) => id === "sofa_01")!;
    const result = proposeNaturalPlacement(scene);
    expect(result.kind).toBe("changed");
    if (result.kind !== "changed") return;

    const arranged = applyPlacements(scene, result.placements);
    const sofa = arranged.objects.find(({ id }) => id === "sofa_01")!;
    const table = arranged.objects.find(({ id }) => id === "table_01")!;
    const rug = arranged.objects.find(({ id }) => id === "rug_01")!;

    expect(Math.sign(sofa.position[0])).toBe(Math.sign(initialSofa.position[0]));
    const sofaTableEdgeGap =
      Math.abs(table.position[2] - sofa.position[2]) -
      sofa.dimensionsM.depth / 2 -
      table.dimensionsM.depth / 2;
    expect(sofaTableEdgeGap).toBeGreaterThanOrEqual(0.35);
    expect(sofaTableEdgeGap).toBeLessThanOrEqual(0.55);
    expect(
      pointInsideObjectFootprint({ x: table.position[0], z: table.position[2] }, rug),
    ).toBe(true);

    const nonRugs = arranged.objects.filter(({ type }) => type !== "rug");
    for (let first = 0; first < nonRugs.length; first += 1) {
      for (let second = first + 1; second < nonRugs.length; second += 1) {
        expect(
          footprintsOverlap(
            objectFootprint(nonRugs[first]!),
            objectFootprint(nonRugs[second]!),
          ),
        ).toBe(false);
      }
    }

    expect(
      hasCirculationPath(
        arranged,
        arranged.objects.map(objectFootprint),
        [rug],
      ),
    ).toBe(true);
    expect(proposeNaturalPlacement(arranged).kind).toBe("unchanged");
  });

  it("reaches a fixed point for a non-demo room arrangement", () => {
    const scene = completedProductScene();
    scene.id = "uploaded-wide-room";
    scene.source = "upload";
    scene.room = { width: 6, height: 2.5, depth: 6 };
    scene.openings = [];
    const sofa = scene.objects.find(({ id }) => id === "sofa_01")!;
    sofa.position[0] = -1.6;
    sofa.position[2] = -1.2;
    const rug = scene.objects.find(({ id }) => id === "rug_01")!;
    rug.position[0] = 0.7;
    rug.position[2] = -0.4;

    const first = proposeNaturalPlacement(scene);
    expect(first.kind).toBe("changed");
    if (first.kind !== "changed") return;
    const once = applyPlacements(scene, first.placements);

    expect(proposeNaturalPlacement(once).kind).toBe("unchanged");
  });

  it("uses a rotated sofa's local forward axis for the table and chair", () => {
    const scene = keepObjects(
      completedProductScene(),
      "sofa_01",
      "table_01",
      "chair_01",
    );
    scene.id = "rotated-seating";
    scene.source = "upload";
    scene.room = { width: 6, height: 2.5, depth: 6 };
    scene.openings = [];
    const sofa = scene.objects.find(({ id }) => id === "sofa_01")!;
    const table = scene.objects.find(({ id }) => id === "table_01")!;
    const chair = scene.objects.find(({ id }) => id === "chair_01")!;
    sofa.position = [0, sofa.position[1], -0.5];
    sofa.rotation[1] = Math.PI / 2;
    sofa.locked = true;
    table.position = [0, table.position[1], -0.5];
    chair.position = [0, chair.position[1], 1.5];

    const result = proposeNaturalPlacement(scene);
    expect(result.kind).toBe("changed");
    if (result.kind !== "changed") return;
    const arranged = applyPlacements(scene, result.placements);
    const arrangedTable = arranged.objects.find(({ id }) => id === "table_01")!;
    const arrangedChair = arranged.objects.find(({ id }) => id === "chair_01")!;
    const localForwardGap =
      Math.abs(arrangedTable.position[0] - sofa.position[0]) -
      sofa.dimensionsM.depth / 2 -
      arrangedTable.dimensionsM.width / 2;

    expect(arrangedTable.rotation[1]).toBe(table.rotation[1]);
    expect(localForwardGap).toBeGreaterThanOrEqual(0.35);
    expect(localForwardGap).toBeLessThanOrEqual(0.55);
    expect(Math.sign(arrangedTable.position[0] - sofa.position[0])).toBe(
      Math.sign(arrangedChair.position[0] - arrangedTable.position[0]),
    );
    expect(Math.abs(arrangedTable.position[2] - sofa.position[2])).toBeLessThanOrEqual(0.3);
    expect(Math.abs(arrangedChair.position[2] - arrangedTable.position[2])).toBeLessThanOrEqual(0.3);
  });

  it("rejects a locked accessory whose center is inside a locked rug seating zone", () => {
    const scene = keepObjects(completedProductScene(), "rug_01", "lamp_01");
    scene.id = "locked-seating-zone";
    scene.source = "upload";
    scene.room = { width: 6, height: 2.5, depth: 6 };
    scene.openings = [];
    const rug = scene.objects.find(({ id }) => id === "rug_01")!;
    const lamp = scene.objects.find(({ id }) => id === "lamp_01")!;
    rug.position = [0, rug.position[1], 0];
    rug.locked = true;
    lamp.position = [0.8, lamp.position[1], 0];
    lamp.locked = true;

    expect(proposeNaturalPlacement(scene)).toEqual({
      kind: "failed",
      reason: "no-valid-layout",
    });
  });

  it("moves an unlocked accessory outside a locked rug seating zone", () => {
    const scene = keepObjects(completedProductScene(), "rug_01", "lamp_01");
    scene.id = "movable-accessory-seating-zone";
    scene.source = "upload";
    scene.room = { width: 6, height: 2.5, depth: 6 };
    scene.openings = [];
    const rug = scene.objects.find(({ id }) => id === "rug_01")!;
    const lamp = scene.objects.find(({ id }) => id === "lamp_01")!;
    rug.position = [0, rug.position[1], 0];
    rug.locked = true;
    lamp.position = [0.8, lamp.position[1], 0];

    const result = proposeNaturalPlacement(scene);
    expect(result.kind).toBe("changed");
    if (result.kind !== "changed") return;
    const arranged = applyPlacements(scene, result.placements);
    const arrangedLamp = arranged.objects.find(({ id }) => id === "lamp_01")!;
    expect(
      pointInsideObjectFootprint(
        { x: arrangedLamp.position[0], z: arrangedLamp.position[2] },
        rug,
      ),
    ).toBe(false);
  });

  it("reaches a free wall when opening clearance blocks the nearest arc", () => {
    const scene = keepObjects(completedProductScene(), "lamp_01");
    scene.id = "bounded-perimeter-search";
    scene.source = "upload";
    scene.room = { width: 6, height: 2.5, depth: 6 };
    scene.openings = [
      {
        id: "back-window",
        kind: "window",
        wall: "back",
        offset: 0.5,
        widthM: 5,
        heightM: 1.2,
      },
      {
        id: "left-window",
        kind: "window",
        wall: "left",
        offset: 0.5,
        widthM: 5,
        heightM: 1.2,
      },
    ];
    const lamp = scene.objects[0]!;
    lamp.position = [-2.82, lamp.position[1], -2.82];

    const witness = structuredClone(scene);
    witness.objects[0]!.position = [2.7, lamp.position[1], 2.7];
    const witnessFootprint = objectFootprint(witness.objects[0]!);
    expect(footprintInsideRoom(witnessFootprint, witness.room, 0.1)).toBe(true);
    expect(
      openingClearanceZones(witness).some((zone) =>
        footprintsOverlap(witnessFootprint, zone),
      ),
    ).toBe(false);
    expect(hasCirculationPath(witness, [witnessFootprint], [])).toBe(true);

    const result = proposeNaturalPlacement(scene);
    expect(result.kind).toBe("changed");
    if (result.kind !== "changed") return;
    const arranged = applyPlacements(scene, result.placements);
    const arrangedFootprint = objectFootprint(arranged.objects[0]!);
    expect(footprintInsideRoom(arrangedFootprint, arranged.room, 0.1)).toBe(true);
    expect(
      openingClearanceZones(arranged).some((zone) =>
        footprintsOverlap(arrangedFootprint, zone),
      ),
    ).toBe(false);
  });

  // Spec 6.3 is a closed list and holds neither the sofa-to-table gap nor the rug's
  // containment of the table; 6.4 terms 3 and 4 score exactly those relations. A room
  // that only scores badly on them is valid, so it must carry a `currentScore` and be
  // held to the 6.5 improvement threshold like any other layout.
  it.each([
    [
      "a 0.6m sofa-to-table gap",
      () => {
        const scene = keepObjects(
          completedProductScene(),
          "sofa_01",
          "table_01",
          "rug_01",
        );
        scene.id = "wide-sofa-table-gap";
        scene.source = "upload";
        scene.room = { width: 6, height: 2.5, depth: 6 };
        scene.openings = [];
        const sofa = scene.objects.find(({ id }) => id === "sofa_01")!;
        const table = scene.objects.find(({ id }) => id === "table_01")!;
        const rug = scene.objects.find(({ id }) => id === "rug_01")!;
        sofa.position = [0, sofa.position[1], -1.8];
        table.position = [
          0,
          table.position[1],
          sofa.position[2] +
            sofa.dimensionsM.depth / 2 +
            table.dimensionsM.depth / 2 +
            0.6,
        ];
        rug.position = [0, rug.position[1], table.position[2]];
        return scene;
      },
    ],
    [
      "a table parked off the rug",
      () => {
        const scene = keepObjects(
          completedProductScene(),
          "sofa_01",
          "table_01",
          "rug_01",
        );
        scene.id = "table-off-rug";
        scene.source = "upload";
        scene.room = { width: 6, height: 2.5, depth: 6 };
        scene.openings = [];
        const sofa = scene.objects.find(({ id }) => id === "sofa_01")!;
        const table = scene.objects.find(({ id }) => id === "table_01")!;
        const rug = scene.objects.find(({ id }) => id === "rug_01")!;
        sofa.position = [0, sofa.position[1], -1.8];
        table.position = [
          0,
          table.position[1],
          sofa.position[2] +
            sofa.dimensionsM.depth / 2 +
            table.dimensionsM.depth / 2 +
            0.45,
        ];
        rug.position = [1.5, rug.position[1], 1.5];
        return scene;
      },
    ],
  ])("scores %s as a valid current layout", (_case, buildScene) => {
    const scene = buildScene();

    // The room satisfies every hard constraint the spec closes its 6.3 list with.
    const nonRugs = scene.objects.filter(({ type }) => type !== "rug");
    for (const object of scene.objects) {
      expect(
        footprintInsideRoom(
          objectFootprint(object),
          scene.room,
          PLACEMENT_LIMITS.roomInsetM,
        ),
      ).toBe(true);
      expect(
        openingClearanceZones(scene).some((zone) =>
          footprintsOverlap(objectFootprint(object), zone),
        ),
      ).toBe(false);
    }
    for (let first = 0; first < nonRugs.length; first += 1) {
      for (let second = first + 1; second < nonRugs.length; second += 1) {
        expect(
          footprintsOverlap(
            objectFootprint(nonRugs[first]!),
            objectFootprint(nonRugs[second]!),
          ),
        ).toBe(false);
      }
    }
    expect(
      hasCirculationPath(
        scene,
        scene.objects.map(objectFootprint),
        scene.objects.filter(({ type }) => type === "rug"),
      ),
    ).toBe(true);

    const result = proposeNaturalPlacement(scene);
    expect(result.kind).not.toBe("failed");
    if (result.kind === "failed") return;
    expect(result.diagnostics.currentScore).not.toBeNull();
  });

  // A locked object can make the 6.4 seating relations unattainable. The spec keeps such
  // a room valid and expects a lower-scored layout, not a failure: no hard constraint of
  // 6.3 is broken by a locked table sitting in the middle of the floor.
  it("arranges around a locked table the sofa gap cannot reach", () => {
    const scene = keepObjects(completedProductScene(), "sofa_01", "table_01");
    scene.id = "unreachable-table-gap";
    scene.source = "upload";
    scene.room = { width: 9, height: 2.5, depth: 6 };
    scene.openings = [];
    const table = scene.objects.find(({ id }) => id === "table_01")!;
    table.position = [0, table.position[1], 0];
    table.locked = true;
    const lockedBefore = structuredClone(table);

    // Every sofa candidate hugs a wall, so no layout holds the 350-550mm sofa-to-table
    // gap the 6.4 table term rewards - which costs score, not validity.
    const result = proposeNaturalPlacement(scene);
    expect(result.kind).toBe("changed");
    if (result.kind !== "changed") return;
    expect(result.placements.some(({ objectId }) => objectId === "table_01")).toBe(
      false,
    );

    const applied = validateAndApplyPlacement(scene, result);
    expect(applied.ok).toBe(true);
    if (!applied.ok || !applied.changed) return;
    const arranged = applied.scene;
    expect(arranged.objects.find(({ id }) => id === "table_01")).toEqual(lockedBefore);
    const arrangedSofa = arranged.objects.find(({ id }) => id === "sofa_01")!;
    expect(
      footprintsOverlap(objectFootprint(arrangedSofa), objectFootprint(lockedBefore)),
    ).toBe(false);
    expect(
      footprintInsideRoom(
        objectFootprint(arrangedSofa),
        arranged.room,
        PLACEMENT_LIMITS.roomInsetM,
      ),
    ).toBe(true);
    expect(
      hasCirculationPath(arranged, arranged.objects.map(objectFootprint), []),
    ).toBe(true);
  });

  // The end-to-end exhaustion path the locked-table fixture used to cover, now driven by
  // a hard constraint of 6.3: a locked sofa seals the only opening's access zone, so no
  // candidate layout circulates, and the lamp's inset ring overruns the candidate budget.
  it("reports a truncated search with no reachable opening as exhausted", () => {
    const scene = keepObjects(completedProductScene(), "sofa_01", "lamp_01");
    scene.id = "sealed-opening";
    scene.source = "upload";
    scene.room = { width: 6, height: 2.5, depth: 6 };
    scene.openings = [
      {
        id: "back-door",
        kind: "door",
        wall: "back",
        offset: 0.5,
        widthM: 0.9,
        heightM: 2.05,
      },
    ];
    const sofa = scene.objects.find(({ id }) => id === "sofa_01")!;
    const lamp = scene.objects.find(({ id }) => id === "lamp_01")!;
    sofa.position = [0, sofa.position[1], -2.44];
    sofa.locked = true;
    lamp.position = [2.5, lamp.position[1], 2.5];

    // The locked sofa alone denies the 0.75m path, so no placement of the lamp helps...
    expect(
      hasCirculationPath(scene, [objectFootprint(sofa)], []),
    ).toBe(false);
    // ...while the lamp's own ring is longer than the per-object candidate budget.
    expect(insetPerimeterRing(scene, lamp).length).toBeGreaterThan(
      PLACEMENT_LIMITS.candidatesPerObject,
    );

    expect(proposeNaturalPlacement(scene)).toEqual({
      kind: "failed",
      reason: "search-limit-exhausted",
    });
    expect(scene.objects.find(({ id }) => id === "sofa_01")!.position[2]).toBe(-2.44);
  });

  it("moves objects out of opening clearance zones", () => {
    const scene = keepObjects(completedProductScene(), "lamp_01");
    scene.id = "opening-clearance";
    scene.source = "upload";
    scene.room = { width: 6, height: 2.5, depth: 6 };
    scene.openings = [
      {
        id: "back-window",
        kind: "window",
        wall: "back",
        offset: 0.5,
        widthM: 1,
        heightM: 1.2,
      },
    ];
    scene.objects[0]!.position = [0, scene.objects[0]!.position[1], -2.7];

    const result = proposeNaturalPlacement(scene);
    expect(result.kind).toBe("changed");
    if (result.kind !== "changed") return;
    const arranged = applyPlacements(scene, result.placements);
    const footprint = objectFootprint(arranged.objects[0]!);
    expect(
      openingClearanceZones(arranged).some((zone) =>
        footprintsOverlap(footprint, zone),
      ),
    ).toBe(false);
  });

  it("fails closed when validated objects have duplicate IDs", () => {
    const scene = completedProductScene();
    scene.selectedObjectId = null;
    scene.objects[1]!.id = scene.objects[0]!.id;

    expect(proposeNaturalPlacement(scene)).toEqual({
      kind: "failed",
      reason: "invalid-input",
    });
  });

  it("keeps 99-or-lower improvements unchanged and accepts exactly 100", () => {
    expect(PLACEMENT_LIMITS.improvementThreshold).toBe(100);
    const below = proposeNaturalPlacement(thresholdScene(-0.85));
    expect(below.kind).toBe("unchanged");
    if (below.kind !== "unchanged") return;
    expect(below.diagnostics.currentScore).not.toBeNull();
    expect(below.diagnostics.proposedScore).not.toBeNull();
    expect(
      below.diagnostics.proposedScore! - below.diagnostics.currentScore!,
    ).toBeLessThan(PLACEMENT_LIMITS.improvementThreshold);

    const exact = proposeNaturalPlacement(thresholdScene(-0.8));
    expect(exact.kind).toBe("changed");
    if (exact.kind !== "changed") return;
    expect(exact.diagnostics.currentScore).not.toBeNull();
    expect(exact.diagnostics.proposedScore).not.toBeNull();
    expect(
      exact.diagnostics.proposedScore! - exact.diagnostics.currentScore!,
    ).toBe(PLACEMENT_LIMITS.improvementThreshold);
  });

  it.each([
    ["the seed placeholder room", seedRoomScene],
    ["the six-product redesign before arrangement", redesignedProductScene],
    ["the redesign dragged to the poor journey layout", poorRedesignedJourneyScene],
  ])("arranges %s and settles on a second pass", (_journey, buildScene) => {
    const scene = buildScene();
    const current = scene.objects.map(({ id, position }) => [
      id,
      position[0],
      position[2],
    ]);

    const proposal = proposeNaturalPlacement(scene);

    expect(proposal.kind).toBe("changed");
    if (proposal.kind !== "changed") return;

    const applied = validateAndApplyPlacement(scene, proposal);
    expect(applied.ok).toBe(true);
    if (!applied.ok || !applied.changed) return;

    const arranged = applied.scene;
    expect(
      arranged.objects.map(({ id, position }) => [id, position[0], position[2]]),
    ).not.toEqual(current);
    expect(proposeNaturalPlacement(arranged).kind).toBe("unchanged");
  });

  it.each(REAL_DATA_JOURNEYS)(
    "seats the table and the chair in front of the sofa for %s",
    (_journey, buildScene) => {
      const scene = buildScene();
      const proposal = proposeNaturalPlacement(scene);

      expect(proposal.kind).toBe("changed");
      if (proposal.kind !== "changed") return;

      const applied = validateAndApplyPlacement(scene, proposal);
      expect(applied.ok).toBe(true);
      if (!applied.ok || !applied.changed) return;

      const arranged = applied.scene;
      const sofa = arranged.objects.find(({ id }) => id === "sofa_01")!;
      const table = arranged.objects.find(({ id }) => id === "table_01")!;
      const chair = arranged.objects.find(({ id }) => id === "chair_01")!;

      expect(forwardProjection(sofa, table)).toBeGreaterThan(0);
      expect(forwardProjection(sofa, chair)).toBeGreaterThan(0);
    },
  );

  it("arranges the poor journey layout with the seating group at higher z", () => {
    const scene = poorRedesignedJourneyScene();
    const proposal = proposeNaturalPlacement(scene);

    expect(proposal.kind).toBe("changed");
    if (proposal.kind !== "changed") return;

    const applied = validateAndApplyPlacement(scene, proposal);
    expect(applied.ok).toBe(true);
    if (!applied.ok || !applied.changed) return;

    const arranged = applied.scene;
    const sofa = arranged.objects.find(({ id }) => id === "sofa_01")!;
    const table = arranged.objects.find(({ id }) => id === "table_01")!;
    const chair = arranged.objects.find(({ id }) => id === "chair_01")!;

    // Every demo sofa keeps rotation 0, so its forward axis is +z: the camera-side half
    // of the room is where the table and the chair belong.
    expect(sofa.rotation[1]).toBe(0);
    expect(table.position[2]).toBeGreaterThan(sofa.position[2]);
    expect(chair.position[2]).toBeGreaterThan(sofa.position[2]);
  });

  it("samples the free perimeter when the accessory's nearest arc is blocked", () => {
    const scene = blockedAccessoryArcScene();
    const sofa = scene.objects.find(({ id }) => id === "sofa_01")!;
    const lamp = scene.objects.find(({ id }) => id === "lamp_01")!;
    const blocked = (point: { x: number; z: number }) =>
      footprintsOverlap(
        objectFootprint(objectAt(lamp, point)),
        objectFootprint(sofa),
      );
    const ring = insetPerimeterRing(scene, lamp);
    const nearestArc = [...ring]
      .sort(
        (first, second) =>
          Math.hypot(first.x - lamp.position[0], first.z - lamp.position[2]) -
          Math.hypot(second.x - lamp.position[0], second.z - lamp.position[2]),
      )
      .slice(0, PLACEMENT_LIMITS.candidatesPerObject);

    // The whole distance-ordered candidate budget lands on blocked positions...
    expect(nearestArc).toHaveLength(PLACEMENT_LIMITS.candidatesPerObject);
    expect(nearestArc.every(blocked)).toBe(true);
    // ...while most of the perimeter is free.
    expect(ring.filter((point) => !blocked(point)).length).toBeGreaterThan(
      PLACEMENT_LIMITS.candidatesPerObject,
    );

    const result = proposeNaturalPlacement(scene);
    expect(result.kind).toBe("changed");
    if (result.kind !== "changed") return;

    const applied = validateAndApplyPlacement(scene, result);
    expect(applied.ok).toBe(true);
    if (!applied.ok || !applied.changed) return;
    const arrangedLamp = applied.scene.objects.find(({ id }) => id === "lamp_01")!;
    expect(
      blocked({ x: arrangedLamp.position[0], z: arrangedLamp.position[2] }),
    ).toBe(false);
    expect(
      footprintInsideRoom(
        objectFootprint(arrangedLamp),
        applied.scene.room,
        PLACEMENT_LIMITS.roomInsetM,
      ),
    ).toBe(true);
  });

  // An invariant guard, not branch coverage: on these Scenes the search always keeps a
  // valid layout of its own, so the substitution in `resolvePlacementSearch` never runs.
  // That branch is covered directly in "placement search outcome" below.
  it("keeps a valid current layout out of the failed outcomes", () => {
    const settled = [
      seedRoomScene,
      redesignedProductScene,
      poorRedesignedJourneyScene,
    ].map((buildScene) => {
      const scene = buildScene();
      const proposal = proposeNaturalPlacement(scene);
      if (proposal.kind !== "changed") throw new Error("expected an arrangement");
      return applyPlacements(scene, proposal.placements);
    });

    for (const scene of [...settled, thresholdScene(-0.3)]) {
      expect(proposeNaturalPlacement(scene).kind).not.toBe("failed");
    }
  });
});

/**
 * The outcome-resolution step in isolation. `searchLayouts` cannot be driven to keep no
 * valid layout while the current one stays safe without a beam-width hook, so the
 * substitution branch is verified here on its own inputs; the end-to-end invariant test
 * above guards the property, not this branch.
 */
describe("placement search outcome", () => {
  const placements: readonly ProposedPlacement[] = [
    { objectId: "lamp_01", position: [1.8, 0.79, -2.1], rotationY: 0 },
  ];
  const evaluated = (
    score: number,
    valid: boolean,
    layoutPlacements: readonly ProposedPlacement[] = [],
  ): EvaluatedLayout => ({ valid, score, placements: layoutPlacements });

  it("substitutes the current layout when the search keeps none and the room is safe", () => {
    const incumbent = evaluated(9000, true, placements);

    // The substituted layout scores exactly the current one, so it resolves to
    // `already-safe`, and it counts as one more complete layout the search settled.
    expect(
      resolvePlacementSearch(incumbent, {
        best: null,
        evaluatedLayouts: 32,
        exhausted: true,
      }),
    ).toEqual({
      kind: "unchanged",
      reason: "already-safe",
      diagnostics: { currentScore: 9000, proposedScore: 9000, evaluatedLayouts: 33 },
    });

    expect(
      resolvePlacementSearch(incumbent, {
        best: null,
        evaluatedLayouts: 0,
        exhausted: false,
      }),
    ).toEqual({
      kind: "unchanged",
      reason: "already-safe",
      diagnostics: { currentScore: 9000, proposedScore: 9000, evaluatedLayouts: 1 },
    });
  });

  it("never substitutes a current layout that breaks a hard constraint", () => {
    const unsafe = evaluated(3693, false, placements);

    expect(
      resolvePlacementSearch(unsafe, { best: null, evaluatedLayouts: 32, exhausted: true }),
    ).toEqual({ kind: "failed", reason: "search-limit-exhausted" });

    expect(
      resolvePlacementSearch(unsafe, { best: null, evaluatedLayouts: 8, exhausted: false }),
    ).toEqual({ kind: "failed", reason: "no-valid-layout" });
  });

  it("leaves the improvement threshold untouched when the search keeps a layout", () => {
    const incumbent = evaluated(9000, true);
    const search = (score: number) => ({
      best: evaluated(score, true, placements),
      evaluatedLayouts: 32,
      exhausted: false,
    });

    expect(resolvePlacementSearch(incumbent, search(9000))).toEqual({
      kind: "unchanged",
      reason: "already-safe",
      diagnostics: { currentScore: 9000, proposedScore: 9000, evaluatedLayouts: 32 },
    });
    expect(
      resolvePlacementSearch(
        incumbent,
        search(9000 + PLACEMENT_LIMITS.improvementThreshold - 1),
      ),
    ).toEqual({
      kind: "unchanged",
      reason: "no-safe-improvement",
      diagnostics: { currentScore: 9000, proposedScore: 9099, evaluatedLayouts: 32 },
    });
    expect(
      resolvePlacementSearch(
        incumbent,
        search(9000 + PLACEMENT_LIMITS.improvementThreshold),
      ),
    ).toEqual({
      kind: "changed",
      placements,
      diagnostics: { currentScore: 9000, proposedScore: 9100, evaluatedLayouts: 32 },
    });
  });

  it("proposes a kept layout of any score when the current one is unsafe", () => {
    expect(
      resolvePlacementSearch(evaluated(9999, false), {
        best: evaluated(120, true, placements),
        evaluatedLayouts: 32,
        exhausted: false,
      }),
    ).toEqual({
      kind: "changed",
      placements,
      diagnostics: { currentScore: null, proposedScore: 120, evaluatedLayouts: 32 },
    });
  });
});

describe("perimeter lane flattening", () => {
  const ringPlacement = (x: number): ProposedPlacement => ({
    objectId: "lamp_01",
    position: [Number(x.toFixed(6)), 0.79, -0.9],
    rotationY: 0,
  });

  /**
   * The shape a wide room with three full-span windows produces: opening clearance blocks
   * both columns, both corners and the whole front row, leaving one wall with far more
   * free positions than the cap, and the accessory already standing on the first of them.
   */
  function singleWallLanes() {
    const wall = Array.from({ length: 101 }, (_, index) => ringPlacement(-5 + index * 0.1));
    const lanes: readonly (readonly ProposedPlacement[])[] = [
      [],
      wall,
      [],
      [],
      [],
      [],
      [],
      [],
    ];
    return { lanes, wall, lead: ringPlacement(-5), twin: wall[0]! };
  }

  it("fills the candidate budget when the incumbent's ring twin is inside the cap", () => {
    const { lanes, lead, twin } = singleWallLanes();

    const capped = flattenPerimeterLanes(
      lanes,
      lead,
      twin,
      PLACEMENT_LIMITS.candidatesPerObject,
    );

    expect(capped.candidates).toHaveLength(PLACEMENT_LIMITS.candidatesPerObject);
    expect(capped.truncated).toBe(true);
    expect(capped.candidates[0]).toBe(lead);
    expect(capped.candidates).not.toContain(twin);
    expect(new Set(capped.candidates).size).toBe(capped.candidates.length);
  });

  it("caps exactly the prefix the uncapped flattening produces", () => {
    const { lanes, lead, twin } = singleWallLanes();

    const uncapped = flattenPerimeterLanes(lanes, lead, twin, Number.POSITIVE_INFINITY);
    const capped = flattenPerimeterLanes(
      lanes,
      lead,
      twin,
      PLACEMENT_LIMITS.candidatesPerObject,
    );

    expect(uncapped.candidates).toHaveLength(101);
    expect(capped.candidates).toEqual(
      uncapped.candidates.slice(0, PLACEMENT_LIMITS.candidatesPerObject),
    );
  });

  it("keeps every wall represented when several survive", () => {
    const wall = (offset: number) =>
      Array.from({ length: 20 }, (_, index) => ringPlacement(offset + index * 0.1));
    const lanes = [wall(-5), wall(-2), wall(1), wall(4), [], [], [], []];

    const flattened = flattenPerimeterLanes(
      lanes,
      null,
      null,
      PLACEMENT_LIMITS.candidatesPerObject,
    );

    expect(flattened.candidates).toHaveLength(PLACEMENT_LIMITS.candidatesPerObject);
    for (const lane of lanes.slice(0, 4)) {
      expect(flattened.candidates.some((candidate) => lane.includes(candidate))).toBe(true);
    }
  });
});

describe("sofa wall candidates", () => {
  it("never backs a rotation-0 sofa onto the maximum-z wall", () => {
    const scene = singleSofaScene(0, -1.2, 0.4);
    const sofa = scene.objects[0]!;
    const depthBound = insetBound(scene.room.depth, sofa.dimensionsM.depth / 2);

    const candidates = sofaCandidates(scene, sofa);
    const walls = candidates.slice(1);

    expect(candidates[0]).toEqual({
      objectId: sofa.id,
      position: [...sofa.position],
      rotationY: 0,
    });
    expect(walls.length).toBeGreaterThan(0);
    expect(walls.every(({ rotationY }) => rotationY === 0)).toBe(true);
    expect(new Set(walls.map(({ position }) => position[2]))).toEqual(
      new Set([depthBound.minimum]),
    );
    expect(
      walls.some(({ position }) => position[2] === depthBound.maximum),
    ).toBe(false);
    expect(
      new Set(walls.map(({ position }) => position[0])).size,
    ).toBeGreaterThan(1);
  });

  it.each([
    ["a quarter turn", Math.PI / 2, 1.2, "maximum" as const],
    ["a quarter turn the other way", -Math.PI / 2, -1.2, "minimum" as const],
  ])(
    "backs a sofa given %s onto the matching side wall only",
    (_turn, rotationY, x, side) => {
      const scene = singleSofaScene(rotationY, x, 0.4);
      const sofa = scene.objects[0]!;
      const widthBound = insetBound(scene.room.width, sofa.dimensionsM.depth / 2);

      const walls = sofaCandidates(scene, sofa).slice(1);

      expect(walls.length).toBeGreaterThan(0);
      expect(walls.every((candidate) => candidate.rotationY === rotationY)).toBe(true);
      expect(new Set(walls.map(({ position }) => position[0]))).toEqual(
        new Set([widthBound[side]]),
      );
      expect(
        new Set(walls.map(({ position }) => position[2])).size,
      ).toBeGreaterThan(1);
    },
  );
});

/**
 * Spec 8: the solver may turn an object only through the rotations its registered photo
 * views can show truthfully, and composes the room the way the demo photo is staged.
 */
describe("rotation options", () => {
  /** The chair's photographed options: the native quarter view and its mirror. */
  const CHAIR_OPTIONS: readonly RotationOption[] = [
    { rotationY: -Math.PI / 4, fidelity: 1 },
    { rotationY: 0, fidelity: 1 },
    { rotationY: Math.PI / 4, fidelity: 0.95 },
  ];

  function arrangeWith(
    scene: Scene,
    options?: PlacementOptions,
  ): Record<string, SceneObject> {
    const proposal = proposeNaturalPlacement(scene, options);
    expect(proposal.kind).toBe("changed");
    if (proposal.kind !== "changed") throw new Error("expected an arrangement");
    const applied = validateAndApplyPlacement(
      scene,
      proposal,
      options?.rotationOptions,
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok || !applied.changed) throw new Error("expected a changed Scene");
    return Object.fromEntries(applied.scene.objects.map((object) => [object.id, object]));
  }

  function collidingObjectIds(layout: Record<string, SceneObject>): string[] {
    const obstacles = Object.values(layout).filter(({ type }) => type !== "rug");
    const colliding = new Set<string>();
    for (let first = 0; first < obstacles.length; first += 1) {
      for (let second = first + 1; second < obstacles.length; second += 1) {
        if (
          footprintsOverlap(
            objectFootprint(obstacles[first]!),
            objectFootprint(obstacles[second]!),
          )
        ) {
          colliding.add(obstacles[first]!.id);
          colliding.add(obstacles[second]!.id);
        }
      }
    }
    return [...colliding].sort();
  }

  /** dot(forward(yaw), target - object), spelled out rather than borrowed from the solver. */
  function facesToward(object: SceneObject, target: SceneObject): number {
    const yaw = object.rotation[1];
    return (
      -Math.sin(yaw) * (target.position[0] - object.position[0]) +
      Math.cos(yaw) * (target.position[2] - object.position[2])
    );
  }

  /** How far `other` sits along the sofa's own lateral axis, signed then unsigned. */
  function lateralProjection(sofa: SceneObject, other: SceneObject): number {
    const yaw = sofa.rotation[1];
    return (
      Math.cos(yaw) * (other.position[0] - sofa.position[0]) +
      Math.sin(yaw) * (other.position[2] - sofa.position[2])
    );
  }

  function lateralOffset(sofa: SceneObject, other: SceneObject): number {
    return Math.abs(lateralProjection(sofa, other));
  }

  /** The edge gap between two footprints along an axis; negative when they overlap. */
  function edgeGap(
    first: SceneObject,
    second: SceneObject,
    axis: { x: number; z: number },
  ): number {
    const span = (object: SceneObject) =>
      footprintProjection(objectFootprint(object), axis.x, axis.z);
    const a = span(first);
    const b = span(second);
    if (b.minimum >= a.maximum) return b.minimum - a.maximum;
    if (a.minimum >= b.maximum) return a.minimum - b.maximum;
    return Math.max(a.minimum, b.minimum) - Math.min(a.maximum, b.maximum);
  }

  function lateralGap(sofa: SceneObject, other: SceneObject): number {
    const yaw = sofa.rotation[1];
    return edgeGap(sofa, other, { x: Math.cos(yaw), z: Math.sin(yaw) });
  }

  function forwardGap(sofa: SceneObject, other: SceneObject): number {
    const yaw = sofa.rotation[1];
    return edgeGap(sofa, other, { x: -Math.sin(yaw), z: Math.cos(yaw) });
  }

  function openingBlockedObjectIds(
    scene: Scene,
    layout: Record<string, SceneObject>,
  ): string[] {
    const zones = openingClearanceZones(scene);
    return Object.values(layout)
      .filter((object) =>
        zones.some((zone) => footprintsOverlap(objectFootprint(object), zone)),
      )
      .map(({ id }) => id)
      .sort();
  }

  it("keeps the weight table summing to 10,000 at profile version 2", () => {
    expect(
      Object.values(PLACEMENT_SCORE_WEIGHTS).reduce((sum, weight) => sum + weight, 0),
    ).toBe(10_000);
    expect(PLACEMENT_PROFILE_VERSION).toBe(2);
  });

  it("preserves every rotation when no options are given", () => {
    const scene = poorRedesignedJourneyScene();
    const result = proposeNaturalPlacement(scene);
    expect(result.kind).toBe("changed");
    if (result.kind !== "changed") return;
    for (const placement of result.placements) {
      const object = scene.objects.find(({ id }) => id === placement.objectId)!;
      if (object.type === "rug") continue;
      expect(placement.rotationY).toBe(object.rotation[1]);
    }
  });

  it("never proposes a rotation outside an object's options", () => {
    const scene = poorRedesignedJourneyScene();
    const options: PlacementOptions = { rotationOptions: { chair_01: CHAIR_OPTIONS } };
    const result = proposeNaturalPlacement(scene, options);
    expect(result.kind).toBe("changed");
    if (result.kind !== "changed") return;
    const chair = result.placements.find(({ objectId }) => objectId === "chair_01")!;
    expect(
      CHAIR_OPTIONS.some(
        ({ rotationY }) => Math.abs(rotationY - chair.rotationY) < 1e-9,
      ),
    ).toBe(true);
    // Every other object has no entry, so it keeps the rotation it came with.
    for (const placement of result.placements) {
      if (placement.objectId === "chair_01") continue;
      const object = scene.objects.find(({ id }) => id === placement.objectId)!;
      if (object.type === "rug") continue;
      expect(placement.rotationY).toBe(object.rotation[1]);
    }
  });

  /**
   * Spec 8.5 expects the sofa square on the back wall. It cannot be: the demo room's
   * back window makes an opening clearance zone of x in [-0.18, 1.62], z in [-2.4,
   * -1.65], so a sofa flush on that wall has to keep x <= -1.2 to stay out of it, and
   * from there the right-end flank lands inside the zone while the left-end flank falls
   * outside the room. No layout with the sofa on the back wall, a chair flanking one end
   * and the lamp at the other exists, and pinning the sofa to rotation 0 costs 219 points
   * on the spec's own weights. The solver quarter-turns the sofa into the back-left
   * corner instead, which is a rotation its native photographed view shows at fidelity 1,
   * and stages everything else exactly as 8.5 describes.
   */
  it("flanks the sofa with the chair turned 45 degrees toward the table", () => {
    const scene = poorRedesignedJourneyScene();
    const layout = arrangeWith(scene, {
      rotationOptions: buildRotationOptions(scene),
    });
    const { sofa_01: sofa, chair_01: chair, table_01: table } = layout;
    const { rug_01: rug, lamp_01: lamp, plant_01: plant } = layout;

    // Spec 8.5 as amended: the sofa backs onto the back wall or a back corner, and the
    // only turns it may take are the ones a registered view can show it in. Its centre is
    // measured rather than its footprint's far edge - a sofa quarter-turned into the
    // corner reaches z ~ 0 with its front corner while its back is flush on the wall.
    expect(sofa!.position[2]).toBeLessThanOrEqual(-0.9);
    expect(footprintExtent(objectFootprint(sofa!)).minimumZ).toBeLessThan(-2.2);
    expect(
      [0, Math.PI / 4].some(
        (turn) => Math.abs(Math.abs(sofa!.rotation[1]) - turn) < 1e-9,
      ),
    ).toBe(true);

    // The table and the rug sit on the sofa's forward axis.
    expect(forwardProjection(sofa!, table!)).toBeGreaterThan(0);
    expect(forwardProjection(sofa!, rug!)).toBeGreaterThan(0);

    // The chair flanks a sofa end, quarter-turned toward the table.
    expect(Math.abs(chair!.rotation[1])).toBeCloseTo(Math.PI / 4, 9);
    expect(facesToward(chair!, table!)).toBeGreaterThan(0);
    expect(lateralOffset(sofa!, chair!)).toBeGreaterThan(1.2);
    expect(chair!.position[2]).toBeLessThan(table!.position[2] + 0.3);

    // The lamp stands beside the sofa's other end: inside its depth band, just past it.
    expect(Math.sign(lateralProjection(sofa!, lamp!))).toBe(
      -Math.sign(lateralProjection(sofa!, chair!)),
    );
    expect(lateralOffset(sofa!, lamp!)).toBeGreaterThan(1.0);
    expect(forwardGap(sofa!, lamp!)).toBeLessThanOrEqual(0);
    expect(lateralGap(sofa!, lamp!)).toBeLessThan(0.5);

    // The plant fills a back corner, clear of the window clearance.
    const plantExtent = footprintExtent(objectFootprint(plant!));
    expect(
      Math.min(
        Math.abs(plantExtent.minimumX + scene.room.width / 2),
        Math.abs(scene.room.width / 2 - plantExtent.maximumX),
      ),
    ).toBeLessThanOrEqual(0.3);
    expect(Math.abs(plantExtent.minimumZ + scene.room.depth / 2)).toBeLessThanOrEqual(
      0.3,
    );

    expect(collidingObjectIds(layout)).toEqual([]);
    expect(openingBlockedObjectIds(scene, layout)).toEqual([]);
  });

  it.each([
    [
      "the seed placeholder room",
      seedRoomScene,
      {
        sofa_01: [-1.3, 0.425, -1.2, -Math.PI / 4],
        table_01: [-0.2, 0.21, -0.1, 0],
        rug_01: [-0.2, 0.01, -0.1, -Math.PI / 4],
        lamp_01: [-2.7, 0.8, -0.5, 0],
        chair_01: [0.7, 0.425, -1, Math.PI / 4],
        plant_01: [-2.625, 0.6, -2.025, 0],
      },
    ],
    [
      "the redesign dragged to the poor journey layout",
      poorRedesignedJourneyScene,
      {
        sofa_01: [-1.3, 0.39, -1.1, -Math.PI / 4],
        table_01: [-0.3, 0.19, 0.1, 0],
        rug_01: [-0.3, 0.01, 0.2, -Math.PI / 4],
        lamp_01: [-2.6, 0.77, 0, 0],
        chair_01: [0.8, 0.375, -1, Math.PI / 4],
        plant_01: [-2.4, 0.9, -1.7, 0],
      },
    ],
  ])("pins the arranged coordinates for %s", (_journey, buildScene, expected) => {
    const scene = buildScene();
    const layout = arrangeWith(scene, {
      rotationOptions: buildRotationOptions(scene),
    });
    expect(
      Object.fromEntries(
        Object.entries(expected).map(([objectId]) => {
          const object = layout[objectId]!;
          return [objectId, [...object.position, object.rotation[1]]];
        }),
      ),
    ).toEqual(expected);
  });

  it("is deterministic with options", () => {
    const run = () => {
      const scene = poorRedesignedJourneyScene();
      return proposeNaturalPlacement(scene, {
        rotationOptions: buildRotationOptions(scene),
      });
    };
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it("keeps the seed layout under the candidate and beam caps", () => {
    const scene = poorRedesignedJourneyScene();
    const result = proposeNaturalPlacement(scene, {
      rotationOptions: buildRotationOptions(scene),
    });
    expect(result.kind).toBe("changed");
    if (result.kind !== "changed") return;
    expect(result.diagnostics.evaluatedLayouts).toBeGreaterThan(0);
    // At most one settled beam per fixed-point pass, and the solver caps the passes
    // at eight; nothing here may widen the beam to reach the staged layout.
    expect(result.diagnostics.evaluatedLayouts).toBeLessThanOrEqual(
      PLACEMENT_LIMITS.beamWidth * 8,
    );
  });

  it("settles on a second pass with options", () => {
    const scene = poorRedesignedJourneyScene();
    const rotationOptions = buildRotationOptions(scene);
    const layout = arrangeWith(scene, { rotationOptions });
    const arranged: Scene = {
      ...scene,
      objects: scene.objects.map((object) => layout[object.id] ?? object),
    };
    expect(proposeNaturalPlacement(arranged, { rotationOptions }).kind).toBe(
      "unchanged",
    );
  });

  it("folds an accumulated stage rotation onto the option it stands for", () => {
    // The rotation handle accumulates without bounds while the view registry lists the
    // folded angles, so a room saved after four full turns must still arrange.
    const scene = poorRedesignedJourneyScene();
    for (const object of scene.objects) {
      if (object.type === "rug") continue;
      object.rotation[1] += Math.PI * 4;
    }
    const rotationOptions = buildRotationOptions(scene);
    const proposal = proposeNaturalPlacement(scene, { rotationOptions });
    expect(proposal.kind).toBe("changed");
    if (proposal.kind !== "changed") return;

    for (const placement of proposal.placements) {
      const object = scene.objects.find(({ id }) => id === placement.objectId)!;
      if (object.type === "rug") continue;
      expect(
        rotationOptions[object.id]!.some(
          ({ rotationY }) => Math.abs(rotationY - placement.rotationY) < 1e-9,
        ),
      ).toBe(true);
    }
    expect(
      validateAndApplyPlacement(scene, proposal, rotationOptions),
    ).toMatchObject({ ok: true, changed: true });
  });

  it("scores a folded rotation as truthfully as the option it stands for", () => {
    // The stage accumulates rotations without bounds while the view registry lists the
    // folded angles, so the fidelity term has to match orientations, not numbers.
    const rotationOptions = {
      sofa_01: [
        { rotationY: 0, fidelity: 1 },
        { rotationY: Math.PI, fidelity: 0.6 },
      ],
    };
    const currentScoreAt = (rotationY: number) => {
      const result = proposeNaturalPlacement(singleSofaScene(rotationY, -1.2, -2.4), {
        rotationOptions,
      });
      if (result.kind === "failed") throw new Error(`failed: ${result.reason}`);
      expect(result.diagnostics.currentScore).not.toBeNull();
      return result.diagnostics.currentScore!;
    };

    // A full turn past an option, and the other end of the fold, are the same orientation.
    expect(currentScoreAt(2 * Math.PI)).toBe(currentScoreAt(0));
    expect(currentScoreAt(-Math.PI)).toBe(currentScoreAt(Math.PI));

    // Folding compares angles; it does not make every rotation an option. The same
    // incumbent layout scored against a table that omits its orientation loses the term.
    const offTable = proposeNaturalPlacement(singleSofaScene(0, -1.2, -2.4), {
      rotationOptions: { sofa_01: [{ rotationY: Math.PI / 2, fidelity: 1 }] },
    });
    if (offTable.kind === "failed") throw new Error(`failed: ${offTable.reason}`);
    expect(offTable.diagnostics.currentScore).toBeLessThan(currentScoreAt(0));
  });

  it("offers a chair family whose turn folds onto the option at half a turn", () => {
    // With the full generated set every 45-degree step is registered, and the registry
    // folds them into (-pi, pi] - so half a turn is stored once, as +pi. A family whose
    // required turn works out to -pi asks for that same orientation under its other name.
    const generated: readonly RotationOption[] = Array.from(
      { length: 8 },
      (_, index) => ({
        rotationY: (index - 3) * (Math.PI / 4),
        fidelity: index === 3 ? 1 : 0.8,
      }),
    );
    expect(generated.map(({ rotationY }) => rotationY)).toContain(Math.PI);
    expect(generated.map(({ rotationY }) => rotationY)).not.toContain(-Math.PI);

    const scene = keepObjects(
      completedProductScene(),
      "sofa_01",
      "table_01",
      "chair_01",
    );
    scene.id = "generated-view-options";
    scene.source = "upload";
    scene.room = { width: 6, height: 2.5, depth: 6 };
    scene.openings = [];
    const sofa = scene.objects.find(({ id }) => id === "sofa_01")!;
    const table = scene.objects.find(({ id }) => id === "table_01")!;
    const chair = scene.objects.find(({ id }) => id === "chair_01")!;
    // Three quarter turns anticlockwise: the chair's left-end flank needs
    // sofaYaw - 45 degrees, which lands exactly on -180.
    sofa.position = [0, sofa.position[1], 0];
    sofa.rotation[1] = (-3 * Math.PI) / 4;
    table.position = [0.8, table.position[1], -0.8];

    const candidates = chairCandidates(scene, chair, scene.objects, {
      rotationOptions: { chair_01: generated },
    });

    expect(candidates.some(({ rotationY }) => rotationY === Math.PI)).toBe(true);
    // Both flank ends are offered, not just the one whose turn needed no fold.
    expect(candidates.some(({ rotationY }) => rotationY === -Math.PI / 2)).toBe(true);
    // Every candidate still carries an option's own value, half a turn included.
    for (const { rotationY } of candidates) {
      expect(
        generated.some((option) => Math.abs(option.rotationY - rotationY) < 1e-9),
      ).toBe(true);
    }
  });

  it("rejects a proposal whose rotation is outside the object's options", () => {
    const scene = poorRedesignedJourneyScene();
    const rotationOptions = buildRotationOptions(scene);
    const proposal = proposeNaturalPlacement(scene, { rotationOptions });
    expect(proposal.kind).toBe("changed");
    if (proposal.kind !== "changed") return;
    const tampered: NaturalPlacementResult = {
      ...proposal,
      placements: proposal.placements.map((placement) =>
        placement.objectId === "chair_01"
          ? { ...placement, rotationY: Math.PI / 3 }
          : placement,
      ),
    };
    expect(validateAndApplyPlacement(scene, tampered, rotationOptions)).toEqual({
      ok: false,
      scene,
      reason: "invalid-input",
    });
  });
});

describe("composition without a sofa", () => {
  it("still keeps a lamp out of the foreground when no sofa exists", () => {
    const scene = seedRoomScene();
    scene.objects = scene.objects.filter(({ type }) => type !== "sofa");
    const lamp = scene.objects.find(({ type }) => type === "floor_lamp")!;
    const front = { ...scene, objects: scene.objects.map((o) => (o.id === lamp.id ? { ...o, position: [-2.0, o.position[1], scene.room.depth / 2 - 0.3] as [number, number, number] } : o)) };
    const back = { ...scene, objects: scene.objects.map((o) => (o.id === lamp.id ? { ...o, position: [-2.0, o.position[1], -scene.room.depth / 2 + 0.3] as [number, number, number] } : o)) };
    const scoreOf = (s: typeof scene) => proposeNaturalPlacement(s).kind === "failed" ? null : (proposeNaturalPlacement(s) as { diagnostics: { currentScore: number | null } }).diagnostics.currentScore;
    const frontScore = scoreOf(front);
    const backScore = scoreOf(back);
    expect(frontScore).not.toBeNull();
    expect(backScore).not.toBeNull();
    expect(backScore!).toBeGreaterThan(frontScore!);
  });
});

/**
 * Spec catalog-expansion 3 and 4: the side table is an accessory staged beside a seat,
 * and the bookshelf is a perimeter object that backs onto a clearance-free wall facing
 * the room. Both are built from the category table rather than the catalog, so these
 * cases hold before any product of either category exists.
 */
describe("side table and bookshelf placement", () => {
  /** A bare 6.0 x 6.0 room holding whichever seed objects the case needs. */
  function bareRoom(id: string, ...ids: string[]): Scene {
    const scene = keepObjects(seedRoomScene(), ...ids);
    scene.id = id;
    scene.source = "upload";
    scene.room = { width: 6, height: 2.5, depth: 6 };
    scene.openings = [];
    return scene;
  }

  function catalogObject(
    id: string,
    type: "side_table" | "bookshelf",
    x: number,
    z: number,
    rotationY = 0,
  ): SceneObject {
    const dimensionsM = { ...CATEGORY_DIMENSIONS[type] };
    return {
      id,
      type,
      source: "placeholder",
      position: [x, dimensionsM.height / 2, z],
      rotation: [0, rotationY, 0],
      scale: [1, 1, 1],
      dimensionsM,
      locked: false,
      styleTags: [],
      addedBy: "human",
    };
  }

  /** The edge gap between two footprints along an axis; negative when they overlap. */
  function gapAlong(
    first: SceneObject,
    second: SceneObject,
    axis: { x: number; z: number },
  ): number {
    const span = (object: SceneObject) =>
      footprintProjection(objectFootprint(object), axis.x, axis.z);
    const a = span(first);
    const b = span(second);
    if (b.minimum >= a.maximum) return b.minimum - a.maximum;
    if (a.minimum >= b.maximum) return a.minimum - b.maximum;
    return Math.max(a.minimum, b.minimum) - Math.min(a.maximum, b.maximum);
  }

  /** The seat's own axes, spelled out rather than borrowed from the solver. */
  function seatAxes(rotationY: number) {
    return {
      lateral: { x: Math.cos(rotationY), z: Math.sin(rotationY) },
      forward: { x: -Math.sin(rotationY), z: Math.cos(rotationY) },
    };
  }

  function placedAs(object: SceneObject, placement: ProposedPlacement): SceneObject {
    return {
      ...object,
      position: [...placement.position],
      rotation: [object.rotation[0], placement.rotationY, object.rotation[2]],
    };
  }

  function placementOf(
    result: NaturalPlacementResult,
    objectId: string,
  ): ProposedPlacement {
    if (result.kind !== "changed") throw new Error(`expected a changed proposal`);
    const placement = result.placements.find((entry) => entry.objectId === objectId);
    if (!placement) throw new Error(`no placement for ${objectId}`);
    return placement;
  }

  function currentScoreOf(scene: Scene): number {
    const result = proposeNaturalPlacement(scene);
    if (result.kind === "failed") throw new Error(`failed: ${result.reason}`);
    if (result.diagnostics.currentScore === null) {
      throw new Error("the current layout broke a hard constraint");
    }
    return result.diagnostics.currentScore;
  }

  /** A locked sofa on the back wall and one side table wherever the case puts it. */
  function sofaSideTableScene(x: number, z: number): Scene {
    const scene = bareRoom("side-table-beside-sofa", "sofa_01");
    const sofa = scene.objects[0]!;
    sofa.position = [-1, sofa.position[1], -2.45];
    sofa.rotation = [0, 0, 0];
    sofa.locked = true;
    scene.objects.push(catalogObject("side_01", "side_table", x, z));
    return SceneSchema.parse(scene);
  }

  /** A locked chair against the left wall, turned to face the room. */
  function chairSideTableScene(x: number, z: number): Scene {
    const scene = bareRoom("side-table-beside-chair", "chair_01");
    const chair = scene.objects[0]!;
    chair.position = [-2.5, chair.position[1], 0];
    chair.rotation = [0, -Math.PI / 2, 0];
    chair.locked = true;
    scene.objects.push(catalogObject("side_01", "side_table", x, z));
    return SceneSchema.parse(scene);
  }

  /** The photographed set a `front-back` category carries: one front-quarter view. */
  const BOOKSHELF_VIEW_SET: PhotoAssetSet = {
    id: "test-bookshelf",
    type: "bookshelf",
    symmetry: PHOTO_VIEW_SYMMETRY.bookshelf,
    views: [
      {
        view: "front-quarter",
        frontVector: FRONT_VECTORS["front-quarter"],
        src: "/photo/test-bookshelf/front-quarter.png",
        intrinsicWidth: 512,
        intrinsicHeight: 1024,
        anchorX: 0.5,
        anchorY: 0.98,
        origin: "photographed",
      },
    ],
  };

  /** A 6.0 x 6.0 room whose back window the bookshelf currently stands in front of. */
  function bookshelfScene(): Scene {
    const scene = bareRoom("bookshelf-wall-sweep");
    scene.openings = [
      {
        id: "window_back",
        kind: "window",
        wall: "back",
        offset: 0.5,
        widthM: 1.6,
        heightM: 1.2,
      },
    ];
    scene.objects.push(catalogObject("shelf_01", "bookshelf", 0, -2.7));
    return SceneSchema.parse(scene);
  }

  /** The walls the footprint is flush against, with the direction the room lies in. */
  function backedWalls(
    scene: Scene,
    object: SceneObject,
  ): readonly { x: number; z: number }[] {
    const { minimumX, maximumX, minimumZ, maximumZ } = footprintExtent(
      objectFootprint(object),
    );
    const flush = PLACEMENT_LIMITS.roomInsetM + PLACEMENT_LIMITS.gridM + 1e-9;
    return [
      { gap: minimumX + scene.room.width / 2, inward: { x: 1, z: 0 } },
      { gap: scene.room.width / 2 - maximumX, inward: { x: -1, z: 0 } },
      { gap: minimumZ + scene.room.depth / 2, inward: { x: 0, z: 1 } },
      { gap: scene.room.depth / 2 - maximumZ, inward: { x: 0, z: -1 } },
    ]
      .filter(({ gap }) => gap <= flush)
      .map(({ inward }) => inward);
  }

  function facesRoomFromAWall(scene: Scene, object: SceneObject): boolean {
    const { forward } = seatAxes(object.rotation[1]);
    return backedWalls(scene, object).some(
      (inward) => forward.x * inward.x + forward.z * inward.z > 1e-6,
    );
  }

  it("scores a side table beside the sofa above the same table mid-floor", () => {
    const beside = currentScoreOf(sofaSideTableScene(-2.4, -2.45));
    const midFloor = currentScoreOf(sofaSideTableScene(0, 0));
    expect(beside).toBeGreaterThan(midFloor);
  });

  it("stages a mid-floor side table at a sofa end", () => {
    const scene = sofaSideTableScene(0, 0);
    const result = proposeNaturalPlacement(scene);
    expect(result.kind).toBe("changed");
    const sofa = scene.objects.find(({ id }) => id === "sofa_01")!;
    const table = placedAs(
      scene.objects.find(({ id }) => id === "side_01")!,
      placementOf(result, "side_01"),
    );
    const { lateral, forward } = seatAxes(sofa.rotation[1]);
    expect(gapAlong(sofa, table, lateral)).toBeGreaterThanOrEqual(0.05 - 1e-9);
    expect(gapAlong(sofa, table, lateral)).toBeLessThanOrEqual(0.25 + 1e-9);
    // Inside the sofa's own depth band, so it reads as beside the sofa's end.
    expect(gapAlong(sofa, table, forward)).toBeLessThanOrEqual(0);
    // A radial category is never turned.
    expect(placementOf(result, "side_01").rotationY).toBe(table.rotation[1]);
  });

  it("stages a mid-floor side table beside a chair when no sofa exists", () => {
    const scene = chairSideTableScene(1.2, 1.2);
    const result = proposeNaturalPlacement(scene);
    expect(result.kind).toBe("changed");
    const chair = scene.objects.find(({ id }) => id === "chair_01")!;
    const table = placedAs(
      scene.objects.find(({ id }) => id === "side_01")!,
      placementOf(result, "side_01"),
    );
    const { lateral, forward } = seatAxes(chair.rotation[1]);
    expect(gapAlong(chair, table, lateral)).toBeGreaterThanOrEqual(0.05 - 1e-9);
    expect(gapAlong(chair, table, lateral)).toBeLessThanOrEqual(0.25 + 1e-9);
    expect(gapAlong(chair, table, forward)).toBeLessThanOrEqual(0);
  });

  it("offers the six front-back options for a bookshelf and none for a side table", () => {
    const shelf = catalogObject("shelf_01", "bookshelf", 0, 0);
    const degrees = rotationOptionsFor(shelf, BOOKSHELF_VIEW_SET)
      .map(({ rotationY }) => Math.round((rotationY * 180) / Math.PI))
      .sort((first, second) => first - second);
    expect(degrees).toEqual([-135, -45, 0, 45, 135, 180]);

    // A radial category keeps the rotation it came with, whatever set it carries.
    const table = catalogObject("side_01", "side_table", 0, 0, Math.PI / 3);
    expect(
      rotationOptionsFor(table, { ...BOOKSHELF_VIEW_SET, type: "side_table" }),
    ).toEqual([{ rotationY: Math.PI / 3, fidelity: 1 }]);
  });

  it("sweeps only clearance-free walls the bookshelf can face the room from", () => {
    const scene = bookshelfScene();
    const shelf = scene.objects.find(({ id }) => id === "shelf_01")!;
    const options = { rotationOptions: { shelf_01: rotationOptionsFor(shelf, BOOKSHELF_VIEW_SET) } };
    const candidates = bookshelfCandidates(scene, shelf, options);
    const zones = openingClearanceZones(scene);

    expect(candidates.length).toBeGreaterThan(1);
    for (const placement of candidates) {
      const placed = placedAs(shelf, placement);
      expect(
        options.rotationOptions.shelf_01.some(
          ({ rotationY }) => Math.abs(rotationY - placement.rotationY) < 1e-9,
        ),
      ).toBe(true);
      expect(
        footprintInsideRoom(
          objectFootprint(placed),
          scene.room,
          PLACEMENT_LIMITS.roomInsetM,
        ),
      ).toBe(true);
      // The incumbent stands in the window's clearance zone and leads the list; every
      // swept position is clear of every zone and faces the room from its own wall.
      if (placement === candidates[0]) continue;
      expect(
        zones.some((zone) => footprintsOverlap(objectFootprint(placed), zone)),
      ).toBe(false);
      expect(facesRoomFromAWall(scene, placed)).toBe(true);
    }
  });

  it("moves a bookshelf out of an opening clearance onto a wall it can face the room from", () => {
    const scene = bookshelfScene();
    const shelf = scene.objects.find(({ id }) => id === "shelf_01")!;
    const rotationOptions = { shelf_01: rotationOptionsFor(shelf, BOOKSHELF_VIEW_SET) };
    const result = proposeNaturalPlacement(scene, { rotationOptions });
    expect(result.kind).toBe("changed");
    const placement = placementOf(result, "shelf_01");
    const placed = placedAs(shelf, placement);

    expect(
      rotationOptions.shelf_01.some(
        ({ rotationY }) => Math.abs(rotationY - placement.rotationY) < 1e-9,
      ),
    ).toBe(true);
    expect(
      openingClearanceZones(scene).some((zone) =>
        footprintsOverlap(objectFootprint(placed), zone),
      ),
    ).toBe(false);
    expect(facesRoomFromAWall(scene, placed)).toBe(true);
    expect(
      validateAndApplyPlacement(scene, result, rotationOptions),
    ).toMatchObject({ ok: true, changed: true });
  });

  it("stays deterministic and inside the caps with both new types in the room", () => {
    const build = (): Scene => {
      const scene = bareRoom("catalog-caps", "sofa_01", "table_01", "chair_01", "plant_01");
      scene.openings = [
        {
          id: "window_back",
          kind: "window",
          wall: "back",
          offset: 0.62,
          widthM: 1.6,
          heightM: 1.2,
        },
      ];
      scene.objects.push(catalogObject("side_01", "side_table", 0.4, 0.4));
      scene.objects.push(catalogObject("shelf_01", "bookshelf", -0.6, 1.4));
      return SceneSchema.parse(scene);
    };
    const shelf = build().objects.find(({ id }) => id === "shelf_01")!;
    const rotationOptions = {
      shelf_01: rotationOptionsFor(shelf, BOOKSHELF_VIEW_SET),
    };
    const run = () => proposeNaturalPlacement(build(), { rotationOptions });

    const first = run();
    expect(first.kind).not.toBe("failed");
    expect(JSON.stringify(first)).toBe(JSON.stringify(run()));
    if (first.kind === "failed") return;
    expect(first.diagnostics.evaluatedLayouts).toBeLessThanOrEqual(
      PLACEMENT_LIMITS.beamWidth * 8,
    );

    // Both new types are movable, non-rug objects to the command adapter.
    if (first.kind !== "changed") return;
    expect(first.placements.map(({ objectId }) => objectId).sort()).toEqual([
      "chair_01",
      "plant_01",
      "shelf_01",
      "side_01",
      "sofa_01",
      "table_01",
    ]);
    expect(
      validateAndApplyPlacement(build(), first, rotationOptions),
    ).toMatchObject({ ok: true, changed: true });
  });
});
