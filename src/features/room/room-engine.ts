import {
  SceneSchema,
  type DimensionsM,
  type Scene,
  type SceneObject,
  type SceneObjectType,
  type Vec3,
} from "../scene/scene-schema";
import {
  RoomAnalysisSchema,
  type RoomAnalysis,
} from "./room-analysis-schema";

const MIN_ROOM_METRES = 2.5;
const MAX_ROOM_METRES = 8;
const ROOM_HEIGHT_METRES = 2.5;
const ROOM_INSET_METRES = 0.1;

export const CATEGORY_DIMENSIONS: Record<SceneObjectType, DimensionsM> = {
  sofa: { width: 2, height: 0.85, depth: 0.9 },
  coffee_table: { width: 1.2, height: 0.42, depth: 0.6 },
  rug: { width: 2.4, height: 0.02, depth: 1.7 },
  floor_lamp: { width: 0.35, height: 1.6, depth: 0.35 },
  chair: { width: 0.8, height: 0.85, depth: 0.8 },
  plant: { width: 0.55, height: 1.2, depth: 0.55 },
  side_table: { width: 0.45, height: 0.55, depth: 0.45 },
  bookshelf: { width: 0.9, height: 1.8, depth: 0.35 },
  unknown: { width: 1, height: 1, depth: 1 },
};

const ID_PREFIX: Record<SceneObjectType, string> = {
  sofa: "sofa",
  coffee_table: "table",
  rug: "rug",
  floor_lamp: "lamp",
  chair: "chair",
  plant: "plant",
  side_table: "side",
  bookshelf: "shelf",
  unknown: "unknown",
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function floorY(type: SceneObjectType, dimensions: DimensionsM) {
  return type === "rug" ? 0.01 : dimensions.height / 2;
}

function anchorPosition(
  anchor: string,
  dimensions: DimensionsM,
  room: DimensionsM,
): Vec3 {
  const left = -room.width / 2 + ROOM_INSET_METRES + dimensions.width / 2;
  const right = room.width / 2 - ROOM_INSET_METRES - dimensions.width / 2;
  const back = -room.depth / 2 + ROOM_INSET_METRES + dimensions.depth / 2;
  const front = room.depth / 2 - ROOM_INSET_METRES - dimensions.depth / 2;
  const y = dimensions.height / 2;

  switch (anchor) {
    case "left-wall":
      return [left, y, 0];
    case "right-wall":
      return [right, y, 0];
    case "back-left":
      return [left, y, back];
    case "back-right":
      return [right, y, back];
    case "front-left":
      return [left, y, front];
    case "front-right":
      return [right, y, front];
    case "back":
    case "back-wall":
      return [0, y, back];
    case "front":
    case "front-wall":
      return [0, y, front];
    default:
      return [0, y, 0];
  }
}

function clampObject(object: SceneObject, room: DimensionsM) {
  const xLimit =
    room.width / 2 - ROOM_INSET_METRES - object.dimensionsM.width / 2;
  const zLimit =
    room.depth / 2 - ROOM_INSET_METRES - object.dimensionsM.depth / 2;
  object.position = [
    clamp(object.position[0], -xLimit, xLimit),
    floorY(object.type, object.dimensionsM),
    clamp(object.position[2], -zLimit, zLimit),
  ];
}

function aabbOverlaps(first: SceneObject, second: SceneObject) {
  return (
    Math.abs(first.position[0] - second.position[0]) <
      (first.dimensionsM.width + second.dimensionsM.width) / 2 &&
    Math.abs(first.position[2] - second.position[2]) <
      (first.dimensionsM.depth + second.dimensionsM.depth) / 2
  );
}

function resolveInitialSofaTableCollision(
  objects: SceneObject[],
  room: DimensionsM,
) {
  const sofa = objects.find((object) => object.type === "sofa");
  const table = objects.find((object) => object.type === "coffee_table");
  if (!sofa || !table) return;

  const maximumZ =
    room.depth / 2 - ROOM_INSET_METRES - table.dimensionsM.depth / 2;
  while (aabbOverlaps(sofa, table) && table.position[2] < maximumZ) {
    table.position = [
      table.position[0],
      table.position[1],
      Math.min(table.position[2] + 0.1, maximumZ),
    ];
  }
  clampObject(table, room);
}

export function buildScene(
  input: RoomAnalysis,
  confirmedWidthM: number,
): Scene {
  const analysis = RoomAnalysisSchema.parse(input);
  const width = clamp(
    confirmedWidthM,
    MIN_ROOM_METRES,
    MAX_ROOM_METRES,
  );
  const room: DimensionsM = {
    width,
    height: ROOM_HEIGHT_METRES,
    depth: clamp(
      width / analysis.estimatedAspectRatio,
      MIN_ROOM_METRES,
      MAX_ROOM_METRES,
    ),
  };
  const categoryCounts = new Map<SceneObjectType, number>();

  const objects = analysis.objects
    .filter((object) => object.confidence >= 0.55)
    .map<SceneObject>((object) => {
      const count = (categoryCounts.get(object.type) ?? 0) + 1;
      categoryCounts.set(object.type, count);
      const dimensionsM = { ...CATEGORY_DIMENSIONS[object.type] };
      const position = anchorPosition(object.anchor, dimensionsM, room);
      const sceneObject: SceneObject = {
        id: `${ID_PREFIX[object.type]}_${String(count).padStart(2, "0")}`,
        type: object.type,
        source: "placeholder",
        position: [position[0], floorY(object.type, dimensionsM), position[2]],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        dimensionsM,
        locked: false,
        styleTags: [],
        addedBy: "seed",
      };
      clampObject(sceneObject, room);
      return sceneObject;
    });

  resolveInitialSofaTableCollision(objects, room);

  const openingCounts = new Map<"door" | "window", number>();
  const openings = analysis.openings.map((opening) => {
    const count = (openingCounts.get(opening.kind) ?? 0) + 1;
    openingCounts.set(opening.kind, count);
    return {
      id: `${opening.kind}_${String(count).padStart(2, "0")}`,
      ...opening,
      widthM: opening.kind === "window" ? 1.4 : 0.9,
      heightM: opening.kind === "window" ? 1.2 : 2.1,
    };
  });

  return SceneSchema.parse({
    id: "room_upload_01",
    version: 1,
    revision: 1,
    source: "upload",
    styleIntent: null,
    room,
    openings,
    objects,
    selectedObjectId: null,
  });
}
