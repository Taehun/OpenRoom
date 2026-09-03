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

export function createDemoScene(): Scene {
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
    6,
  );

  for (const object of scene.objects) {
    const assetId = SEED_ASSETS[object.id];
    if (assetId) object.assetId = assetId;
    if (object.id === "lamp_01") {
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
