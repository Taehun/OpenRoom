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
  PointXZ,
  ProposedPlacement,
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
  "plant",
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
    .filter(({ type }) => type === "floor_lamp" || type === "plant")
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

  return respectsSeatingRelations(objects) && !accessoryInsideSeatingHull(objects) && circulates;
}

/**
 * The two relations only a complete layout can settle: the sofa-to-table gap and the rug
 * holding the table. Neither is decidable while either object is still unplaced, so they
 * stay out of the partial checks.
 */
function respectsSeatingRelations(objects: readonly SceneObject[]): boolean {
  const sofa = firstObject(objects, "sofa");
  const table = firstObject(objects, "coffee_table");
  if (sofa && table) {
    const gapMm = millimetres(tableEdgeGap(sofa, table));
    if (gapMm < 350 || gapMm > 550) return false;
  }

  const rug = firstObject(objects, "rug");
  return !(
    rug &&
    table &&
    !pointInsideFootprint({ x: table.position[0], z: table.position[2] }, rug)
  );
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

function chairRelationScore(objects: readonly SceneObject[]): number {
  const sofa = firstObject(objects, "sofa");
  const table = firstObject(objects, "coffee_table");
  const chair = firstObject(objects, "chair");
  if (!sofa || !table || !chair) return 1000;
  const { forward, lateral: lateralAxis } = localAxes(sofa.rotation[1]);
  const tableDirection = Math.sign(
    axisProjection(
      {
        x: table.position[0] - sofa.position[0],
        z: table.position[2] - sofa.position[2],
      },
      forward,
    ),
  ) || 1;
  const chairDirection = Math.sign(
    axisProjection(
      {
        x: chair.position[0] - table.position[0],
        z: chair.position[2] - table.position[2],
      },
      forward,
    ),
  );
  const opposite = chairDirection === tableDirection ? 1000 : 0;
  const lateralScore = proximityScore(
    millimetres(
      Math.abs(
        axisProjection(
          {
            x: chair.position[0] - table.position[0],
            z: chair.position[2] - table.position[2],
          },
          lateralAxis,
        ),
      ),
    ),
    0,
    1400,
  );
  return Math.round((opposite * 7 + lateralScore * 3) / 10);
}

function isAccessory({ type }: SceneObject): boolean {
  return type === "floor_lamp" || type === "plant";
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
const TERM_COUNT = 6;

const TERM_WEIGHTS: readonly number[] = [
  PLACEMENT_SCORE_WEIGHTS.sofaWallAndSide,
  PLACEMENT_SCORE_WEIGHTS.tableRelation,
  PLACEMENT_SCORE_WEIGHTS.rugRelation,
  PLACEMENT_SCORE_WEIGHTS.chairRelation,
  PLACEMENT_SCORE_WEIGHTS.accessories,
  PLACEMENT_SCORE_WEIGHTS.movement,
];

const TERM_SCORERS: readonly ((
  scene: Scene,
  objects: readonly SceneObject[],
) => number)[] = [
  sofaWallAndSideScore,
  (_scene, objects) => tableRelationScore(objects),
  (_scene, objects) => rugRelationScore(objects),
  (_scene, objects) => chairRelationScore(objects),
  accessoriesScore,
  movementScore,
];

function layoutTerms(scene: Scene, objects: readonly SceneObject[]): TermScores {
  const terms = new Int32Array(TERM_COUNT);
  for (let term = 0; term < TERM_COUNT; term += 1) {
    terms[term] = TERM_SCORERS[term]!(scene, objects);
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
): number {
  return weightedScore(layoutTerms(scene, objects), circulation);
}

/**
 * Which relational terms a newly placed object can move. The averaged accessories and
 * movement terms are kept as running totals instead, so they are absent here.
 */
const TERM_DEPENDENCIES: Readonly<Record<SceneObjectType, readonly number[]>> = {
  sofa: [TERM_SOFA_WALL, TERM_TABLE, TERM_RUG, TERM_CHAIR],
  rug: [TERM_RUG],
  coffee_table: [TERM_TABLE, TERM_RUG, TERM_CHAIR],
  chair: [TERM_CHAIR],
  floor_lamp: [],
  plant: [],
  unknown: [],
};

function evaluateCompleteLayout(
  scene: Scene,
  placements: readonly ProposedPlacement[],
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
    score: aggregateScore(scene, objects, circulates ? 1000 : 0),
    placements: placements.map((placement) => ({
      ...placement,
      position: [...placement.position],
    })),
  };
}

/**
 * A completed beam state has already satisfied every partial constraint for every object
 * it settled - room bounds, clearance, footprint pairs and the seating hull - and its
 * score terms were kept equal to the full layout's throughout. All that is left of the
 * hard constraints is what a partial cannot decide, so the state is finished rather than
 * re-derived from scratch.
 */
function evaluateSettledState(scene: Scene, state: SearchState): EvaluatedLayout {
  const objects = layoutOf(state);
  // The score of an invalid layout is never read, so the flood fill is only worth running
  // once the cheap relations have accepted the layout.
  const circulates =
    respectsSeatingRelations(objects) &&
    hasCirculationPath(
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

function sofaCandidates(scene: Scene, object: SceneObject): readonly ProposedPlacement[] {
  const result: ProposedPlacement[] = [placementFor(object)];
  const sign = Math.sign(object.position[0]) || -1;
  const rotationY = object.rotation[1];
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
  const xValues: number[] = [];
  for (let x = minimumX; x <= maximumX + 1e-9; x += PLACEMENT_LIMITS.gridM) {
    const quantizedX = quantize(x, PLACEMENT_LIMITS.gridM);
    if (Math.sign(quantizedX) === sign) xValues.push(quantizedX);
  }
  xValues.sort((first, second) =>
    Math.abs(first - object.position[0]) - Math.abs(second - object.position[0]) ||
    first - second,
  );
  for (const z of [minimumZ, maximumZ]) {
    for (const x of xValues) result.push(candidate(object, x, z, rotationY));
  }
  return result;
}

function idealTablePosition(
  scene: Scene,
  objects: readonly SceneObject[],
): { x: number; z: number; rotationY: number; forwardSign: number } | null {
  const sofa = firstObject(objects, "sofa");
  const table = firstObject(objects, "coffee_table");
  if (!sofa || !table) return null;
  const { forward } = localAxes(sofa.rotation[1]);
  const towardRoomCenter = axisProjection(
    { x: -sofa.position[0], z: -sofa.position[2] },
    forward,
  );
  const forwardSign = towardRoomCenter >= 0 ? 1 : -1;
  const rotationY = table.rotation[1];
  const range = usableCenterRange(scene, table, rotationY);
  const distance =
    footprintRadiusAlongAxis(sofa, forward) +
    footprintRadiusAlongAxis(table, forward) +
    0.45;
  return {
    x: quantize(
      clamp(
        sofa.position[0] + forward.x * forwardSign * distance,
        range.minimumX,
        range.maximumX,
      ),
      PLACEMENT_LIMITS.gridM,
    ),
    z: quantize(
      clamp(
        sofa.position[2] + forward.z * forwardSign * distance,
        range.minimumZ,
        range.maximumZ,
      ),
      PLACEMENT_LIMITS.gridM,
    ),
    rotationY,
    forwardSign,
  };
}

function rugCandidates(
  scene: Scene,
  object: SceneObject,
  objects: readonly SceneObject[],
): readonly ProposedPlacement[] {
  const result: ProposedPlacement[] = [placementFor(object)];
  const ideal = idealTablePosition(scene, objects);
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
): readonly ProposedPlacement[] {
  const result: ProposedPlacement[] = [placementFor(object)];
  const sofa = firstObject(objects, "sofa");
  const ideal = idealTablePosition(scene, objects);
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
          sofa.position[0] +
            forward.x * ideal.forwardSign * distance +
            lateral.x * deltaX,
          range.minimumX,
          range.maximumX,
        ),
        PLACEMENT_LIMITS.gridM,
      );
      const z = quantize(
        clamp(
          sofa.position[2] +
            forward.z * ideal.forwardSign * distance +
            lateral.z * deltaX,
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

function chairCandidates(
  scene: Scene,
  object: SceneObject,
  objects: readonly SceneObject[],
): readonly ProposedPlacement[] {
  const result: ProposedPlacement[] = [placementFor(object)];
  const sofa = firstObject(objects, "sofa");
  const table = firstObject(objects, "coffee_table");
  if (!sofa || !table) return result;
  const { forward, lateral } = localAxes(sofa.rotation[1]);
  const direction = Math.sign(
    axisProjection(
      {
        x: table.position[0] - sofa.position[0],
        z: table.position[2] - sofa.position[2],
      },
      forward,
    ),
  ) || 1;
  const rotationY = object.rotation[1];
  const range = usableCenterRange(scene, object, rotationY);
  for (const gap of [0.4, 0.5, 0.6, 0.7]) {
    for (const deltaX of [0, -0.1, 0.1, -0.2, 0.2]) {
      const distance =
        footprintRadiusAlongAxis(table, forward) +
        footprintRadiusAlongAxis(object, forward) +
        gap;
      const x = quantize(
        clamp(
          table.position[0] + forward.x * direction * distance + lateral.x * deltaX,
          range.minimumX,
          range.maximumX,
        ),
        PLACEMENT_LIMITS.gridM,
      );
      const z = quantize(
        clamp(
          table.position[2] + forward.z * direction * distance + lateral.z * deltaX,
          range.minimumZ,
          range.maximumZ,
        ),
        PLACEMENT_LIMITS.gridM,
      );
      result.push(
        candidate(
          object,
          x,
          z,
          rotationY,
        ),
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

function accessoryCandidates(
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
): CandidateSet {
  let candidates: readonly ProposedPlacement[];
  switch (object.type) {
    case "sofa":
      candidates = sofaCandidates(scene, object);
      break;
    case "rug":
      candidates = rugCandidates(scene, object, layoutOf(state));
      break;
    case "coffee_table":
      candidates = tableCandidates(scene, object, layoutOf(state));
      break;
    case "chair":
      candidates = chairCandidates(scene, object, layoutOf(state));
      break;
    case "floor_lamp":
    case "plant":
      return accessoryCandidates(object, state, accessory!, limit);
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
    (object) => isAccessory(object) && pointInsideConvexHull(objectCenter(object), hull),
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
      isAccessory(object) &&
      pointInsideConvexHull(footprint.center, seatingHull(state))
    );
  }

  const settledAccessories = settledOf(state).filter(isAccessory);
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
  const baseTerms = layoutTerms(scene, scene.objects);
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
    const affected = TERM_DEPENDENCIES[object.type];
    const expanded: SearchState[] = [];
    for (const state of beam) {
      const candidateSet = candidatesFor(
        scene,
        object,
        state,
        accessory,
        limits.candidatesPerObject,
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
            terms[term] = TERM_SCORERS[term]!(scene, patched);
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

        expanded.push({
          candidateIndex,
          objectIds,
          score: weightedScore(terms, 0),
          terms,
          movementTotal,
          accessoryTotal,
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
        ? evaluateCompleteLayout(scene, placementsOf(state))
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

function proposeSinglePass(scene: Scene): NaturalPlacementResult {
  return resolvePlacementSearch(
    evaluateCompleteLayout(scene, currentPlacements(scene)),
    searchLayouts(scene, PLACEMENT_LIMITS),
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

export function proposeNaturalPlacement(scene: Scene): NaturalPlacementResult {
  if (
    !SceneSchema.safeParse(scene).success ||
    hasUnlockedUnknown(scene) ||
    hasDuplicateObjectIds(scene)
  ) {
    return { kind: "failed", reason: "invalid-input" };
  }

  const original = evaluateCompleteLayout(scene, currentPlacements(scene));
  let working = scene;
  let evaluatedLayouts = 0;
  let changed = false;
  const visited = new Set([placementSignature(scene)]);

  for (let pass = 0; pass < MAX_FIXED_POINT_PASSES; pass += 1) {
    const result = proposeSinglePass(working);
    if (result.kind === "failed") return result;
    evaluatedLayouts += result.diagnostics.evaluatedLayouts;
    if (result.kind === "unchanged") {
      if (!changed) return result;
      const placements = currentPlacements(working);
      const final = evaluateCompleteLayout(scene, placements);
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
