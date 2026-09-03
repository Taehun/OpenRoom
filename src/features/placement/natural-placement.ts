import {
  entryZonePoints,
  hasCirculationPath,
  occupiesEntryZone,
} from "./circulation";
import {
  footprintBounds,
  footprintCorners,
  footprintExtent,
  footprintInsideRoom,
  footprintProjection,
  footprintsOverlap,
  objectFootprint,
  openingClearanceZones,
} from "./footprint-geometry";
import { PLACEMENT_LIMITS, PLACEMENT_SCORE_WEIGHTS } from "./placement-profile";
import type {
  Footprint2D,
  NaturalPlacementResult,
  PlacementDiagnostics,
  PlacementOptions,
  PointXZ,
  ProposedPlacement,
  RotationOption,
} from "./placement-types";
import {
  SceneSchema,
  type Scene,
  type SceneObject,
  type SceneObjectType,
} from "../scene/scene-schema";

export interface EvaluatedLayout {
  valid: boolean;
  score: number;
  placements: readonly ProposedPlacement[];
}

export interface LayoutSearch {
  best: EvaluatedLayout | null;
  evaluatedLayouts: number;
  exhausted: boolean;
}

/**
 * A partial layout plus everything needed to extend it without re-deriving the whole
 * room: the layout objects, the settled obstacles, the seating hull those obstacles
 * form, the score terms, and the running totals the averaged terms are built from.
 */
/**
 * A partial layout plus the running totals its averaged score terms are built from. The
 * derived views - the layout objects, the settled obstacles and their footprints, and the
 * seating hull - are memoized on first use: most partials are ranked out of the beam
 * before anything asks for them.
 */
interface SearchState {
  candidateIndex: number;
  objectIds: readonly string[];
  score: number;
  terms: TermScores;
  movementTotal: number;
  accessoryTotal: number;
  viewFidelityTotal: number;
  parent: SearchState | null;
  placedIndex: number;
  placedTemplate: SceneObject | null;
  placement: ProposedPlacement | null;
  placedFootprint: Footprint2D | null;
  placedObject: SceneObject | null;
  placements: readonly ProposedPlacement[] | null;
  objects: readonly SceneObject[] | null;
  settled: readonly SceneObject[] | null;
  settledFootprints: readonly Footprint2D[] | null;
  hull: readonly PointXZ[] | null;
}

function placedObjectOf(state: SearchState): SceneObject {
  if (state.placedObject === null) {
    state.placedObject = withPlacement(state.placedTemplate!, state.placement!);
  }
  return state.placedObject;
}

function placementsOf(state: SearchState): readonly ProposedPlacement[] {
  if (state.placements === null) {
    state.placements = [...placementsOf(state.parent!), state.placement!];
  }
  return state.placements;
}

function layoutOf(state: SearchState): readonly SceneObject[] {
  if (state.objects === null) {
    const objects = layoutOf(state.parent!).slice();
    objects[state.placedIndex] = placedObjectOf(state);
    state.objects = objects;
  }
  return state.objects;
}

function settledOf(state: SearchState): readonly SceneObject[] {
  if (state.settled === null) {
    state.settled = [...settledOf(state.parent!), placedObjectOf(state)];
  }
  return state.settled;
}

function settledFootprintsOf(state: SearchState): readonly Footprint2D[] {
  if (state.settledFootprints === null) {
    state.settledFootprints = [
      ...settledFootprintsOf(state.parent!),
      state.placedFootprint!,
    ];
  }
  return state.settledFootprints;
}

export interface CandidateSet {
  candidates: readonly ProposedPlacement[];
  truncated: boolean;
}

/**
 * Candidate lanes an accessory's perimeter is split into. Ordered clockwise from the
 * back-left corner; the search draws from them round-robin, so the candidate cap is
 * shared out over the whole perimeter rather than one arc of it.
 */
const PERIMETER_SIDES = [
  "back-left",
  "back",
  "back-right",
  "right",
  "front-right",
  "front",
  "front-left",
  "left",
] as const;

type PerimeterSide = (typeof PERIMETER_SIDES)[number];

interface PerimeterPoint extends PointXZ {
  side: number;
}

const PERIMETER_SIDE_INDEX: Readonly<Record<PerimeterSide, number>> =
  Object.fromEntries(
    PERIMETER_SIDES.map((side, index) => [side, index]),
  ) as Record<PerimeterSide, number>;

const CATEGORY_ORDER: readonly SceneObjectType[] = [
  "sofa",
  "rug",
  "coffee_table",
  "chair",
  "floor_lamp",
  // The side table is staged against a settled seat, so it follows the seating group
  // and the lamp; the bookshelf only needs the walls, so it comes last.
  "side_table",
  "plant",
  "bookshelf",
];

const MILLIMETRES_PER_METRE = 1000;
const MAX_FIXED_POINT_PASSES = 8;

function millimetres(metres: number): number {
  return Math.round(metres * MILLIMETRES_PER_METRE);
}

