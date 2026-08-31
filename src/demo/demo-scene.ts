import { buildScene } from "../features/room/room-engine";
import { SceneSchema, type Scene } from "../features/scene/scene-schema";

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

  return SceneSchema.parse({
    ...scene,
    id: "demo-living-room",
    source: "demo",
    selectedObjectId: "table_01",
  });
}
