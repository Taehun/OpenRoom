import { hasCirculationPath } from "../placement/circulation";
import {
  footprintInsideRoom,
  footprintsOverlap,
  objectFootprint,
  openingClearanceZones,
} from "../placement/footprint-geometry";
import { PLACEMENT_LIMITS } from "../placement/placement-profile";
import type {
  NaturalPlacementResult,
  PlacementFailureReason,
} from "../placement/placement-types";
import { SceneSchema, type Scene, type SceneObject } from "./scene-schema";

export type PlacementApplication =
  | { ok: true; changed: true; scene: Scene }
  | { ok: true; changed: false; scene: Scene }
  | { ok: false; scene: Scene; reason: PlacementFailureReason };

function invalid(scene: Scene): PlacementApplication {
  return { ok: false, scene, reason: "invalid-input" };
}

function blocksOpening(scene: Scene, object: SceneObject) {
  const footprint = objectFootprint(object);
  return openingClearanceZones(scene).some((zone) =>
    footprintsOverlap(footprint, zone),
  );
}

function hasNonRugCollision(objects: readonly SceneObject[]) {
  const obstacles = objects.filter(({ type }) => type !== "rug");
  for (let first = 0; first < obstacles.length; first += 1) {
    for (let second = first + 1; second < obstacles.length; second += 1) {
      if (
        footprintsOverlap(
          objectFootprint(obstacles[first]!),
          objectFootprint(obstacles[second]!),
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

export function validateAndApplyPlacement(
  scene: Scene,
  proposal: NaturalPlacementResult,
): PlacementApplication {
  if (proposal.kind === "failed") {
    return { ok: false, scene, reason: proposal.reason };
  }
  if (proposal.kind === "unchanged") {
    return { ok: true, changed: false, scene };
  }

  try {
    if (
      !SceneSchema.safeParse(scene).success ||
      new Set(scene.objects.map(({ id }) => id)).size !== scene.objects.length
    ) {
      return invalid(scene);
    }

    const movable = scene.objects.filter(
      ({ locked, type }) => !locked && type !== "unknown",
    );
    const movableIds = new Set(movable.map(({ id }) => id));
    const proposedIds = new Set(proposal.placements.map(({ objectId }) => objectId));
    if (
      proposal.placements.length !== movable.length ||
      proposedIds.size !== proposal.placements.length ||
      proposedIds.size !== movableIds.size ||
      [...proposedIds].some((id) => !movableIds.has(id))
    ) {
      return invalid(scene);
    }

    const next = structuredClone(scene);
    const nextById = new Map(next.objects.map((object) => [object.id, object]));
    const movedObjects: SceneObject[] = [];
    for (const placement of proposal.placements) {
      const current = scene.objects.find(({ id }) => id === placement.objectId);
      const object = nextById.get(placement.objectId);
      if (
        !current ||
        !object ||
        current.locked ||
        current.type === "unknown" ||
        placement.position.length !== 3 ||
        !placement.position.every(Number.isFinite) ||
        !Number.isFinite(placement.rotationY) ||
        placement.position[1] !== current.position[1] ||
        (current.type !== "rug" && placement.rotationY !== current.rotation[1])
      ) {
        return invalid(scene);
      }
      object.position = [...placement.position];
      object.rotation[1] = placement.rotationY;
      movedObjects.push(object);
    }

    if (
      movedObjects.some(
        (object) =>
          !footprintInsideRoom(
            objectFootprint(object),
            next.room,
            PLACEMENT_LIMITS.roomInsetM,
          ) || blocksOpening(next, object),
      ) ||
      hasNonRugCollision(next.objects)
    ) {
      return invalid(scene);
    }

    const rugs = next.objects.filter(({ type }) => type === "rug");
    if (
      !hasCirculationPath(
        next,
        next.objects.map(objectFootprint),
        rugs,
      )
    ) {
      return invalid(scene);
    }

    const parsed = SceneSchema.safeParse(next);
    if (!parsed.success || parsed.data.revision !== scene.revision) {
      return invalid(scene);
    }
    return { ok: true, changed: true, scene: parsed.data };
  } catch {
    return invalid(scene);
  }
}
