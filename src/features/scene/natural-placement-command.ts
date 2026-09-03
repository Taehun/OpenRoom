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
  RotationOption,
} from "../placement/placement-types";
import { SceneSchema, type Scene, type SceneObject } from "./scene-schema";
import { supportRelations } from "./support";

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

/** Spec 8.4: two option rotations closer than this stand for the same orientation. */
const ROTATION_OPTION_EPSILON = 1e-9;

/**
 * Spec 8.4: the solver's candidate generators guarantee it, and this re-checks it. A
 * non-rug placement may only carry a rotation the object's own options list, and an
 * object the table says nothing about may not be turned at all.
 */
function rotationIsAllowed(
  current: SceneObject,
  rotationY: number,
  rotationOptions: Readonly<Record<string, readonly RotationOption[]>> | undefined,
) {
  if (current.type === "rug") return true;
  const choices = rotationOptions?.[current.id];
  if (choices === undefined || choices.length === 0) {
    return rotationY === current.rotation[1];
  }
  return choices.some(
    (option) => Math.abs(option.rotationY - rotationY) <= ROTATION_OPTION_EPSILON,
  );
}

/**
 * Spec §5: an object standing on another shares its floor area on purpose, so a
 * supported lamp and its table are not a collision. Every other non-rug pair is.
 */
function hasNonRugCollision(scene: Scene) {
  const supporters = supportRelations(scene);
  const obstacles = scene.objects.filter(({ type }) => type !== "rug");
  for (let first = 0; first < obstacles.length; first += 1) {
    for (let second = first + 1; second < obstacles.length; second += 1) {
      const left = obstacles[first]!;
      const right = obstacles[second]!;
      if (
        supporters.get(left.id) === right.id ||
        supporters.get(right.id) === left.id
      ) {
        continue;
      }
      if (
        footprintsOverlap(objectFootprint(left), objectFootprint(right))
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
  rotationOptions?: Readonly<Record<string, readonly RotationOption[]>>,
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
        !rotationIsAllowed(current, placement.rotationY, rotationOptions)
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
      hasNonRugCollision(next)
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
