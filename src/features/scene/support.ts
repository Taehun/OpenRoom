import { objectFootprint } from "../placement/footprint-geometry";
import type { Footprint2D, PointXZ } from "../placement/placement-types";
import type { Scene, SceneObject } from "./scene-schema";

/**
 * Spec §5: a lamp whose base lies within a table's top stands on it. The sets are
 * typed as plain strings so a catalog that later adds `side_table` (a category the
 * stored `SceneObjectTypeSchema` does not carry yet on this branch) starts
 * supporting lamps the moment the enum grows, without another edit here.
 */
const SUPPORTED_TYPES: ReadonlySet<string> = new Set(["floor_lamp"]);
const SUPPORTER_TYPES: ReadonlySet<string> = new Set([
  "coffee_table",
  "side_table",
]);

/** A rug lies on the floor rather than standing on it. */
const RUG_ELEVATION_M = 0.01;

/** A centre exactly on a table's edge counts as on the table. */
const EDGE_EPSILON = 1e-9;

/**
 * True when `point` lies inside (or exactly on) the oriented rectangle. The point is
 * rotated into the footprint's own frame, which is the same geometry
 * `footprintCorners` materialises, without the four allocations.
 */
export function pointInsideFootprint(
  point: PointXZ,
  footprint: Footprint2D,
): boolean {
  const cosine = Math.cos(-footprint.rotationY);
  const sine = Math.sin(-footprint.rotationY);
  const deltaX = point.x - footprint.center.x;
  const deltaZ = point.z - footprint.center.z;
  const localX = deltaX * cosine - deltaZ * sine;
  const localZ = deltaX * sine + deltaZ * cosine;

  return (
    Math.abs(localX) <= footprint.halfWidth + EDGE_EPSILON &&
    Math.abs(localZ) <= footprint.halfDepth + EDGE_EPSILON
  );
}

/**
 * The object `object` stands on, or null when it stands on the floor. The first
 * matching supporter in Scene order wins, so the relation is deterministic even when
 * two tables overlap.
 */
export function supportOf(
  scene: Scene,
  object: Pick<SceneObject, "id" | "type" | "position">,
): SceneObject | null {
  if (!SUPPORTED_TYPES.has(object.type)) return null;

  const center: PointXZ = { x: object.position[0], z: object.position[2] };
  for (const candidate of scene.objects) {
    if (candidate.id === object.id) continue;
    if (!SUPPORTER_TYPES.has(candidate.type)) continue;
    if (pointInsideFootprint(center, objectFootprint(candidate))) {
      return candidate;
    }
  }

  return null;
}

/** Where the object's centre sits vertically, on the floor or on its supporter. */
export function restingY(
  object: Pick<SceneObject, "type" | "dimensionsM">,
  supporter: Pick<SceneObject, "dimensionsM"> | null,
): number {
  if (supporter) {
    return supporter.dimensionsM.height + object.dimensionsM.height / 2;
  }
  return object.type === "rug" ? RUG_ELEVATION_M : object.dimensionsM.height / 2;
}

/** Every object's supporter, keyed by object id; unsupported objects are absent. */
export function supportRelations(scene: Scene): ReadonlyMap<string, string> {
  const relations = new Map<string, string>();
  for (const object of scene.objects) {
    const supporter = supportOf(scene, object);
    if (supporter) relations.set(object.id, supporter.id);
  }
  return relations;
}

/**
 * Recomputes every object's `position[1]` from the support relation. Returns the same
 * Scene reference when nothing moved, so callers can skip a clone.
 */
export function settleElevations<T extends Scene>(scene: T): T {
  let changed = false;
  const objects = scene.objects.map((object) => {
    const y = restingY(object, supportOf(scene, object));
    if (y === object.position[1]) return object;
    changed = true;
    return {
      ...object,
      position: [object.position[0], y, object.position[2]] as SceneObject["position"],
    };
  });

  return changed ? { ...scene, objects } : scene;
}
