import { objectDisplayName } from "../demo/object-labels";
import {
  footprintBounds,
  footprintCorners,
  footprintInsideRoom,
  footprintProjection,
  footprintsOverlap,
  objectFootprint,
} from "../placement/footprint-geometry";
import type { Footprint2D, PointXZ } from "../placement/placement-types";
import {
  SceneSchema,
  type CommandRequest,
  type CommandResult,
  type Scene,
  type SceneCommandErrorCode,
  type SceneObject,
  type Vec3,
} from "./scene-schema";
import { settleElevations, supportRelations } from "./support";

const ROOM_INSET_M = 0.1;
/** A corner this far outside the room is floating-point noise, not an overhang. */
const CORNER_EPSILON = 1e-9;
/** A requested XZ this close to the current one is the same floor spot. */
const POSITION_EPSILON_M = 1e-9;
/** A visible hairline between resolved footprints also absorbs floating-point noise. */
const COLLISION_GAP_M = 1e-6;
/** Six demo objects need fewer than 20 points; this keeps malformed scenes bounded. */
const PLACEMENT_SEARCH_LIMIT = 512;
/** Coarse coverage plus a local refinement catches open pockets between several pieces. */
const FALLBACK_GRID_M = 0.05;
const FALLBACK_REFINEMENT_M = 0.005;

function failure(
  scene: Scene,
  code: SceneCommandErrorCode,
  message: string,
  retryable = false,
): CommandResult {
  return {
    ok: false,
    scene,
    error: { code, message, retryable },
  };
}

