import { buildScene } from "../features/room/room-engine";
import { SceneSchema, type Scene } from "../features/scene/scene-schema";

const SEED_ASSETS: Record<string, string> = {
  sofa_01: "seed-dated-sofa",
  table_01: "seed-glass-table",
  rug_01: "seed-pattern-rug",
  lamp_01: "seed-brass-lamp",
  chair_01: "seed-vinyl-chair",
  plant_01: "seed-faux-plant",
};

/**
 * Width of the photographed demo room. Measured from the before photo: the dated
 * sofa's silhouette spans 0.4575 of the stage at its depth, the curtained window bay
 * 0.225, and the club chair 0.209; the three bands overlap at 3.4 m. The depth follows
 * the analysis aspect ratio (1.25), giving 3.4 x 2.72 m.
 */
export const DEMO_ROOM_WIDTH_M = 3.4;

interface SeedPlacement {
  x: number;
  z: number;
  rotationDeg: number;
}

/**
 * Where the photographed pieces stand in the calibrated room. Every footprint sits
 * inside the 0.1 m inset, only the rug overlaps anything, and everything but the sofa
 * (a 2 m sofa on a 3.4 m wall cannot avoid the 1.8 m window clearance) keeps clear of
 * the window. The sofa stays at x <= 0 so the compositor keeps its native
 * front-quarter cutout; the chair at +45 degrees faces the table and picks the
 * mirrored cutout exactly.
 */
const CALIBRATED_SEED: Readonly<Record<string, SeedPlacement>> = {
  sofa_01: { x: -0.2, z: -0.8, rotationDeg: 0 },
  table_01: { x: -0.2, z: 0.4, rotationDeg: 0 },
  rug_01: { x: -0.2, z: 0.38, rotationDeg: 0 },
  lamp_01: { x: -1.42, z: -0.75, rotationDeg: 0 },
  chair_01: { x: 1.02, z: 0.6, rotationDeg: 45 },
  plant_01: { x: 1.3, z: -0.32, rotationDeg: 0 },
};

export interface DemoSceneOptions {
  /**
   * Room width in metres. Defaults to the calibrated photo width; any other width
   * keeps the analysis anchors instead of the calibrated placement (fixtures that
   * need a roomier floor, such as the placement solver, pass 6).
   */
  widthM?: number;
}

export function createDemoScene({
  widthM = DEMO_ROOM_WIDTH_M,
}: DemoSceneOptions = {}): Scene {
  const scene = buildScene(
    {
      roomType: "living_room",
      estimatedAspectRatio: 1.25,
      openings: [{ kind: "window", wall: "back", offset: 0.62 }],
      objects: [
        { type: "sofa", anchor: "left-wall", confidence: 0.96 },
        { type: "coffee_table", anchor: "center", confidence: 0.94 },
        { type: "rug", anchor: "center", confidence: 0.91 },
        { type: "floor_lamp", anchor: "back-right", confidence: 0.89 },
        { type: "chair", anchor: "right-wall", confidence: 0.87 },
        { type: "plant", anchor: "back-left", confidence: 0.9 },
      ],
    },
    widthM,
  );
  const calibrated = widthM === DEMO_ROOM_WIDTH_M;

  for (const object of scene.objects) {
    const assetId = SEED_ASSETS[object.id];
    if (assetId) object.assetId = assetId;
    const placement = calibrated ? CALIBRATED_SEED[object.id] : undefined;
    if (placement) {
      // buildScene already resolved the resting Y for the category; only the floor
      // coordinates and the yaw come from the calibration.
      object.position = [placement.x, object.position[1], placement.z];
      object.rotation = [0, (placement.rotationDeg * Math.PI) / 180, 0];
    } else if (object.id === "lamp_01") {
      object.position = [0.5, object.position[1], object.position[2]];
    }
  }

  return SceneSchema.parse({
    ...scene,
    id: "demo-living-room",
    source: "demo",
    selectedObjectId: "table_01",
  });
}