function quantize(value: number, gridM: number): number {
  const quantized = Math.round(value / gridM) * gridM;
  if (Object.is(quantized, -0)) return 0;
  // Scaling to whole micrometres lands on the same double as the six-decimal round trip
  // for every grid multiple this can produce, without formatting and reparsing one.
  const micrometres = Math.round(quantized * 1e6);
  return Number.isSafeInteger(micrometres)
    ? micrometres / 1e6
    : Number(quantized.toFixed(6));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function compareText(first: string, second: string): number {
  if (first < second) return -1;
  if (first > second) return 1;
  return 0;
}

/**
 * Lexicographic order of two partials' candidate paths, read down the shared parent
 * chain. Both are always at the same depth, so this is the array comparison without the
 * array.
 */
function compareCandidatePaths(first: SearchState, second: SearchState): number {
  if (first === second) return 0;
  const parentOrder = compareCandidatePaths(first.parent!, second.parent!);
  return parentOrder !== 0 ? parentOrder : first.candidateIndex - second.candidateIndex;
}

function compareSearchStates(first: SearchState, second: SearchState): number {
  if (first.score !== second.score) return second.score - first.score;
  const candidateOrder = compareCandidatePaths(first, second);
  if (candidateOrder !== 0) return candidateOrder;
  return compareText(first.objectIds.join("\u0000"), second.objectIds.join("\u0000"));
}

function placementFor(object: SceneObject): ProposedPlacement {
  return {
    objectId: object.id,
    position: [...object.position],
    rotationY: object.rotation[1],
  };
}

/** The footprint `objectFootprint(withPlacement(object, placement))` would produce. */
function placementFootprint(
  object: SceneObject,
  placement: ProposedPlacement,
): Footprint2D {
  return {
    objectId: object.id,
    center: { x: placement.position[0], z: placement.position[2] },
    halfWidth: object.dimensionsM.width / 2,
    halfDepth: object.dimensionsM.depth / 2,
    rotationY: placement.rotationY,
  };
}

function withPlacement(object: SceneObject, placement: ProposedPlacement): SceneObject {
  return {
    ...object,
    position: [...placement.position],
    rotation: [object.rotation[0], placement.rotationY, object.rotation[2]],
  };
}

function layoutObjects(
  scene: Scene,
  placements: readonly ProposedPlacement[],
): readonly SceneObject[] {
  const byId = new Map(placements.map((placement) => [placement.objectId, placement]));
  return scene.objects.map((object) => {
    const placement = byId.get(object.id);
    return placement ? withPlacement(object, placement) : object;
  });
}

function firstObject(
  objects: readonly SceneObject[],
  type: SceneObjectType,
): SceneObject | undefined {
  let first: SceneObject | undefined;
  for (const object of objects) {
    if (object.type !== type) continue;
    if (first === undefined || compareText(object.id, first.id) < 0) first = object;
  }
  return first;
}

function hasUnlockedUnknown(scene: Scene): boolean {
  return scene.objects.some(({ locked, type }) => !locked && type === "unknown");
}

function hasDuplicateObjectIds(scene: Scene): boolean {
  return new Set(scene.objects.map(({ id }) => id)).size !== scene.objects.length;
}

function currentPlacements(scene: Scene): readonly ProposedPlacement[] {
  return scene.objects
    .filter(({ locked, type }) => !locked && type !== "unknown")
    .sort(compareObjects)
    .map(placementFor);
}

function compareObjects(first: SceneObject, second: SceneObject): number {
  const categoryDifference =
    CATEGORY_ORDER.indexOf(first.type) - CATEGORY_ORDER.indexOf(second.type);
  return categoryDifference || compareText(first.id, second.id);
}

function footprintIsInsideOpeningClearance(
  scene: Scene,
  footprint: Footprint2D,
): boolean {
  return openingClearanceZones(scene).some((zone) => footprintsOverlap(footprint, zone));
}

function objectIsInsideOpeningClearance(scene: Scene, object: SceneObject): boolean {
  return footprintIsInsideOpeningClearance(scene, objectFootprint(object));
}

function axisProjection(point: PointXZ, axis: PointXZ): number {
  return point.x * axis.x + point.z * axis.z;
}

function localAxes(rotationY: number): { lateral: PointXZ; forward: PointXZ } {
  return {
    lateral: { x: Math.cos(rotationY), z: Math.sin(rotationY) },
    forward: { x: -Math.sin(rotationY), z: Math.cos(rotationY) },
  };
}

/** Two option rotations closer than this stand for the same orientation (spec 8.4). */
const ROTATION_OPTION_EPSILON = 1e-9;

/** `rotationYOf(facingOf(r))`: the angle folded into (-pi, pi], so 2pi meets 0. */
function foldAngle(rotationY: number): number {
  return Math.atan2(Math.sin(rotationY), Math.cos(rotationY));
}

/**
 * The orientations an object may be proposed in. An object with no table entry keeps the
 * rotation it came with at fidelity 1, which is what every caller that passes no options
 * gets for every object (spec 8.1).
 */
function optionsFor(
  object: SceneObject,
  options: PlacementOptions | undefined,
): readonly RotationOption[] {
  const table = options?.rotationOptions?.[object.id];
  return table === undefined || table.length === 0
    ? [{ rotationY: object.rotation[1], fidelity: 1 }]
    : table;
}

/**
 * The option an incumbent rotation stands for. Options are folded into (-pi, pi] while
 * the stage accumulates rotations without bounds, so an incumbent is matched by angle
 * and adopts the option's own value: every candidate this module emits is then exactly
 * an option, which is what the command adapter re-validates (spec 8.4).
 */
function nearestOption(
  rotationY: number,
  choices: readonly RotationOption[],
): RotationOption {
  let best = choices[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const option of choices) {
    const distance = Math.abs(foldAngle(option.rotationY - rotationY));
    if (distance < bestDistance - ROTATION_OPTION_EPSILON) {
      bestDistance = distance;
      best = option;
    }
  }
  return best;
}

/** The object's current placement, snapped onto the option its rotation stands for. */
function incumbentPlacement(
  object: SceneObject,
  choices: readonly RotationOption[],
): ProposedPlacement {
  const placement = placementFor(object);
  const { rotationY } = nearestOption(placement.rotationY, choices);
  return placement.rotationY === rotationY ? placement : { ...placement, rotationY };
}

function edgeGapAlongAxis(
  first: SceneObject,
  second: SceneObject,
  axis: PointXZ,
): number {
  const firstSpan = footprintProjection(objectFootprint(first), axis.x, axis.z);
  const secondSpan = footprintProjection(objectFootprint(second), axis.x, axis.z);
  const firstMinimum = firstSpan.minimum;
  const firstMaximum = firstSpan.maximum;
  const secondMinimum = secondSpan.minimum;
  const secondMaximum = secondSpan.maximum;

  if (secondMinimum >= firstMaximum) return secondMinimum - firstMaximum;
  if (firstMinimum >= secondMaximum) return firstMinimum - secondMaximum;
  return -Math.min(firstMaximum, secondMaximum) + Math.max(firstMinimum, secondMinimum);
}

function footprintRadiusAlongAxis(object: SceneObject, axis: PointXZ): number {
  const footprint = objectFootprint(object);
  const centerProjection = axisProjection(footprint.center, axis);
  const span = footprintProjection(footprint, axis.x, axis.z);
  return Math.max(
    Math.abs(span.minimum - centerProjection),
    Math.abs(span.maximum - centerProjection),
  );
}

function tableEdgeGap(sofa: SceneObject, table: SceneObject): number {
  return edgeGapAlongAxis(sofa, table, localAxes(sofa.rotation[1]).forward);
}

function pointInsideFootprint(
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

function cross(origin: PointXZ, first: PointXZ, second: PointXZ): number {
  return (
    (first.x - origin.x) * (second.z - origin.z) -
    (first.z - origin.z) * (second.x - origin.x)
  );
}

function convexHull(points: readonly PointXZ[]): readonly PointXZ[] {
  const sorted = [...points].sort((first, second) =>
    first.x - second.x || first.z - second.z,
  );
  if (sorted.length <= 2) return sorted;
  const lower: PointXZ[] = [];
  for (const point of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: PointXZ[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index]!;
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function pointInsideConvexHull(point: PointXZ, hull: readonly PointXZ[]): boolean {
  if (hull.length < 3) return false;
  let direction = 0;
  for (let index = 0; index < hull.length; index += 1) {
    const edgeDirection = cross(hull[index]!, hull[(index + 1) % hull.length]!, point);
    if (Math.abs(edgeDirection) < 1e-9) continue;
    const sign = Math.sign(edgeDirection);
    if (direction !== 0 && sign !== direction) return false;
    direction = sign;
  }
  return true;
}

function primarySeatingHull(objects: readonly SceneObject[]): readonly PointXZ[] {
  const primaryTypes: readonly SceneObjectType[] = [
    "sofa",
    "coffee_table",
    "chair",
    "rug",
  ];
  const primaryObjects = primaryTypes.flatMap((type) => {
    const object = firstObject(objects, type);
    return object ? [object] : [];
  });
  return convexHull(
    primaryObjects.flatMap((object) => footprintCorners(objectFootprint(object))),
  );
}

function accessoryInsideSeatingHull(objects: readonly SceneObject[]): boolean {
  const hull = primarySeatingHull(objects);
  return objects
    .filter(avoidsSeatingHull)
    .some((object) =>
      pointInsideConvexHull(
        { x: object.position[0], z: object.position[2] },
        hull,
      ),
    );
}

function respectsHardConstraints(
  scene: Scene,
  objects: readonly SceneObject[],
  circulates: boolean,
): boolean {
  for (const object of objects) {
    if (
      !object.locked &&
      (!footprintInsideRoom(objectFootprint(object), scene.room, PLACEMENT_LIMITS.roomInsetM) ||
        objectIsInsideOpeningClearance(scene, object))
    ) {
      return false;
    }
  }

  const nonRugs = objects.filter(({ type }) => type !== "rug");
  for (let first = 0; first < nonRugs.length; first += 1) {
    for (let second = first + 1; second < nonRugs.length; second += 1) {
      if (
        footprintsOverlap(
          objectFootprint(nonRugs[first]!),
          objectFootprint(nonRugs[second]!),
        )
      ) {
        return false;
      }
    }
  }

  // The sofa-to-table gap and the rug's containment of the table are not on the closed
  // 6.3 list: 6.4 terms 3 and 4 score them softly, so a room that only misses them stays
  // valid, keeps a `currentScore`, and is held to the 6.5 improvement threshold.
  return !accessoryInsideSeatingHull(objects) && circulates;
}

function proximityScore(valueMm: number, targetMm: number, rangeMm: number): number {
  if (rangeMm <= 0) return valueMm === targetMm ? 1000 : 0;
  return clamp(
    1000 - Math.round((Math.abs(valueMm - targetMm) * 1000) / rangeMm),
    0,
    1000,
  );
}

function sofaWallAndSideScore(scene: Scene, objects: readonly SceneObject[]): number {
  const sofa = firstObject(objects, "sofa");
  const original = firstObject(scene.objects, "sofa");
  if (!sofa || !original) return 1000;

  const { minimumX, maximumX, minimumZ, maximumZ } = footprintExtent(
    objectFootprint(sofa),
  );
  const wallGap = Math.min(
    Math.abs(minimumX + scene.room.width / 2),
    Math.abs(scene.room.width / 2 - maximumX),
    Math.abs(minimumZ + scene.room.depth / 2),
    Math.abs(scene.room.depth / 2 - maximumZ),
  );
  const wall = proximityScore(millimetres(wallGap), millimetres(PLACEMENT_LIMITS.roomInsetM), 900);
  const sameSide =
    Math.sign(sofa.position[0]) === Math.sign(original.position[0]) ? 1000 : 0;
  const hasDoor = scene.openings.some(({ kind }) => kind === "door");
  const preservesFallbackIngress = hasDoor || sofa.position[2] <= 0 ? 1000 : 0;
  return Math.round((wall * 4 + sameSide + preservesFallbackIngress * 5) / 10);
}

function tableRelationScore(objects: readonly SceneObject[]): number {
  const sofa = firstObject(objects, "sofa");
  const table = firstObject(objects, "coffee_table");
  if (!sofa || !table) return 1000;
  const { lateral } = localAxes(sofa.rotation[1]);
  const gap = proximityScore(millimetres(tableEdgeGap(sofa, table)), 450, 450);
  const alignment = proximityScore(
    millimetres(
      Math.abs(
        axisProjection(
          {
            x: table.position[0] - sofa.position[0],
            z: table.position[2] - sofa.position[2],
          },
          lateral,
        ),
      ),
    ),
    0,
    1000,
  );
  return Math.round((gap * 8 + alignment * 2) / 10);
}

function rugRelationScore(objects: readonly SceneObject[]): number {
  const sofa = firstObject(objects, "sofa");
  const table = firstObject(objects, "coffee_table");
  const rug = firstObject(objects, "rug");
  if (!rug) return 1000;
  if (!table) return sofa ? proximityScore(millimetres(Math.abs(rug.position[0] - sofa.position[0])), 0, 1500) : 1000;

  const containsTable = pointInsideFootprint(
    { x: table.position[0], z: table.position[2] },
    rug,
  )
    ? 1000
    : 0;
  const centered = Math.round(
    (proximityScore(millimetres(Math.abs(rug.position[0] - table.position[0])), 0, 1200) +
      proximityScore(millimetres(Math.abs(rug.position[2] - table.position[2])), 0, 850)) /
      2,
  );
  return Math.round((containsTable * 7 + centered * 3) / 10);
}

/**
 * Spec 8.3: how the chair reads in the conversation group - whether it is turned toward
 * the table (5), sits a conversation gap from it (3), and is off the sofa's centre axis
 * or beyond the table rather than planted in the middle of the shot (2).
 */
function chairRelationScore(objects: readonly SceneObject[]): number {
  const sofa = firstObject(objects, "sofa");
  const table = firstObject(objects, "coffee_table");
  const chair = firstObject(objects, "chair");
  if (!sofa || !table || !chair) return 1000;

  const toTable: PointXZ = {
    x: table.position[0] - chair.position[0],
    z: table.position[2] - chair.position[2],
  };
  const separation = Math.hypot(toTable.x, toTable.z);
  const { forward, lateral } = localAxes(sofa.rotation[1]);
  if (separation < 1e-6) {
    // Concentric with the table: no direction to face and no gap to close.
    return Math.round((1000 * 5 + 0 * 3 + 0 * 2) / 10);
  }

  const direction: PointXZ = {
    x: toTable.x / separation,
    z: toTable.z / separation,
  };
  const chairForward = localAxes(chair.rotation[1]).forward;
  const facing = clamp(
    Math.round(axisProjection(chairForward, direction) * 1000),
    0,
    1000,
  );
  const gap = proximityScore(
    millimetres(edgeGapAlongAxis(chair, table, direction)),
    450,
    600,
  );

  const tableDirection =
    Math.sign(
      axisProjection(
        {
          x: table.position[0] - sofa.position[0],
          z: table.position[2] - sofa.position[2],
        },
        forward,
      ),
    ) || 1;
  const beyondTable =
    Math.sign(axisProjection({ x: -toTable.x, z: -toTable.z }, forward)) ===
    tableDirection;
  const lateralOffsetMm = millimetres(
    Math.abs(
      axisProjection(
        {
          x: chair.position[0] - sofa.position[0],
          z: chair.position[2] - sofa.position[2],
        },
        lateral,
      ),
    ),
  );
  const spread =
    beyondTable || lateralOffsetMm >= millimetres(sofa.dimensionsM.width * 0.3)
      ? 1000
      : 0;

  return Math.round((facing * 5 + gap * 3 + spread * 2) / 10);
}

/**
 * Spec 8.3: how truthfully a registered view can show the rotation this object was given.
 * An object with no options entry is unconstrained and counts as fully truthful.
 *
 * The rotation is matched as an angle, not as a number: the options are folded into
 * (-pi, pi] while a layout carries whatever the stage accumulated, so a sofa at 2pi is
 * facing the way the option at 0 describes and is scored as truthfully as one at 0.
 * Options are a quarter turn apart at the closest, so no fold can confuse two of them.
 */
function fidelityContribution(
  objectId: string,
  rotationY: number,
  options: PlacementOptions | undefined,
): number {
  const table = options?.rotationOptions?.[objectId];
  if (table === undefined || table.length === 0) return 1000;
  for (const option of table) {
    if (
      Math.abs(foldAngle(option.rotationY - rotationY)) <= ROTATION_OPTION_EPSILON
    ) {
      return clamp(Math.round(option.fidelity * 1000), 0, 1000);
    }
  }
  return 0;
}

/** Which objects the averaged view-fidelity and composition terms are taken over. */
function isComposed(object: SceneObject): boolean {
  return isMovable(object) && object.type !== "rug";
}

function viewFidelityScore(
  objects: readonly SceneObject[],
  options: PlacementOptions | undefined,
): number {
  let total = 0;
  let count = 0;
  for (const object of objects) {
    if (!isComposed(object)) continue;
    total += fidelityContribution(object.id, object.rotation[1], options);
    count += 1;
  }
  return count === 0 ? 1000 : Math.round(total / count);
}

/**
 * Spec 8.3: how far back in the shot the object stands. Full marks up to a metre from
 * the camera wall, falling to nothing as it reaches the inset itself.
 */
function foregroundTerm(scene: Scene, footprint: Footprint2D): number {
  const depthMm = millimetres(footprintExtent(footprint).maximumZ);
  const fullMm = millimetres(scene.room.depth / 2 - 1);
  const zeroMm = millimetres(scene.room.depth / 2 - 0.1);
  if (depthMm <= fullMm) return 1000;
  if (depthMm >= zeroMm || zeroMm <= fullMm) return 0;
  return clamp(
    Math.round(((zeroMm - depthMm) * 1000) / (zeroMm - fullMm)),
    0,
    1000,
  );
}

/** Spec 8.3: a floor lamp reads as staged when it stands just beyond a sofa end. */
function lampAdjacencyTerm(
  objects: readonly SceneObject[],
  lamp: SceneObject,
): number {
  const sofa = firstObject(objects, "sofa");
  if (!sofa) return 0;
  const { forward, lateral } = localAxes(sofa.rotation[1]);
  // Outside the sofa's own depth band the lamp is somewhere else in the room, however
  // close its lateral gap happens to read.
  if (edgeGapAlongAxis(sofa, lamp, forward) > 0) return 0;
  const lateralGap = edgeGapAlongAxis(sofa, lamp, lateral);
  return proximityScore(millimetres(Math.max(lateralGap, 0)), 150, 500);
}

/**
 * Spec catalog-expansion 4: a side table reads as staged when it stands just beside a
 * seat's side, inside that seat's own depth band. Any edge gap the spec's band allows
 * scores full marks; outside it the score falls away over the lamp's half-metre range.
 */
const SIDE_TABLE_GAP_MINIMUM_MM = 50;
const SIDE_TABLE_GAP_MAXIMUM_MM = 250;

function seatAdjacencyTerm(seat: SceneObject, table: SceneObject): number {
  const { forward, lateral } = localAxes(seat.rotation[1]);
  // Outside the seat's own depth band the table is somewhere else in the room, however
  // close its lateral gap happens to read.
  if (edgeGapAlongAxis(seat, table, forward) > 0) return 0;
  const gapMm = millimetres(Math.max(edgeGapAlongAxis(seat, table, lateral), 0));
  return proximityScore(
    gapMm,
    clamp(gapMm, SIDE_TABLE_GAP_MINIMUM_MM, SIDE_TABLE_GAP_MAXIMUM_MM),
    500,
  );
}

/** The best of the sofa-end and chair-side readings; 0 when the room has neither seat. */
function sideTableAdjacencyTerm(
  objects: readonly SceneObject[],
  table: SceneObject,
): number {
  let best = 0;
  for (const type of ["sofa", "chair"] as const) {
    const seat = firstObject(objects, type);
    if (seat) best = Math.max(best, seatAdjacencyTerm(seat, table));
  }
  return best;
}

/** Spec 8.3: a plant reads as staged when it fills a corner rather than a wall. */
function plantCornerTerm(scene: Scene, footprint: Footprint2D): number {
  const { minimumX, maximumX, minimumZ, maximumZ } = footprintExtent(footprint);
  const gapX = Math.min(
    Math.abs(minimumX + scene.room.width / 2),
    Math.abs(scene.room.width / 2 - maximumX),
  );
  const gapZ = Math.min(
    Math.abs(minimumZ + scene.room.depth / 2),
    Math.abs(scene.room.depth / 2 - maximumZ),
  );
  const corners =
    (millimetres(gapX) <= 300 ? 1 : 0) + (millimetres(gapZ) <= 300 ? 1 : 0);
  return corners === 2 ? 1000 : corners === 1 ? 500 : 0;
}

function compositionContribution(
  scene: Scene,
  objects: readonly SceneObject[],
  object: SceneObject,
): number {
  const footprint = objectFootprint(object);
  if (object.type === "floor_lamp") {
    // With no sofa to stand beside, a lamp is judged like any other object: it
    // should at least stay out of the foreground.
    return firstObject(objects, "sofa")
      ? lampAdjacencyTerm(objects, object)
      : foregroundTerm(scene, footprint);
  }
  const foreground = foregroundTerm(scene, footprint);
  if (object.type === "side_table") {
    // With no seat to stand beside, a side table is judged like any other object: it
    // should at least stay out of the foreground.
    return firstObject(objects, "sofa") || firstObject(objects, "chair")
      ? sideTableAdjacencyTerm(objects, object)
      : foreground;
  }
  if (object.type === "bookshelf") {
    // Spec catalog-expansion 4: a bookshelf reads as staged when it is back against a
    // wall rather than adrift, and still out of the foreground.
    return Math.round((foreground + accessoryContribution(scene, footprint)) / 2);
  }
  return object.type === "plant"
    ? Math.round((foreground + plantCornerTerm(scene, footprint)) / 2)
    : foreground;
}

/** Spec 8.3: how the arrangement reads as a staged photograph. */
function compositionScore(
  scene: Scene,
  objects: readonly SceneObject[],
): number {
  let total = 0;
  let count = 0;
  for (const object of objects) {
    if (!isComposed(object)) continue;
    total += compositionContribution(scene, objects, object);
    count += 1;
  }
  return count === 0 ? 1000 : Math.round(total / count);
}

function isAccessory({ type }: Pick<SceneObject, "type">): boolean {
  return type === "floor_lamp" || type === "plant" || type === "side_table";
}

/**
 * Spec catalog-expansion 4: the objects the conversation group must not swallow. The
 * accessories stage the room around the seating, and the bookshelf backs onto a wall,
 * so none of them may end up standing inside the seating hull.
 */
function avoidsSeatingHull(object: Pick<SceneObject, "type">): boolean {
  return isAccessory(object) || object.type === "bookshelf";
}

function isMovable({ locked, type }: SceneObject): boolean {
  return !locked && type !== "unknown";
}

/** One accessory's share of the perimeter-hugging term. */
function accessoryContribution(scene: Scene, footprint: Footprint2D): number {
  const { minimumX, maximumX, minimumZ, maximumZ } = footprintExtent(footprint);
  const perimeterGap = Math.min(
    Math.abs(minimumX + scene.room.width / 2),
    Math.abs(scene.room.width / 2 - maximumX),
    Math.abs(minimumZ + scene.room.depth / 2),
    Math.abs(scene.room.depth / 2 - maximumZ),
  );
  return proximityScore(
    millimetres(perimeterGap),
    millimetres(PLACEMENT_LIMITS.roomInsetM),
    800,
  );
}

/** One movable object's share of the stay-put term. */
function movementContribution(
  original: SceneObject,
  placement: ProposedPlacement,
): number {
  const distanceMm = Math.hypot(
    millimetres(placement.position[0] - original.position[0]),
    millimetres(placement.position[2] - original.position[2]),
  );
  const rotationDelta = Math.abs(placement.rotationY - original.rotation[1]);
  const normalizedRotation = Math.min(rotationDelta, Math.PI * 2 - rotationDelta);
  const movementMm = Math.round(distanceMm + normalizedRotation * 250);
  return proximityScore(movementMm, 0, 1000);
}

function accessoriesScore(scene: Scene, objects: readonly SceneObject[]): number {
  const accessories = objects.filter(isAccessory);
  if (accessories.length === 0) return 1000;
  let total = 0;
  for (const object of accessories) {
    total += accessoryContribution(scene, objectFootprint(object));
  }
  return Math.round(total / accessories.length);
}

function movementScore(
  scene: Scene,
  objects: readonly SceneObject[],
): number {
  const movable = objects.filter(isMovable);
  if (movable.length === 0) return 1000;
  let total = 0;
  for (const object of movable) {
    total += movementContribution(
      scene.objects.find(({ id }) => id === object.id)!,
      placementFor(object),
    );
  }
  return Math.round(total / movable.length);
}

/**
 * The six non-circulation score terms, packed in a fixed order so a partial can copy and
 * patch them without rebuilding the layout's whole score.
 */
type TermScores = Int32Array;

const TERM_SOFA_WALL = 0;
const TERM_TABLE = 1;
const TERM_RUG = 2;
const TERM_CHAIR = 3;
const TERM_ACCESSORIES = 4;
const TERM_MOVEMENT = 5;
const TERM_VIEW_FIDELITY = 6;
const TERM_COMPOSITION = 7;
const TERM_COUNT = 8;

const TERM_WEIGHTS: readonly number[] = [
  PLACEMENT_SCORE_WEIGHTS.sofaWallAndSide,
  PLACEMENT_SCORE_WEIGHTS.tableRelation,
  PLACEMENT_SCORE_WEIGHTS.rugRelation,
  PLACEMENT_SCORE_WEIGHTS.chairRelation,
  PLACEMENT_SCORE_WEIGHTS.accessories,
  PLACEMENT_SCORE_WEIGHTS.movement,
  PLACEMENT_SCORE_WEIGHTS.viewFidelity,
  PLACEMENT_SCORE_WEIGHTS.composition,
];

const TERM_SCORERS: readonly ((
  scene: Scene,
  objects: readonly SceneObject[],
  options: PlacementOptions | undefined,
) => number)[] = [
  sofaWallAndSideScore,
  (_scene, objects) => tableRelationScore(objects),
  (_scene, objects) => rugRelationScore(objects),
  (_scene, objects) => chairRelationScore(objects),
  accessoriesScore,
  movementScore,
  (_scene, objects, options) => viewFidelityScore(objects, options),
  (scene, objects) => compositionScore(scene, objects),
];

function layoutTerms(
  scene: Scene,
  objects: readonly SceneObject[],
  options: PlacementOptions | undefined,
): TermScores {
  const terms = new Int32Array(TERM_COUNT);
  for (let term = 0; term < TERM_COUNT; term += 1) {
    terms[term] = TERM_SCORERS[term]!(scene, objects, options);
  }
  return terms;
}

function weightedScore(terms: TermScores, circulation: number): number {
  let score = Math.round(
    (circulation * PLACEMENT_SCORE_WEIGHTS.circulation) / 1000,
  );
  for (let term = 0; term < TERM_COUNT; term += 1) {
    score += Math.round((terms[term]! * TERM_WEIGHTS[term]!) / 1000);
  }
  return score;
}

function aggregateScore(
  scene: Scene,
  objects: readonly SceneObject[],
  circulation: number,
  options: PlacementOptions | undefined,
): number {
  return weightedScore(layoutTerms(scene, objects, options), circulation);
}

/**
 * Which relational terms a newly placed object can move. The averaged accessories and
 * movement terms are kept as running totals instead, so they are absent here.
 */
const TERM_DEPENDENCIES: Readonly<Record<SceneObjectType, readonly number[]>> = {
  sofa: [TERM_SOFA_WALL, TERM_TABLE, TERM_RUG, TERM_CHAIR, TERM_COMPOSITION],
  rug: [TERM_RUG],
  coffee_table: [TERM_TABLE, TERM_RUG, TERM_CHAIR, TERM_COMPOSITION],
  chair: [TERM_CHAIR, TERM_COMPOSITION],
  floor_lamp: [TERM_COMPOSITION],
  plant: [TERM_COMPOSITION],
  side_table: [TERM_COMPOSITION],
  bookshelf: [TERM_COMPOSITION],
  unknown: [],
};

function evaluateCompleteLayout(
  scene: Scene,
  placements: readonly ProposedPlacement[],
  options: PlacementOptions | undefined,
): EvaluatedLayout {
  const objects = layoutObjects(scene, placements);
  const circulates = hasCirculationPath(
    scene,
    objects.map(objectFootprint),
    objects.filter(({ type }) => type === "rug"),
  );
  const valid = respectsHardConstraints(scene, objects, circulates);
  return {
    valid,
    score: aggregateScore(scene, objects, circulates ? 1000 : 0, options),
    placements: placements.map((placement) => ({
      ...placement,
      position: [...placement.position],
    })),
  };
}

/**
 * A completed beam state has already satisfied every partial constraint for every object
 * it settled - room bounds, clearance, footprint pairs and the seating hull - and its
 * score terms were kept equal to the full layout's throughout. Circulation is the only
 * 6.3 condition a partial cannot decide, so the state is finished rather than re-derived
 * from scratch.
 */
function evaluateSettledState(scene: Scene, state: SearchState): EvaluatedLayout {
  const objects = layoutOf(state);
  const circulates = hasCirculationPath(
    scene,
    objects.map(objectFootprint),
    objects.filter(({ type }) => type === "rug"),
  );
  return {
    valid: circulates,
    score: weightedScore(state.terms, circulates ? 1000 : 0),
    placements: placementsOf(state).map((placement) => ({
      ...placement,
      position: [...placement.position],
    })),
  };
}

function candidate(
  object: SceneObject,
  x: number,
  z: number,
  rotationY = object.rotation[1],
): ProposedPlacement {
  return {
    objectId: object.id,
    position: [x, object.position[1], z],
    rotationY,
  };
}

function usableCenterRange(
  scene: Scene,
  object: SceneObject,
  rotationY: number,
): { minimumX: number; maximumX: number; minimumZ: number; maximumZ: number } {
  const rotated = withPlacement(object, candidate(object, 0, 0, rotationY));
  const corners = footprintCorners(objectFootprint(rotated));
  const halfX = Math.max(...corners.map(({ x }) => Math.abs(x)));
  const halfZ = Math.max(...corners.map(({ z }) => Math.abs(z)));
  return {
    minimumX: -scene.room.width / 2 + PLACEMENT_LIMITS.roomInsetM + halfX,
    maximumX: scene.room.width / 2 - PLACEMENT_LIMITS.roomInsetM - halfX,
    minimumZ: -scene.room.depth / 2 + PLACEMENT_LIMITS.roomInsetM + halfZ,
    maximumZ: scene.room.depth / 2 - PLACEMENT_LIMITS.roomInsetM - halfZ,
  };
}

function inwardGridRange(
  minimum: number,
  maximum: number,
  gridM: number,
): readonly [number, number] {
  return [
    Number((Math.ceil((minimum - 1e-9) / gridM) * gridM).toFixed(6)),
    Number((Math.floor((maximum + 1e-9) / gridM) * gridM).toFixed(6)),
  ];
}

/**
 * The grid positions a wall sweep offers on one axis, nearest the sofa's current
 * placement first so the candidate cap keeps the placements closest to it.
 */
function gridSweep(
  minimum: number,
  maximum: number,
  near: number,
  keep: (value: number) => boolean,
): readonly number[] {
  const values: number[] = [];
  for (let value = minimum; value <= maximum + 1e-9; value += PLACEMENT_LIMITS.gridM) {
    const quantized = quantize(value, PLACEMENT_LIMITS.gridM);
    if (keep(quantized)) values.push(quantized);
  }
  return values.sort(
    (first, second) =>
      Math.abs(first - near) - Math.abs(second - near) || first - second,
  );
}

/**
 * A wall of the room, named by the axis it bounds and the direction the room lies in from
 * it: the minimum-z wall has an inward direction of +1 along z.
 */
interface RoomWall {
  readonly axis: "x" | "z";
  readonly inward: 1 | -1;
}

const ROOM_WALLS: readonly RoomWall[] = [
  { axis: "z", inward: 1 },
  { axis: "z", inward: -1 },
  { axis: "x", inward: 1 },
  { axis: "x", inward: -1 },
];

// A forward axis parallel to a wall leaves the sofa facing along it rather than into the
// room, and the components that stand for a right angle are only zero to rounding, so a
// wall counts as usable only once the sofa clearly faces away from it.
const WALL_FACING_EPSILON = 1e-6;

/**
 * The walls an object of the given facing can back onto: a wall is usable only when the
 * forward axis points away from it, into the room, so a rotation-0 sofa (forward +z) can
 * only back onto the minimum-z wall, and the side walls open up for the quarter turns
 * that face it across them. The sofa keeps its Y rotation (spec 4.3) so it asks this of
 * one angle; the bookshelf asks it of every rotation its views allow.
 */
function usableSofaWalls(rotationY: number): readonly RoomWall[] {
  const { forward } = localAxes(rotationY);
  return ROOM_WALLS.filter(
    ({ axis, inward }) =>
      (axis === "x" ? forward.x : forward.z) * inward > WALL_FACING_EPSILON,
  );
}

/**
 * The sofa's own candidates: its current placement, then one sweep along every wall it
 * can back onto. Exported so the wall rule can be verified on the candidates themselves -
 * which wall a search settles on is otherwise only visible through the whole scored
 * layout.
 */
export function sofaCandidates(
  scene: Scene,
  object: SceneObject,
  options?: PlacementOptions,
): readonly ProposedPlacement[] {
  const choices = optionsFor(object, options);
  const result: ProposedPlacement[] = [incumbentPlacement(object, choices)];
  const sign = Math.sign(object.position[0]) || -1;

  // One sweep list per option, drawn round-robin below. The per-object cap is a fixed 48
  // however many orientations the views allow, so a single option's walls would otherwise
  // spend the whole budget and the others would never be seen (spec 8.2).
  const sweeps: ProposedPlacement[][] = [];
  for (const option of choices) {
    const rotationY = option.rotationY;
    const range = usableCenterRange(scene, object, rotationY);
    const [minimumX, maximumX] = inwardGridRange(
      range.minimumX,
      range.maximumX,
      PLACEMENT_LIMITS.gridM,
    );
    const [minimumZ, maximumZ] = inwardGridRange(
      range.minimumZ,
      range.maximumZ,
      PLACEMENT_LIMITS.gridM,
    );
    const sweep: ProposedPlacement[] = [];
    for (const wall of usableSofaWalls(rotationY)) {
      if (wall.axis === "z") {
        const z = wall.inward === 1 ? minimumZ : maximumZ;
        // Along a back wall the sofa keeps to the room side it was already on.
        for (const x of gridSweep(
          minimumX,
          maximumX,
          object.position[0],
          (value) => Math.sign(value) === sign,
        )) {
          sweep.push(candidate(object, x, z, rotationY));
        }
      } else {
        const x = wall.inward === 1 ? minimumX : maximumX;
        for (const z of gridSweep(minimumZ, maximumZ, object.position[2], () => true)) {
          sweep.push(candidate(object, x, z, rotationY));
        }
      }
    }
    sweeps.push(sweep);
  }

  const deepest = sweeps.reduce((longest, sweep) => Math.max(longest, sweep.length), 0);
  for (let depth = 0; depth < deepest; depth += 1) {
    for (const sweep of sweeps) {
      const placement = sweep[depth];
      if (placement !== undefined) result.push(placement);
    }
  }
  return result;
}

/**
 * Spec catalog-expansion 4: the bookshelf's own candidates. Its current placement leads,
 * then one sweep along every wall it can back onto and still face the room from, for each
 * rotation its views allow. Positions whose footprint would stand in an opening's
 * clearance zone are dropped here rather than left for the search to reject, so the cap
 * is spent on walls the shelf can actually use.
 *
 * Exported so the wall, clearance and facing rules can be verified on the candidates
 * themselves - which wall a search settles on is otherwise only visible through the whole
 * scored layout.
 */
export function bookshelfCandidates(
  scene: Scene,
  object: SceneObject,
  options?: PlacementOptions,
): readonly ProposedPlacement[] {
  const choices = optionsFor(object, options);
  const result: ProposedPlacement[] = [incumbentPlacement(object, choices)];
  const clearances = openingClearanceZones(scene);
  const clearsOpenings = (placement: ProposedPlacement): boolean => {
    const footprint = placementFootprint(object, placement);
    return !clearances.some((zone) => footprintsOverlap(footprint, zone));
  };

  // One sweep list per option, drawn round-robin below. The per-object cap is a fixed 48
  // however many orientations the views allow, so a single option's walls would otherwise
  // spend the whole budget and the others would never be seen (spec 8.2).
  const sweeps: ProposedPlacement[][] = [];
  for (const option of choices) {
    const rotationY = option.rotationY;
    const range = usableCenterRange(scene, object, rotationY);
    const [minimumX, maximumX] = inwardGridRange(
      range.minimumX,
      range.maximumX,
      PLACEMENT_LIMITS.gridM,
    );
    const [minimumZ, maximumZ] = inwardGridRange(
      range.minimumZ,
      range.maximumZ,
      PLACEMENT_LIMITS.gridM,
    );
    const sweep: ProposedPlacement[] = [];
    for (const wall of usableSofaWalls(rotationY)) {
      const along =
        wall.axis === "z"
          ? gridSweep(minimumX, maximumX, object.position[0], () => true)
          : gridSweep(minimumZ, maximumZ, object.position[2], () => true);
      for (const value of along) {
        const placement =
          wall.axis === "z"
            ? candidate(object, value, wall.inward === 1 ? minimumZ : maximumZ, rotationY)
            : candidate(object, wall.inward === 1 ? minimumX : maximumX, value, rotationY);
        if (clearsOpenings(placement)) sweep.push(placement);
      }
    }
    sweeps.push(sweep);
  }

  const deepest = sweeps.reduce((longest, sweep) => Math.max(longest, sweep.length), 0);
  for (let depth = 0; depth < deepest; depth += 1) {
    for (const sweep of sweeps) {
      const placement = sweep[depth];
      if (placement !== undefined) result.push(placement);
    }
  }
  return result;
}

/**
 * Where the coffee table belongs: one conversation gap out from the sofa along the sofa's
 * own forward axis. The offset is never flipped toward the room center - the sofa's seats
 * face its forward axis whatever corner of the room it stands in, and the far side of the
 * sofa is its back (spec 4.3, 6.4 term 3).
 */
function idealTablePosition(
  scene: Scene,
  objects: readonly SceneObject[],
  options: PlacementOptions | undefined,
): { x: number; z: number; rotationY: number } | null {
  const sofa = firstObject(objects, "sofa");
  const table = firstObject(objects, "coffee_table");
  if (!sofa || !table) return null;
  const { forward } = localAxes(sofa.rotation[1]);
  // The table is never turned (spec 8.2), but its held rotation still has to be one of
  // its options: the stage accumulates rotations while the table lists the folded angles.
  const rotationY = incumbentPlacement(table, optionsFor(table, options)).rotationY;
  const range = usableCenterRange(scene, table, rotationY);
  const distance =
    footprintRadiusAlongAxis(sofa, forward) +
    footprintRadiusAlongAxis(table, forward) +
    0.45;
  return {
    x: quantize(
      clamp(
        sofa.position[0] + forward.x * distance,
        range.minimumX,
        range.maximumX,
      ),
      PLACEMENT_LIMITS.gridM,
    ),
    z: quantize(
      clamp(
        sofa.position[2] + forward.z * distance,
        range.minimumZ,
        range.maximumZ,
      ),
      PLACEMENT_LIMITS.gridM,
    ),
    rotationY,
  };
}

function rugCandidates(
  scene: Scene,
  object: SceneObject,
  objects: readonly SceneObject[],
  options: PlacementOptions | undefined,
): readonly ProposedPlacement[] {
  // Rugs keep their own floor-plane rotation logic and ignore the options table entirely
  // (spec 8.1); the command adapter exempts them for the same reason.
  const result: ProposedPlacement[] = [placementFor(object)];
  const ideal = idealTablePosition(scene, objects, options);
  const sofa = firstObject(objects, "sofa");
  if (!ideal && !sofa) return result;
  const target = ideal ?? { x: sofa!.position[0], z: sofa!.position[2] };
  const rotationY = sofa?.rotation[1] ?? 0;
  const range = usableCenterRange(scene, object, rotationY);
  for (const deltaZ of [0, -0.1, 0.1, -0.2, 0.2]) {
    for (const deltaX of [0, -0.1, 0.1, -0.2, 0.2]) {
      result.push(
        candidate(
          object,
          quantize(clamp(target.x + deltaX, range.minimumX, range.maximumX), PLACEMENT_LIMITS.gridM),
          quantize(clamp(target.z + deltaZ, range.minimumZ, range.maximumZ), PLACEMENT_LIMITS.gridM),
          rotationY,
        ),
      );
    }
  }
  return result;
}

function tableCandidates(
  scene: Scene,
  object: SceneObject,
  objects: readonly SceneObject[],
  options: PlacementOptions | undefined,
): readonly ProposedPlacement[] {
  const result: ProposedPlacement[] = [
    incumbentPlacement(object, optionsFor(object, options)),
  ];
  const sofa = firstObject(objects, "sofa");
  const ideal = idealTablePosition(scene, objects, options);
  if (!sofa || !ideal) return result;
  const { forward, lateral } = localAxes(sofa.rotation[1]);
  const range = usableCenterRange(scene, object, ideal.rotationY);
  for (const gap of [0.45, 0.4, 0.5, 0.35, 0.55]) {
    const distance =
      footprintRadiusAlongAxis(sofa, forward) +
      footprintRadiusAlongAxis(object, forward) +
      gap;
    for (const deltaX of [0, -0.1, 0.1, -0.2, 0.2, -0.3, 0.3]) {
      const x = quantize(
        clamp(
          sofa.position[0] + forward.x * distance + lateral.x * deltaX,
          range.minimumX,
          range.maximumX,
        ),
        PLACEMENT_LIMITS.gridM,
      );
      const z = quantize(
        clamp(
          sofa.position[2] + forward.z * distance + lateral.z * deltaX,
          range.minimumZ,
          range.maximumZ,
        ),
        PLACEMENT_LIMITS.gridM,
      );
      const proposed = withPlacement(object, candidate(object, x, z, ideal.rotationY));
      const gapMm = millimetres(tableEdgeGap(sofa, proposed));
      if (gapMm >= 350 && gapMm <= 550) {
        result.push(candidate(object, x, z, ideal.rotationY));
      }
    }
  }
  return result;
}

/**
 * The chair's candidates (spec 8.2). The incumbent leads, then the three staged families
 * - flank, across, side of table - each emitted only when the rotation it needs is one of
 * the chair's options, then the legacy across-the-table sweep at whatever rotation the
 * chair already has, which is the whole list for a caller that passes no options.
 *
 * Exported for the same reason `sofaCandidates` is: which family a search settles on is
 * otherwise only visible through the whole scored layout, so a family that is silently
 * never offered looks exactly like one that was offered and lost.
 */
export function chairCandidates(
  scene: Scene,
  object: SceneObject,
  objects: readonly SceneObject[],
  options?: PlacementOptions,
): readonly ProposedPlacement[] {
  const choices = optionsFor(object, options);
  const result: ProposedPlacement[] = [incumbentPlacement(object, choices)];
  const sofa = firstObject(objects, "sofa");
  const table = firstObject(objects, "coffee_table");
  if (!sofa || !table) return result;

  // The staged families need to know which orientations the views can show. A caller
  // that lists none for this chair gets the untuned across-the-table sweep alone, which
  // is the arrangement the solver made before it could turn anything.
  const staged = options?.rotationOptions?.[object.id] !== undefined;
  const sofaYaw = sofa.rotation[1];
  const { forward, lateral } = localAxes(sofaYaw);
  const ranges = new Map<number, ReturnType<typeof usableCenterRange>>();
  const rangeFor = (rotationY: number) => {
    let range = ranges.get(rotationY);
    if (range === undefined) {
      range = usableCenterRange(scene, object, rotationY);
      ranges.set(rotationY, range);
    }
    return range;
  };
  const push = (x: number, z: number, rotationY: number) => {
    const range = rangeFor(rotationY);
    result.push(
      candidate(
        object,
        quantize(clamp(x, range.minimumX, range.maximumX), PLACEMENT_LIMITS.gridM),
        quantize(clamp(z, range.minimumZ, range.maximumZ), PLACEMENT_LIMITS.gridM),
        rotationY,
      ),
    );
  };
  /**
   * The option a family's required turn stands for, matched as an angle. Folding the turn
   * and then comparing values would miss the one grid angle that has two names: a turn of
   * -180 degrees folds to -pi while the registry stores +pi, so the family would be
   * dropped for the very orientation it asks for.
   */
  const optionFor = (rotationY: number): number | null => {
    for (const option of choices) {
      if (
        Math.abs(foldAngle(option.rotationY - rotationY)) <= ROTATION_OPTION_EPSILON
      ) {
        return option.rotationY;
      }
    }
    return null;
  };
  /** The chair's own reach along an axis once it has been turned to `rotationY`. */
  const reach = (rotationY: number, axis: PointXZ) =>
    footprintRadiusAlongAxis(
      withPlacement(object, candidate(object, 0, 0, rotationY)),
      axis,
    );

  // 1. Flank: beside a sofa end, quarter-turned toward the table. The left end (negative
  // lateral) turns right, the right end turns left. The offsets are measured from the
  // turned chair's own reach so `gap` is the clearance it names.
  for (const side of staged ? ([1, -1] as const) : []) {
    const rotationY = optionFor(sofaYaw + (side * Math.PI) / 4);
    if (rotationY === null) continue;
    const lateralReach =
      footprintRadiusAlongAxis(sofa, lateral) + reach(rotationY, lateral);
    // Spec 8.2 lists 0.2 and 0.5. A sofa backed onto a wall that carries an opening
    // leaves both inside that opening's clearance zone - the demo room's window is
    // exactly this case - so the family also offers the offset that clears a 0.75m zone.
    for (const gap of [0.3, 0.15]) {
      for (const ahead of [0.2, 0.5, 0.8]) {
        const offset = side * (lateralReach + gap);
        push(
          sofa.position[0] + lateral.x * offset + forward.x * ahead,
          sofa.position[2] + lateral.z * offset + forward.z * ahead,
          rotationY,
        );
      }
    }
  }

  // 2. Across: beyond the table on the sofa's forward axis, turned back toward the sofa.
  const acrossRotation = staged ? optionFor(sofaYaw + Math.PI) : null;
  if (acrossRotation !== null) {
    for (const gap of [0.4, 0.55, 0.7]) {
      const distance =
        footprintRadiusAlongAxis(table, forward) +
        reach(acrossRotation, forward) +
        gap;
      for (const offset of [0, -0.3, 0.3]) {
        push(
          table.position[0] + forward.x * distance + lateral.x * offset,
          table.position[2] + forward.z * distance + lateral.z * offset,
          acrossRotation,
        );
      }
    }
  }

  // 3. Side of table: on either lateral side of the table, quarter-turned to face it. The
  // turn that faces the table is confirmed against the chair's own forward axis rather
  // than assumed from the sign.
  for (const side of staged ? ([1, -1] as const) : []) {
    const facingTurn = [sofaYaw + Math.PI / 2, sofaYaw - Math.PI / 2].find(
      (turn) => {
        const chairForward = localAxes(turn).forward;
        return axisProjection(chairForward, lateral) * side < 0;
      },
    );
    if (facingTurn === undefined) continue;
    const rotationY = optionFor(facingTurn);
    if (rotationY === null) continue;
    for (const gap of [0.3, 0.5]) {
      const offset =
        side *
        (footprintRadiusAlongAxis(table, lateral) + reach(rotationY, lateral) + gap);
      push(
        table.position[0] + lateral.x * offset,
        table.position[2] + lateral.z * offset,
        rotationY,
      );
    }
  }

  // 4. The chair closes the conversation area from beyond the table without being turned -
  // the only family a caller that passes no rotation options can use.
  const held = incumbentPlacement(object, choices).rotationY;
  for (const gap of [0.4, 0.5, 0.6, 0.7]) {
    const distance =
      footprintRadiusAlongAxis(table, forward) + reach(held, forward) + gap;
    for (const offset of [0, -0.1, 0.1, -0.2, 0.2]) {
      push(
        table.position[0] + forward.x * distance + lateral.x * offset,
        table.position[2] + forward.z * distance + lateral.z * offset,
        held,
      );
    }
  }
  return result;
}

/**
 * The inset perimeter an accessory can stand on, tagged by the wall or corner it
 * belongs to so the candidate cap can be shared out evenly between them.
 */
function perimeterRing(
  scene: Scene,
  object: SceneObject,
  rotationY: number,
): { points: readonly PerimeterPoint[]; distinct: boolean } {
  const range = usableCenterRange(scene, object, rotationY);
  const [minimumX, maximumX] = inwardGridRange(range.minimumX, range.maximumX, PLACEMENT_LIMITS.gridM);
  const [minimumZ, maximumZ] = inwardGridRange(range.minimumZ, range.maximumZ, PLACEMENT_LIMITS.gridM);
  const xValues: number[] = [];
  for (let x = minimumX; x <= maximumX + 1e-9; x += PLACEMENT_LIMITS.gridM) {
    xValues.push(quantize(x, PLACEMENT_LIMITS.gridM));
  }
  const ring: PerimeterPoint[] = [];
  for (let index = 0; index < xValues.length; index += 1) {
    const x = xValues[index]!;
    const last = index === xValues.length - 1;
    const backSide: PerimeterSide =
      index === 0 ? "back-left" : last ? "back-right" : "back";
    const frontSide: PerimeterSide =
      index === 0 ? "front-left" : last ? "front-right" : "front";
    ring.push({ x, z: minimumZ, side: PERIMETER_SIDE_INDEX[backSide] });
    ring.push({ x, z: maximumZ, side: PERIMETER_SIDE_INDEX[frontSide] });
  }
  for (let z = minimumZ + PLACEMENT_LIMITS.gridM; z < maximumZ - 1e-9; z += PLACEMENT_LIMITS.gridM) {
    const quantizedZ = quantize(z, PLACEMENT_LIMITS.gridM);
    ring.push({ x: minimumX, z: quantizedZ, side: PERIMETER_SIDE_INDEX.left });
    ring.push({ x: maximumX, z: quantizedZ, side: PERIMETER_SIDE_INDEX.right });
  }
  // The two rows coincide in a room only one cell deep, and the two columns in one only a
  // cell wide; anywhere else every ring position appears exactly once.
  return { points: ring, distinct: minimumZ !== maximumZ && minimumX !== maximumX };
}

/**
 * Reorders a coordinate-sorted wall so that every prefix still spans it: both ends
 * first, then the midpoint, then the quarter points. Taking the first n entries
 * therefore samples the whole wall instead of the run nearest one corner.
 */
let takenScratch = new Uint8Array(0);
let segmentScratch = new Int32Array(0);

function spreadOrder(
  points: readonly ProposedPlacement[],
  needed: number,
): readonly ProposedPlacement[] {
  if (needed <= 0) return [];
  if (points.length <= 2) return points;
  const last = points.length - 1;
  const ordered: ProposedPlacement[] = [points[0]!];
  if (needed === 1) return ordered;
  ordered.push(points[last]!);
  if (takenScratch.length < points.length) {
    takenScratch = new Uint8Array(points.length);
    // The subdivision visits at most 2n segments, each a low/high pair.
    segmentScratch = new Int32Array((points.length + 2) * 4);
  } else {
    takenScratch.fill(0, 0, points.length);
  }
  const taken = takenScratch;
  const segments = segmentScratch;
  taken[0] = 1;
  taken[last] = 1;
  segments[0] = 0;
  segments[1] = last;

  let tail = 2;
  for (let head = 0; head < tail; head += 2) {
    const low = segments[head]!;
    const high = segments[head + 1]!;
    if (high - low < 2) continue;
    const middle = low + Math.floor((high - low) / 2);
    if (taken[middle] === 0) {
      taken[middle] = 1;
      ordered.push(points[middle]!);
      if (ordered.length >= needed) return ordered;
    }
    segments[tail] = low;
    segments[tail + 1] = middle;
    segments[tail + 2] = middle;
    segments[tail + 3] = high;
    tail += 4;
  }
  return ordered;
}

/**
 * Perimeter candidates for an accessory, aware of the partial layout it is joining.
 * Positions the settled obstacles already cover are dropped before the candidate cap
 * applies, and the survivors are drawn round-robin from every wall and corner, so the
 * cap can never be spent on the single arc nearest the object's current position.
 */
let blockerScratch = new Float64Array(0);

/** Lane buffers reused across partials; accessory generation never runs reentrantly. */
const laneScratch: ProposedPlacement[][] = PERIMETER_SIDES.map(
  () => [] as ProposedPlacement[],
);

/**
 * Accessory positions beside a settled seat's sides (spec 8.2, catalog-expansion 4). The
 * staged photo stands the lamp at a sofa end - and the side table at a sofa end or a
 * chair side - rather than out on the perimeter, and the seat is only settled inside the
 * search, so these cannot be hoisted into the per-scene accessory context. They are
 * emitted already inside the room and clear of the openings, exactly as the ring
 * positions are, because the search trusts accessory candidates on that point.
 */
function seatSideCandidates(
  scene: Scene,
  object: SceneObject,
  seat: SceneObject,
  gaps: readonly number[],
): readonly ProposedPlacement[] {
  const rotationY = object.rotation[1];
  const { forward, lateral } = localAxes(seat.rotation[1]);
  const range = usableCenterRange(scene, object, rotationY);
  const clearances = openingClearanceZones(scene);
  const lateralReach =
    footprintRadiusAlongAxis(seat, lateral) + footprintRadiusAlongAxis(object, lateral);
  // Aligned with the seat's centre, and again with its back edge: both read as "beside
  // the seat" and the second is what a room with a deep sofa leaves space for.
  const alignments = [
    0,
    -(footprintRadiusAlongAxis(seat, forward) -
      footprintRadiusAlongAxis(object, forward)),
  ];
  const result: ProposedPlacement[] = [];
  for (const side of [-1, 1] as const) {
    for (const gap of gaps) {
      for (const along of alignments) {
        const offset = side * (lateralReach + gap);
        const x = quantize(
          clamp(
            seat.position[0] + lateral.x * offset + forward.x * along,
            range.minimumX,
            range.maximumX,
          ),
          PLACEMENT_LIMITS.gridM,
        );
        const z = quantize(
          clamp(
            seat.position[2] + lateral.z * offset + forward.z * along,
            range.minimumZ,
            range.maximumZ,
          ),
          PLACEMENT_LIMITS.gridM,
        );
        const placement = candidate(object, x, z, rotationY);
        const footprint = objectFootprint(withPlacement(object, placement));
        if (
          !footprintInsideRoom(footprint, scene.room, PLACEMENT_LIMITS.roomInsetM) ||
          clearances.some((zone) => footprintsOverlap(footprint, zone))
        ) {
          continue;
        }
        result.push(placement);
      }
    }
  }
  return result;
}

/** The lamp's own family: beside the settled sofa's ends, at the spec's two gaps. */
function sofaEndCandidates(
  scene: Scene,
  object: SceneObject,
  state: SearchState,
): readonly ProposedPlacement[] {
  const sofa = firstObject(settledOf(state), "sofa");
  return sofa ? seatSideCandidates(scene, object, sofa, [0.1, 0.25]) : [];
}

/**
 * Spec catalog-expansion 4: the side table's own family, beside a settled sofa end and
 * beside a settled chair's side. The gaps span the band the composition term rewards, so
 * a room that cannot spare the widest still offers the tightest.
 */
const SIDE_TABLE_GAPS: readonly number[] = [0.05, 0.15, 0.25];

function sideTableSeatCandidates(
  scene: Scene,
  object: SceneObject,
  state: SearchState,
): readonly ProposedPlacement[] {
  const settled = settledOf(state);
  const result: ProposedPlacement[] = [];
  for (const type of ["sofa", "chair"] as const) {
    const seat = firstObject(settled, type);
    if (seat) result.push(...seatSideCandidates(scene, object, seat, SIDE_TABLE_GAPS));
  }
  return result;
}

function accessoryCandidates(
  scene: Scene,
  object: SceneObject,
  state: SearchState,
  context: AccessoryContext,
  limit: number,
): CandidateSet {
  const settled = settledOf(state);
  const footprints = settledFootprintsOf(state);
  const blockers: Footprint2D[] = [];
  for (let index = 0; index < settled.length; index += 1) {
    const other = settled[index]!;
    if (other.id === object.id || other.type === "rug") continue;
    blockers.push(footprints[index]!);
  }
  // Centres and reach in one flat buffer: the candidates all share their extents, so this
  // distance test rejects the far blockers before the separating-axis test sees any.
  if (blockerScratch.length < blockers.length * 4) {
    blockerScratch = new Float64Array(blockers.length * 8);
  }
  const reach = blockerScratch;
  for (let index = 0; index < blockers.length; index += 1) {
    const blocker = blockers[index]!;
    const bounds = footprintBounds(blocker);
    reach[index * 4] = blocker.center.x;
    reach[index * 4 + 1] = blocker.center.z;
    reach[index * 4 + 2] = bounds.x + context.boundX;
    reach[index * 4 + 3] = bounds.z + context.boundZ;
  }
  const isFree = (footprint: Footprint2D): boolean => {
    const centerX = footprint.center.x;
    const centerZ = footprint.center.z;
    for (let index = 0; index < blockers.length; index += 1) {
      const base = index * 4;
      if (
        Math.abs(centerX - reach[base]!) > reach[base + 2]! ||
        Math.abs(centerZ - reach[base + 1]!) > reach[base + 3]!
      ) {
        continue;
      }
      if (footprintsOverlap(footprint, blockers[index]!)) return false;
    }
    return true;
  };

  const leadsWithIncumbent =
    context.incumbent !== null && isFree(context.incumbentFootprint!);
  // The incumbent already leads the list, so its ring twin is dropped where the millimetre
  // dedupe used to drop it: on the way out, leaving every other position in place.
  const twin = leadsWithIncumbent ? context.duplicate : null;
  const lanes = laneScratch;
  let twinIsFree = false;
  for (const lane of lanes) lane.length = 0;
  for (const point of context.points) {
    if (!isFree(point.footprint)) continue;
    if (point.placement === twin) twinIsFree = true;
    lanes[point.side]!.push(point.placement);
  }

  const lead = leadsWithIncumbent ? context.incumbent : null;
  const staged =
    object.type === "floor_lamp"
      ? sofaEndCandidates(scene, object, state)
      : object.type === "side_table"
        ? sideTableSeatCandidates(scene, object, state)
        : [];
  const ends = staged.filter((placement) =>
    isFree(placementFootprint(object, placement)),
  );
  if (ends.length > 0) {
    // The sofa ends come ahead of the ring and are kept even when the ring alone could
    // fill the cap; the ring gets whatever the cap has left. Both lists are handed to the
    // millimetre dedupe, which drops an end that repeats the incumbent or a ring twin.
    const head = lead === null ? ends : [lead, ...ends];
    const flattened = flattenPerimeterLanes(
      lanes,
      null,
      null,
      context.distinct ? Math.max(limit - head.length, 0) : Number.POSITIVE_INFINITY,
    );
    const combined = uniqueCandidates([...head, ...flattened.candidates], limit);
    return {
      candidates: combined.candidates,
      truncated: combined.truncated || flattened.truncated,
    };
  }
  if (!context.distinct) {
    // A ring that repeats a position needs the millimetre dedupe, so the whole perimeter
    // is flattened and handed to it.
    const flattened = flattenPerimeterLanes(
      lanes,
      lead,
      twinIsFree ? twin : null,
      Number.POSITIVE_INFINITY,
    );
    return uniqueCandidates(flattened.candidates, limit);
  }
  return flattenPerimeterLanes(lanes, lead, twinIsFree ? twin : null, limit);
}

/**
 * Flattens the perimeter lanes into a candidate list: the free incumbent leads, then one
 * position from each lane in turn, every lane spread across its own wall. `twin` is the
 * lane entry the incumbent already occupies and is dropped on the way out - exactly where
 * the millimetre dedupe used to drop it - so the emitted positions stay distinct and in
 * the order the uncapped flattening would produce.
 *
 * Exported so the cap can be verified against a lane shape that a Scene cannot make
 * observable: when a single wall survives, the incumbent that leads the list is also the
 * one the search keeps, so an off-by-one in the cap changes no proposal.
 */
export function flattenPerimeterLanes(
  lanes: readonly (readonly ProposedPlacement[])[],
  lead: ProposedPlacement | null,
  twin: ProposedPlacement | null,
  limit: number,
): CandidateSet {
  const result: ProposedPlacement[] = lead === null ? [] : [lead];
  let available = result.length;
  for (const lane of lanes) available += lane.length;
  if (twin !== null) available -= 1;

  // The twin costs a lane entry without producing a candidate, so a lane that has to
  // carry the whole budget alone needs one entry more than the cap by itself asks for.
  const wanted = limit - result.length + (twin === null ? 0 : 1);
  const spread = lanes.map((lane) => spreadOrder(lane, wanted));
  const deepest = spread.reduce((longest, lane) => Math.max(longest, lane.length), 0);
  for (let depth = 0; depth < deepest && result.length < limit; depth += 1) {
    for (const lane of spread) {
      if (result.length >= limit) break;
      const placement = lane[depth];
      if (placement !== undefined && placement !== twin) result.push(placement);
    }
  }
  return { candidates: result, truncated: available > limit };
}

const DEDUPE_Z_SPAN = 1 << 21;
const DEDUPE_ROTATIONS = 8;

function uniqueCandidates(
  candidates: readonly ProposedPlacement[],
  limit: number,
): CandidateSet {
  // Quantized millimetres and a small rotation table pack a candidate's identity into one
  // exact integer, so the millimetre-grid dedupe needs no string per candidate.
  const seen = new Set<number>();
  let seenWide: Set<string> | null = null;
  const rotations: number[] = [];
  const unique: ProposedPlacement[] = [];
  let truncated = false;
  for (const placement of candidates) {
    let rotationIndex = rotations.indexOf(placement.rotationY);
    if (rotationIndex < 0) {
      rotationIndex = rotations.length;
      rotations.push(placement.rotationY);
    }
    const millimetreX = millimetres(placement.position[0]);
    const millimetreZ = millimetres(placement.position[2]);
    const packable =
      rotationIndex < DEDUPE_ROTATIONS &&
      Math.abs(millimetreX) < DEDUPE_Z_SPAN &&
      Math.abs(millimetreZ) < DEDUPE_Z_SPAN;
    if (packable) {
      const key =
        (millimetreX * DEDUPE_Z_SPAN * 2 + millimetreZ) * DEDUPE_ROTATIONS +
        rotationIndex;
      if (seen.has(key)) continue;
      seen.add(key);
    } else {
      const key = `${millimetreX}:${millimetreZ}:${placement.rotationY}`;
      seenWide ??= new Set<string>();
      if (seenWide.has(key)) continue;
      seenWide.add(key);
    }
    if (unique.length < limit) {
      unique.push(placement);
    } else {
      truncated = true;
      break;
    }
  }
  return { candidates: unique, truncated };
}

interface AccessoryPoint {
  placement: ProposedPlacement;
  footprint: Footprint2D;
  side: number;
}

/**
 * The perimeter work an accessory step would otherwise repeat for every partial in the
 * beam. Room bounds and opening clearance do not depend on the partial, so the ring is
 * reduced to the admissible positions once and each keeps its footprint; only the
 * obstacle test is left to do per partial.
 */
interface AccessoryContext {
  points: readonly AccessoryPoint[];
  incumbent: ProposedPlacement | null;
  incumbentFootprint: Footprint2D | null;
  /** The ring placement the incumbent already occupies, if it stands on the grid. */
  duplicate: ProposedPlacement | null;
  /** False when the ring itself repeats a position, as a room thinner than one cell can. */
  distinct: boolean;
  /** Shared by every candidate: they differ only in where they are centered. */
  boundX: number;
  boundZ: number;
}

function accessoryContext(scene: Scene, object: SceneObject): AccessoryContext {
  const rotationY = object.rotation[1];
  const clearances = openingClearanceZones(scene);
  const admissible = (placement: ProposedPlacement): Footprint2D | null => {
    const footprint = objectFootprint(withPlacement(object, placement));
    const usable =
      footprintInsideRoom(footprint, scene.room, PLACEMENT_LIMITS.roomInsetM) &&
      !clearances.some((zone) => footprintsOverlap(footprint, zone));
    return usable ? footprint : null;
  };

  const ring = perimeterRing(scene, object, rotationY);
  const points: AccessoryPoint[] = [];
  for (const point of ring.points) {
    const placement = candidate(object, point.x, point.z, rotationY);
    const footprint = admissible(placement);
    if (footprint) points.push({ placement, footprint, side: point.side });
  }

  const incumbent = placementFor(object);
  const incumbentFootprint = admissible(incumbent);
  const bounds = footprintBounds(objectFootprint(withPlacement(object, incumbent)));
  const incumbentX = millimetres(incumbent.position[0]);
  const incumbentZ = millimetres(incumbent.position[2]);
  return {
    points,
    incumbent: incumbentFootprint ? incumbent : null,
    incumbentFootprint,
    duplicate:
      points.find(
        ({ placement }) =>
          millimetres(placement.position[0]) === incumbentX &&
          millimetres(placement.position[2]) === incumbentZ &&
          placement.rotationY === incumbent.rotationY,
      )?.placement ?? null,
    distinct: ring.distinct,
    boundX: bounds.x,
    boundZ: bounds.z,
  };
}

function candidatesFor(
  scene: Scene,
  object: SceneObject,
  state: SearchState,
  accessory: AccessoryContext | null,
  limit: number,
  options: PlacementOptions | undefined,
): CandidateSet {
  let candidates: readonly ProposedPlacement[];
  switch (object.type) {
    case "sofa":
      candidates = sofaCandidates(scene, object, options);
      break;
    case "rug":
      candidates = rugCandidates(scene, object, layoutOf(state), options);
      break;
    case "coffee_table":
      candidates = tableCandidates(scene, object, layoutOf(state), options);
      break;
    case "chair":
      candidates = chairCandidates(scene, object, layoutOf(state), options);
      break;
    case "floor_lamp":
    case "plant":
    case "side_table":
      return accessoryCandidates(scene, object, state, accessory!, limit);
    case "bookshelf":
      candidates = bookshelfCandidates(scene, object, options);
      break;
    case "unknown":
      candidates = [];
      break;
  }
  return uniqueCandidates(candidates, limit);
}

const SEATING_TYPES: ReadonlySet<SceneObjectType> = new Set<SceneObjectType>([
  "sofa",
  "coffee_table",
  "chair",
  "rug",
]);

/**
 * The seating hull of a partial's settled obstacles. Only seating objects shape it, so a
 * partial that adds an accessory inherits its parent's, and most partials never need it
 * at all - accessories are placed last, and a room with no locked accessory has nothing
 * to test against the hull until then.
 */
function seatingHull(state: SearchState): readonly PointXZ[] {
  if (state.hull === null) state.hull = primarySeatingHull(settledOf(state));
  return state.hull;
}

/**
 * The partial constraints that hold over the locked and unknown objects alone. They do
 * not depend on any candidate, so the search settles them once per pass.
 */
function admitsSettledRoot(
  scene: Scene,
  settled: readonly SceneObject[],
  hull: readonly PointXZ[],
): boolean {
  const nonRugs = settled.filter(({ type }) => type !== "rug");
  for (let first = 0; first < nonRugs.length; first += 1) {
    for (let second = first + 1; second < nonRugs.length; second += 1) {
      if (
        footprintsOverlap(
          objectFootprint(nonRugs[first]!),
          objectFootprint(nonRugs[second]!),
        )
      ) {
        return false;
      }
    }
  }
  return !settled.some(
    (object) =>
      avoidsSeatingHull(object) && pointInsideConvexHull(objectCenter(object), hull),
  );
}

function objectCenter(object: SceneObject): PointXZ {
  return { x: object.position[0], z: object.position[2] };
}

/**
 * The partial hard constraints, decided against a parent that already satisfies them.
 * Only the newly settled object can break the room bound, the clearance zones or a
 * footprint pair, and the seating hull only moves when a seating object joins - so the
 * answer matches a full re-check of the partial while touching one object's worth of it.
 */
function admitsPlacement(
  scene: Scene,
  state: SearchState,
  object: SceneObject,
  placement: ProposedPlacement,
  footprint: Footprint2D,
  geometryChecked: boolean,
): boolean {
  if (!geometryChecked) {
    if (
      !footprintInsideRoom(footprint, scene.room, PLACEMENT_LIMITS.roomInsetM) ||
      footprintIsInsideOpeningClearance(scene, footprint)
    ) {
      return false;
    }
    if (object.type !== "rug") {
      const settled = settledOf(state);
      const footprints = settledFootprintsOf(state);
      for (let index = 0; index < settled.length; index += 1) {
        if (settled[index]!.type === "rug") continue;
        if (footprintsOverlap(footprint, footprints[index]!)) return false;
      }
    }
  }

  if (!SEATING_TYPES.has(object.type)) {
    return !(
      avoidsSeatingHull(object) &&
      pointInsideConvexHull(footprint.center, seatingHull(state))
    );
  }

  const settledAccessories = settledOf(state).filter(avoidsSeatingHull);
  if (settledAccessories.length === 0) return true;
  const hull = primarySeatingHull([
    ...settledOf(state),
    withPlacement(object, placement),
  ]);
  return !settledAccessories.some((accessory) =>
    pointInsideConvexHull(objectCenter(accessory), hull),
  );
}

/** A seating object reshapes the hull; anything else leaves the parent's in place. */
function hullAfter(
  state: SearchState,
  type: SceneObjectType,
): readonly PointXZ[] | null {
  return SEATING_TYPES.has(type) ? null : state.hull;
}

/**
 * Hard-constraint rejections that are already decidable for a partial layout.
 * Both are monotone: the objects still to be placed can only add obstacles, so a
 * partial that fails here can never complete into a valid layout, and dropping
 * it frees a beam slot for a branch that still can.
 */
function partialBlocksEntryZone(
  entryPoints: readonly PointXZ[],
  state: SearchState,
): boolean {
  const settled = settledOf(state);
  return occupiesEntryZone(
    entryPoints,
    settledFootprintsOf(state).filter(
      (_, index) => settled[index]!.type !== "rug",
    ),
  );
}

function partialBlocksCirculation(scene: Scene, state: SearchState): boolean {
  return !hasCirculationPath(
    scene,
    settledFootprintsOf(state),
    settledOf(state).filter(({ type }) => type === "rug"),
  );
}

function searchLayouts(
  scene: Scene,
  limits: typeof PLACEMENT_LIMITS,
  options: PlacementOptions | undefined,
): LayoutSearch {
  const movable = scene.objects
    .filter(isMovable)
    .sort(compareObjects);
  const sceneIndexById = new Map(
    scene.objects.map((object, index) => [object.id, index] as const),
  );
  const settledRoot = scene.objects.filter(
    (object) => object.locked || object.type === "unknown",
  );
  const accessoryCount = scene.objects.filter(isAccessory).length;
  const composedCount = movable.filter(isComposed).length;
  const baseTerms = layoutTerms(scene, scene.objects, options);
  const root: SearchState = {
    candidateIndex: -1,
    objectIds: [],
    score: 0,
    parent: null,
    placedIndex: -1,
    placedTemplate: null,
    placement: null,
    placedFootprint: null,
    placedObject: null,
    placements: [],
    objects: scene.objects,
    settled: settledRoot,
    settledFootprints: settledRoot.map(objectFootprint),
    hull: primarySeatingHull(settledRoot),
    terms: baseTerms,
    movementTotal: movable.length * 1000,
    accessoryTotal: scene.objects
      .filter(isAccessory)
      .reduce(
        (sum, object) => sum + accessoryContribution(scene, objectFootprint(object)),
        0,
      ),
    viewFidelityTotal: movable
      .filter(isComposed)
      .reduce(
        (sum, object) =>
          sum + fidelityContribution(object.id, object.rotation[1], options),
        0,
      ),
  };
  // The locked room has to satisfy the partial constraints on its own; when it does not,
  // no extension of it can either, which is what the per-candidate re-check used to
  // rediscover for every candidate of every step.
  const rootAdmits = admitsSettledRoot(scene, settledRoot, seatingHull(root));
  let beam: SearchState[] = [root];
  let prunedByBeam = false;
  let truncatedCandidates = false;
  let evaluatedLayouts = 0;
  const entryPoints = entryZonePoints(scene);

  for (let objectIndex = 0; objectIndex < movable.length; objectIndex += 1) {
    const object = movable[objectIndex]!;
    const sceneIndex = sceneIndexById.get(object.id)!;
    const accessory = isAccessory(object) ? accessoryContext(scene, object) : null;
    // Accessory candidates are produced already inside the room, clear of the openings
    // and clear of the partial's obstacles, so re-testing that geometry would repeat the
    // filter that generated them.
    const geometryChecked = accessory !== null;
    const original = scene.objects[sceneIndex]!;
    const baseMovement = movementContribution(original, placementFor(object));
    const baseAccessory = isAccessory(object)
      ? accessoryContribution(scene, objectFootprint(object))
      : 0;
    const composed = isComposed(object);
    const baseFidelity = composed
      ? fidelityContribution(object.id, object.rotation[1], options)
      : 0;
    const affected = TERM_DEPENDENCIES[object.type];
    const expanded: SearchState[] = [];
    for (const state of beam) {
      const candidateSet = candidatesFor(
        scene,
        object,
        state,
        accessory,
        limits.candidatesPerObject,
        options,
      );
      if (candidateSet.truncated) truncatedCandidates = true;
      const objectIds = [...state.objectIds, object.id];
      for (
        let candidateIndex = 0;
        candidateIndex < candidateSet.candidates.length;
        candidateIndex += 1
      ) {
        const placement = candidateSet.candidates[candidateIndex]!;
        const footprint = placementFootprint(object, placement);
        if (
          !rootAdmits ||
          !admitsPlacement(scene, state, object, placement, footprint, geometryChecked)
        ) {
          continue;
        }

        let placed: SceneObject | null = null;
        let objects: readonly SceneObject[] | null = null;
        const terms = state.terms.slice();
        if (affected.length > 0) {
          placed = withPlacement(object, placement);
          const patched = layoutOf(state).slice();
          patched[sceneIndex] = placed;
          objects = patched;
          for (const term of affected) {
            terms[term] = TERM_SCORERS[term]!(scene, patched, options);
          }
        }
        const movementTotal =
          state.movementTotal -
          baseMovement +
          movementContribution(original, placement);
        terms[TERM_MOVEMENT] = Math.round(movementTotal / movable.length);
        let accessoryTotal = state.accessoryTotal;
        if (accessory) {
          accessoryTotal =
            accessoryTotal - baseAccessory + accessoryContribution(scene, footprint);
          terms[TERM_ACCESSORIES] = Math.round(accessoryTotal / accessoryCount);
        }
        // Only the object being placed can change its own rotation, so the averaged
        // fidelity term is a running total rather than a rescan of the layout.
        let viewFidelityTotal = state.viewFidelityTotal;
        if (composed) {
          viewFidelityTotal =
            viewFidelityTotal -
            baseFidelity +
            fidelityContribution(object.id, placement.rotationY, options);
          terms[TERM_VIEW_FIDELITY] = Math.round(viewFidelityTotal / composedCount);
        }

        expanded.push({
          candidateIndex,
          objectIds,
          score: weightedScore(terms, 0),
          terms,
          movementTotal,
          accessoryTotal,
          viewFidelityTotal,
          parent: state,
          placedIndex: sceneIndex,
          placedTemplate: object,
          placement,
          placedFootprint: footprint,
          placedObject: placed,
          placements: null,
          objects,
          settled: null,
          settledFootprints: null,
          hull: hullAfter(state, object.type),
        });
      }
    }

    expanded.sort(compareSearchStates);
    const kept: SearchState[] = [];
    let ranked = 0;
    for (; ranked < expanded.length && kept.length < limits.beamWidth; ranked += 1) {
      const state = expanded[ranked]!;
      if (partialBlocksEntryZone(entryPoints, state)) continue;
      if (objectIndex === 0 && partialBlocksCirculation(scene, state)) {
        continue;
      }
      kept.push(state);
    }
    if (ranked < expanded.length) prunedByBeam = true;
    beam = kept;
    if (beam.length === 0) {
      return {
        best: null,
        evaluatedLayouts,
        exhausted: prunedByBeam || truncatedCandidates,
      };
    }
  }

  let best: EvaluatedLayout | null = null;
  for (const state of beam) {
    evaluatedLayouts += 1;
    // The beam is held in `compareSearchStates` order and a valid layout always scores
    // its partial score plus the full circulation term, so the first valid state in that
    // order is the one the ranking would settle on - later states can only tie lower.
    if (best !== null) continue;
    const evaluated =
      movable.length === 0
        ? evaluateCompleteLayout(scene, placementsOf(state), options)
        : evaluateSettledState(scene, state);
    if (evaluated.valid) best = evaluated;
  }

  return {
    best,
    evaluatedLayouts,
    exhausted: best === null && (prunedByBeam || truncatedCandidates),
  };
}

function diagnostics(
  current: EvaluatedLayout,
  search: LayoutSearch,
): PlacementDiagnostics {
  return {
    currentScore: current.valid ? current.score : null,
    proposedScore: search.best?.score ?? null,
    evaluatedLayouts: search.evaluatedLayouts,
  };
}

/**
 * Turns a finished search into the proposal it stands for.
 *
 * The current layout is itself a complete candidate: when the bounded search keeps no
 * valid layout of its own, a room that already satisfies the hard constraints still has
 * one answer to report, so exhaustion is never raised for a Scene that is already safe.
 * The substituted layout is the incumbent, so it scores exactly the current layout and
 * resolves to `already-safe`, and it counts as one more complete layout settled. A
 * current layout that breaks a hard constraint is never substituted, so an unsafe room
 * still reports the failure it earned.
 *
 * Exported so the substitution can be verified on its own inputs: `searchLayouts` cannot
 * be driven to keep nothing while the current layout stays safe without narrowing the
 * beam, which the profile fixes.
 */
export function resolvePlacementSearch(
  incumbent: EvaluatedLayout,
  search: LayoutSearch,
): NaturalPlacementResult {
  const settled: LayoutSearch =
    search.best === null && incumbent.valid
      ? {
          best: incumbent,
          evaluatedLayouts: search.evaluatedLayouts + 1,
          exhausted: false,
        }
      : search;

  if (settled.exhausted) return { kind: "failed", reason: "search-limit-exhausted" };
  if (!settled.best) return { kind: "failed", reason: "no-valid-layout" };
  if (
    incumbent.valid &&
    settled.best.score < incumbent.score + PLACEMENT_LIMITS.improvementThreshold
  ) {
    return {
      kind: "unchanged",
      reason:
        settled.best.score === incumbent.score ? "already-safe" : "no-safe-improvement",
      diagnostics: diagnostics(incumbent, settled),
    };
  }
  return {
    kind: "changed",
    placements: settled.best.placements,
    diagnostics: diagnostics(incumbent, settled),
  };
}

function proposeSinglePass(
  scene: Scene,
  options: PlacementOptions | undefined,
): NaturalPlacementResult {
  return resolvePlacementSearch(
    evaluateCompleteLayout(scene, currentPlacements(scene), options),
    searchLayouts(scene, PLACEMENT_LIMITS, options),
  );
}

/**
 * The Scene the next fixed-point pass works from. Untouched objects are shared rather
 * than cloned: nothing in this module mutates a Scene it is handed.
 */
function sceneWithPlacements(
  scene: Scene,
  placements: readonly ProposedPlacement[],
): Scene {
  const byId = new Map(placements.map((placement) => [placement.objectId, placement]));
  return {
    ...scene,
    objects: scene.objects.map((object) => {
      const placement = byId.get(object.id);
      return placement ? withPlacement(object, placement) : object;
    }),
  };
}

function placementSignature(scene: Scene): string {
  return JSON.stringify(
    currentPlacements(scene).map(({ objectId, position, rotationY }) => [
      objectId,
      millimetres(position[0]),
      millimetres(position[2]),
      rotationY,
    ]),
  );
}

/**
 * Spec 8.1: the solver turns an object only through the rotations `options` allows for it,
 * and preserves the rotation of every object the table says nothing about.
 */
export function proposeNaturalPlacement(
  scene: Scene,
  options?: PlacementOptions,
): NaturalPlacementResult {
  if (
    !SceneSchema.safeParse(scene).success ||
    hasUnlockedUnknown(scene) ||
    hasDuplicateObjectIds(scene)
  ) {
    return { kind: "failed", reason: "invalid-input" };
  }

  const original = evaluateCompleteLayout(scene, currentPlacements(scene), options);
  let working = scene;
  let evaluatedLayouts = 0;
  let changed = false;
  const visited = new Set([placementSignature(scene)]);

  for (let pass = 0; pass < MAX_FIXED_POINT_PASSES; pass += 1) {
    const result = proposeSinglePass(working, options);
    if (result.kind === "failed") return result;
    evaluatedLayouts += result.diagnostics.evaluatedLayouts;
    if (result.kind === "unchanged") {
      if (!changed) return result;
      const placements = currentPlacements(working);
      const final = evaluateCompleteLayout(scene, placements, options);
      return {
        kind: "changed",
        placements,
        diagnostics: {
          currentScore: original.valid ? original.score : null,
          proposedScore: final.score,
          evaluatedLayouts,
        },
      };
    }

    changed = true;
    working = sceneWithPlacements(working, result.placements);
    const signature = placementSignature(working);
    if (visited.has(signature)) {
      return { kind: "failed", reason: "search-limit-exhausted" };
    }
    visited.add(signature);
  }

  return { kind: "failed", reason: "search-limit-exhausted" };
}