function findObject(scene: Scene, objectId: string) {
  return scene.objects.find((object) => object.id === objectId);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

/**
 * Slides `center` along one axis until the whole span `[minimum, maximum]` fits inside
 * `[floor, ceiling]`. A span wider than the room is centred instead, which is the only
 * outcome that keeps the overhang symmetric.
 */
function slideSpanInside(
  center: number,
  minimum: number,
  maximum: number,
  floor: number,
  ceiling: number,
): number {
  if (maximum - minimum > ceiling - floor) {
    return center - (minimum + maximum) / 2 + (floor + ceiling) / 2;
  }
  if (minimum < floor - CORNER_EPSILON) return center + (floor - minimum);
  if (maximum > ceiling + CORNER_EPSILON) return center - (maximum - ceiling);
  return center;
}

/**
 * Spec §4: an accepted position keeps the whole oriented footprint on the floor. The
 * centre clamp handles the axis-aligned case, then any corner still outside the room
 * (a rotated object reaches further than its half-extents) slides the centre along the
 * offending axis. Commands reject only when the footprint cannot fit on the usable
 * floor at all; otherwise this supplies the nearest in-room starting point.
 */
export function clampPositionToRoom(
  scene: Scene,
  object: SceneObject,
  requested: { x: number; z: number },
): { position: Vec3; adjustedToFit: boolean } {
  const xLimit =
    scene.room.width / 2 - ROOM_INSET_M - object.dimensionsM.width / 2;
  const zLimit =
    scene.room.depth / 2 - ROOM_INSET_M - object.dimensionsM.depth / 2;
  let x = xLimit < 0 ? 0 : clamp(requested.x, -xLimit, xLimit);
  let z = zLimit < 0 ? 0 : clamp(requested.z, -zLimit, zLimit);

  const floorX = -scene.room.width / 2 + ROOM_INSET_M;
  const ceilingX = scene.room.width / 2 - ROOM_INSET_M;
  const floorZ = -scene.room.depth / 2 + ROOM_INSET_M;
  const ceilingZ = scene.room.depth / 2 - ROOM_INSET_M;
  const corners = footprintCorners(
    objectFootprint({
      ...object,
      position: [x, object.position[1], z],
    }),
  );
  const cornerXs = corners.map((corner) => corner.x);
  const cornerZs = corners.map((corner) => corner.z);
  x = slideSpanInside(
    x,
    Math.min(...cornerXs),
    Math.max(...cornerXs),
    floorX,
    ceilingX,
  );
  z = slideSpanInside(
    z,
    Math.min(...cornerZs),
    Math.max(...cornerZs),
    floorZ,
    ceilingZ,
  );

  return {
    position: [x, object.position[1], z],
    adjustedToFit: x !== requested.x || z !== requested.z,
  };
}

interface PlacementResolution {
  position: Vec3;
  adjustedToFit: boolean;
  collisionAdjusted: boolean;
}

interface PlacementCandidate {
  point: PointXZ;
  distanceSquared: number;
  preference: number;
  sequence: number;
}

function candidateSceneAt(
  scene: Scene,
  object: SceneObject,
  point: PointXZ,
): { scene: Scene; footprint: Footprint2D } {
  const candidateObject: SceneObject = {
    ...object,
    position: [point.x, object.position[1], point.z],
  };
  const candidateScene: Scene = {
    ...scene,
    objects: scene.objects.map((current) =>
      current.id === object.id ? candidateObject : current
    ),
  };
  return {
    scene: candidateScene,
    footprint: objectFootprint(candidateObject),
  };
}

/** Rugs may lie under furniture, and a supported lamp intentionally overlaps its table. */
function collidersAt(
  scene: Scene,
  object: SceneObject,
  point: PointXZ,
): readonly SceneObject[] {
  if (object.type === "rug") return [];

  const candidate = candidateSceneAt(scene, object, point);
  const supporters = supportRelations(candidate.scene);
  return candidate.scene.objects.filter((other) => {
    if (other.id === object.id || other.type === "rug") return false;
    if (
      supporters.get(object.id) === other.id ||
      supporters.get(other.id) === object.id
    ) {
      return false;
    }
    return footprintsOverlap(candidate.footprint, objectFootprint(other));
  });
}

function placementAxes(
  moving: Footprint2D,
  blocker: Footprint2D,
): readonly PointXZ[] {
  const raw: PointXZ[] = [
    // World-side moves win exact ties, followed by moving toward the camera.
    { x: 1, z: 0 },
    { x: 0, z: 1 },
    { x: Math.cos(moving.rotationY), z: Math.sin(moving.rotationY) },
    { x: -Math.sin(moving.rotationY), z: Math.cos(moving.rotationY) },
    { x: Math.cos(blocker.rotationY), z: Math.sin(blocker.rotationY) },
    { x: -Math.sin(blocker.rotationY), z: Math.cos(blocker.rotationY) },
  ];
  const unique = new Map<string, PointXZ>();
  for (const axis of raw) {
    const canonical =
      axis.x < -POSITION_EPSILON_M ||
      (Math.abs(axis.x) <= POSITION_EPSILON_M && axis.z < 0)
        ? { x: -axis.x, z: -axis.z }
        : axis;
    const key = `${Math.round(canonical.x * 1e9)}:${Math.round(canonical.z * 1e9)}`;
    if (!unique.has(key)) unique.set(key, canonical);
  }
  return [...unique.values()];
}

/** Candidate centres that put the two oriented rectangles just beyond a separating axis. */
function separatedCandidates(
  moving: Footprint2D,
  blocker: Footprint2D,
): readonly { point: PointXZ; preference: number }[] {
  return placementAxes(moving, blocker).flatMap((axis, axisIndex) => {
    const movingSpan = footprintProjection(moving, axis.x, axis.z);
    const blockerSpan = footprintProjection(blocker, axis.x, axis.z);
    const forward = blockerSpan.maximum - movingSpan.minimum + COLLISION_GAP_M;
    const backward = blockerSpan.minimum - movingSpan.maximum - COLLISION_GAP_M;
    return [
      {
        point: {
          x: moving.center.x + axis.x * forward,
          z: moving.center.z + axis.z * forward,
        },
        preference: axisIndex * 2,
      },
      {
        point: {
          x: moving.center.x + axis.x * backward,
          z: moving.center.z + axis.z * backward,
        },
        preference: axisIndex * 2 + 1,
      },
    ];
  });
}

function isLegalFloorPoint(
  scene: Scene,
  object: SceneObject,
  point: PointXZ,
): boolean {
  const candidate = candidateSceneAt(scene, object, point);
  return (
    footprintInsideRoom(
      candidate.footprint,
      candidate.scene.room,
      ROOM_INSET_M,
    ) && collidersAt(scene, object, point).length === 0
  );
}

function nearestGridPosition(
  scene: Scene,
  object: SceneObject,
  origin: PointXZ,
): PointXZ | null {
  const bounds = footprintBounds(objectFootprint(object));
  const minimumX = -scene.room.width / 2 + ROOM_INSET_M + bounds.x;
  const maximumX = scene.room.width / 2 - ROOM_INSET_M - bounds.x;
  const minimumZ = -scene.room.depth / 2 + ROOM_INSET_M + bounds.z;
  const maximumZ = scene.room.depth / 2 - ROOM_INSET_M - bounds.z;
  if (minimumX > maximumX || minimumZ > maximumZ) return null;

  type GridCandidate = {
    point: PointXZ;
    distanceSquared: number;
    preference: number;
  };
  let best: GridCandidate | null = null;
  const nearer = (
    current: GridCandidate | null,
    point: PointXZ,
  ): GridCandidate | null => {
    if (!isLegalFloorPoint(scene, object, point)) return current;
    const deltaX = point.x - origin.x;
    const deltaZ = point.z - origin.z;
    const distanceSquared = deltaX * deltaX + deltaZ * deltaZ;
    const preference =
      Math.abs(deltaX) > Math.abs(deltaZ) ? 0 : deltaZ >= 0 ? 1 : 2;
    if (
      current === null ||
      distanceSquared < current.distanceSquared - POSITION_EPSILON_M ||
      (Math.abs(distanceSquared - current.distanceSquared) <= POSITION_EPSILON_M &&
        preference < current.preference)
    ) {
      return { point, distanceSquared, preference };
    }
    return current;
  };

  // The incumbent is an exact and useful fallback for moves, while a replacement
  // is accepted here only when its new dimensions still make that point legal.
  best = nearer(best, { x: object.position[0], z: object.position[2] });
  for (let x = minimumX; x <= maximumX + CORNER_EPSILON; x += FALLBACK_GRID_M) {
    for (let z = minimumZ; z <= maximumZ + CORNER_EPSILON; z += FALLBACK_GRID_M) {
      best = nearer(best, { x, z });
    }
  }
  if (best === null) return null;

  const coarse = best.point;
  const refinementRadius = FALLBACK_GRID_M;
  for (
    let x = Math.max(minimumX, coarse.x - refinementRadius);
    x <= Math.min(maximumX, coarse.x + refinementRadius) + CORNER_EPSILON;
    x += FALLBACK_REFINEMENT_M
  ) {
    for (
      let z = Math.max(minimumZ, coarse.z - refinementRadius);
      z <= Math.min(maximumZ, coarse.z + refinementRadius) + CORNER_EPSILON;
      z += FALLBACK_REFINEMENT_M
    ) {
      best = nearer(best, { x, z });
    }
  }

  if (best === null) return null;
  return best.point;
}

/**
 * Finds the closest legal floor position to a requested point. Search edges are exact
 * separating-axis translations, so the result touches a blocker instead of hopping on
 * an arbitrary grid. A best-first queue also handles a push that meets a second piece.
 */
function resolveFloorPlacement(
  scene: Scene,
  object: SceneObject,
  requested: PointXZ,
): PlacementResolution | null {
  const clamped = clampPositionToRoom(scene, object, requested).position;
  const origin = { x: clamped[0], z: clamped[2] };
  const initialColliders = collidersAt(scene, object, origin);
  let sequence = 0;
  const queue: PlacementCandidate[] = [
    { point: origin, distanceSquared: 0, preference: -1, sequence: sequence++ },
  ];
  const seen = new Set<string>();

  for (
    let checked = 0;
    checked < PLACEMENT_SEARCH_LIMIT && queue.length > 0;
    checked += 1
  ) {
    queue.sort(
      (left, right) =>
        left.distanceSquared - right.distanceSquared ||
        left.preference - right.preference ||
        left.sequence - right.sequence,
    );
    const current = queue.shift()!;
    const key = `${Math.round(current.point.x * 1e8)}:${Math.round(current.point.z * 1e8)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const candidate = candidateSceneAt(scene, object, current.point);
    if (
      !footprintInsideRoom(
        candidate.footprint,
        candidate.scene.room,
        ROOM_INSET_M,
      )
    ) {
      continue;
    }
    const colliders = collidersAt(scene, object, current.point);
    if (colliders.length === 0) {
      return {
        position: [current.point.x, object.position[1], current.point.z],
        adjustedToFit:
          Math.abs(current.point.x - requested.x) > POSITION_EPSILON_M ||
          Math.abs(current.point.z - requested.z) > POSITION_EPSILON_M,
        collisionAdjusted: initialColliders.length > 0,
      };
    }

    for (const blocker of colliders) {
      for (const next of separatedCandidates(
        candidate.footprint,
        objectFootprint(blocker),
      )) {
        const bounded = clampPositionToRoom(scene, object, next.point).position;
        const point = { x: bounded[0], z: bounded[2] };
        const deltaX = point.x - origin.x;
        const deltaZ = point.z - origin.z;
        queue.push({
          point,
          distanceSquared: deltaX * deltaX + deltaZ * deltaZ,
          preference: next.preference,
          sequence: sequence++,
        });
      }
    }
  }

  const fallback = nearestGridPosition(scene, object, origin);
  return fallback
    ? {
        position: [fallback.x, object.position[1], fallback.z],
        adjustedToFit:
          Math.abs(fallback.x - requested.x) > POSITION_EPSILON_M ||
          Math.abs(fallback.z - requested.z) > POSITION_EPSILON_M,
        collisionAdjusted: initialColliders.length > 0,
      }
    : null;
}

/** Yaw in degrees, folded into (-180, 180] and rounded for a human to read. */
function readableDegrees(radiansOrDegrees: number, isRadians: boolean): number {
  const degrees = isRadians
    ? (radiansOrDegrees * 180) / Math.PI
    : radiansOrDegrees;
  const folded = ((((degrees + 180) % 360) + 360) % 360) - 180;
  const rounded = Math.round(folded === -180 ? 180 : folded);
  return rounded === 0 ? 0 : rounded;
}

/**
 * A turn in place: the request either carried no position or asked for the one
 * the object already occupies. The keyboard, the rotation handle and a
 * `move_object` call that only sets `rotationYDegrees` all arrive this way.
 */
function isTurnInPlace(
  object: SceneObject,
  requested: { x: number; z: number } | undefined,
): boolean {
  return (
    requested === undefined ||
    (Math.abs(requested.x - object.position[0]) <= POSITION_EPSILON_M &&
      Math.abs(requested.z - object.position[2]) <= POSITION_EPSILON_M)
  );
}

/**
 * Spec §4, turning in place: a turn is not a move, so the object keeps its floor
 * spot unless a corner of the *turned* rectangle would leave the room, and then
 * it slides by exactly that overshoot. Re-centring the turned bounding box (what
 * a full move does) walked a piece across the floor on every rotation step and
 * never walked it back. `null` means no position can hold the turned footprint:
 * the 2.4 x 1.7 m rug spans 2.9 m diagonally in a 2.72 m deep room.
 */
export function clampTurnInPlace(
  scene: Scene,
  object: SceneObject,
): { position: Vec3; adjustedToFit: boolean } | null {
  const corners = footprintCorners(objectFootprint(object));
  const xs = corners.map((corner) => corner.x);
  const zs = corners.map((corner) => corner.z);
  const minimumX = Math.min(...xs);
  const maximumX = Math.max(...xs);
  const minimumZ = Math.min(...zs);
  const maximumZ = Math.max(...zs);
  const usableWidth = scene.room.width - ROOM_INSET_M * 2;
  const usableDepth = scene.room.depth - ROOM_INSET_M * 2;
  if (
    maximumX - minimumX > usableWidth + CORNER_EPSILON ||
    maximumZ - minimumZ > usableDepth + CORNER_EPSILON
  ) {
    return null;
  }

  const halfWidth = scene.room.width / 2 - ROOM_INSET_M;
  const halfDepth = scene.room.depth / 2 - ROOM_INSET_M;
  let x = object.position[0];
  let z = object.position[2];
  if (minimumX < -halfWidth - CORNER_EPSILON) x += -halfWidth - minimumX;
  else if (maximumX > halfWidth + CORNER_EPSILON) x -= maximumX - halfWidth;
  if (minimumZ < -halfDepth - CORNER_EPSILON) z += -halfDepth - minimumZ;
  else if (maximumZ > halfDepth + CORNER_EPSILON) z -= maximumZ - halfDepth;

  return {
    position: [x, object.position[1], z],
    adjustedToFit: x !== object.position[0] || z !== object.position[2],
  };
}

function success(
  previousScene: Scene,
  nextScene: Scene,
  message: string,
  details?: { adjustedToFit?: boolean; appliedPosition?: Vec3 },
): CommandResult {
  return {
    ok: true,
    previousScene,
    scene: SceneSchema.parse(nextScene),
    message,
    ...details,
  };
}

export function applySceneCommand(
  scene: Scene,
  request: CommandRequest,
): CommandResult {
  if (scene.revision !== request.expectedRevision) {
    return failure(
      scene,
      "SCENE_REVISION_CONFLICT",
      `Expected revision ${request.expectedRevision}, current revision is ${scene.revision}.`,
      true,
    );
  }

  const nextScene = structuredClone(scene);

  if (request.command.type === "set-style") {
    nextScene.styleIntent = request.command.style.trim();
    nextScene.revision += 1;
    return success(scene, nextScene, `Style set to ${nextScene.styleIntent}.`);
  }

  const object = findObject(nextScene, request.command.objectId);
  if (!object) {
    return failure(
      scene,
      "OBJECT_NOT_FOUND",
      `Object ${request.command.objectId} was not found.`,
    );
  }

  if (request.command.type === "preserve") {
    object.locked = request.command.preserved;
    nextScene.revision += 1;
    return success(
      scene,
      nextScene,
      request.command.preserved
        ? `${object.id} is preserved.`
        : `${object.id} is editable.`,
    );
  }

  if (object.locked) {
    return failure(
      scene,
      "OBJECT_LOCKED",
      `${object.id} is locked and cannot be changed.`,
    );
  }

  if (request.command.type === "replace") {
    if (object.type !== request.command.product.category) {
      return failure(
        scene,
        "CATEGORY_MISMATCH",
        `${request.command.product.category} cannot replace ${object.type}.`,
      );
    }

    const dimensionsM = {
      width: request.command.product.dimensionsCm.width / 100,
      height: request.command.product.dimensionsCm.height / 100,
      depth: request.command.product.dimensionsCm.depth / 100,
    };
    object.source = "product";
    object.assetId = request.command.product.id;
    object.product = structuredClone(request.command.product);
    object.dimensionsM = dimensionsM;
    object.position = [
      object.position[0],
      object.type === "rug" ? 0.01 : dimensionsM.height / 2,
      object.position[2],
    ];
    object.scale = [1, 1, 1];
    object.styleTags = [...request.command.product.styleTags];
    object.addedBy = request.actor;
    const placement = resolveFloorPlacement(nextScene, object, {
      x: object.position[0],
      z: object.position[2],
    });
    if (!placement) {
      return failure(
        scene,
        "NO_VALID_PLACEMENT",
        `${request.command.product.title} does not fit in an open floor position.`,
      );
    }
    object.position = placement.position;
    nextScene.revision += 1;

    const settledScene = settleElevations(nextScene);
    const settledObject = findObject(settledScene, request.command.objectId);
    return success(
      scene,
      settledScene,
      placement.adjustedToFit
        ? `${request.command.product.title} now previews at the nearest open floor position.`
        : `${request.command.product.title} now previews in the room.`,
      {
        adjustedToFit: placement.adjustedToFit,
        appliedPosition: settledObject?.position ?? placement.position,
      },
    );
  }

  const previousRotationY = object.rotation[1];
  // Measured before the rotation lands, so "the position it already has" is the
  // one the caller could have read from the Scene.
  const requestedPosition = isTurnInPlace(object, request.command.position)
    ? undefined
    : request.command.position;

  // The rotation lands first: the footprint clamp below measures the oriented
  // rectangle, and a turn changes how far the object reaches toward each wall.
  if (request.command.rotationYDegrees !== undefined) {
    object.rotation = [
      object.rotation[0],
      (request.command.rotationYDegrees * Math.PI) / 180,
      object.rotation[2],
    ];
  }

  let position: Vec3;
  let adjustedToFit: boolean;
  let message = `${object.id} moved.`;
  if (requestedPosition === undefined) {
    const held = clampTurnInPlace(nextScene, object);
    if (!held) {
      // Nowhere on this floor holds the turned footprint, so the turn is
      // refused outright rather than half-applied against a wall.
      const requestedDegrees = readableDegrees(
        request.command.rotationYDegrees ?? previousRotationY,
        request.command.rotationYDegrees === undefined,
      );
      object.rotation = [
        object.rotation[0],
        previousRotationY,
        object.rotation[2],
      ];
      position = [...object.position];
      adjustedToFit = true;
      message = `${objectDisplayName(object)} kept at ${readableDegrees(
        previousRotationY,
        true,
      )}°: it does not fit the room at ${requestedDegrees}°.`;
    } else {
      const placement = resolveFloorPlacement(nextScene, object, {
        x: held.position[0],
        z: held.position[2],
      });
      if (!placement) {
        return failure(
          scene,
          "NO_VALID_PLACEMENT",
          `${objectDisplayName(object)} has no open floor position at this angle.`,
        );
      }
      position = placement.position;
      adjustedToFit = held.adjustedToFit || placement.adjustedToFit;
      if (placement.collisionAdjusted) {
        message = `${object.id} turned at the nearest open floor position.`;
      }
    }
  } else {
    const placement = resolveFloorPlacement(nextScene, object, requestedPosition);
    if (!placement) {
      return failure(
        scene,
        "NO_VALID_PLACEMENT",
        `${objectDisplayName(object)} has no open floor position near the requested point.`,
      );
    }
    ({ position, adjustedToFit } = placement);
    if (placement.collisionAdjusted) {
      message = `${object.id} moved to the nearest open floor position.`;
    }
  }
  object.position = position;
  object.addedBy = request.actor;
  nextScene.revision += 1;

  // Spec §5: the move settles every elevation, so a lamp dropped on a table rides up
  // onto it (and drops back to the floor when it leaves) before the result is reported.
  const settledScene = settleElevations(nextScene);
  const settledObject = findObject(settledScene, request.command.objectId);

  return success(scene, settledScene, message, {
    adjustedToFit,
    appliedPosition: settledObject?.position ?? position,
  });
}
