import {
  entryZonePoints,
  hasCirculationPath,
  occupiesEntryZone,
} from "./circulation";
import {
  footprintCorners,
  footprintInsideRoom,
  footprintsOverlap,
  objectFootprint,
  openingClearanceZones,
} from "./footprint-geometry";
import { PLACEMENT_LIMITS, PLACEMENT_SCORE_WEIGHTS } from "./placement-profile";
import type {
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

interface EvaluatedLayout {
  valid: boolean;
  score: number;
  placements: readonly ProposedPlacement[];
}

interface LayoutSearch {
  best: EvaluatedLayout | null;
  evaluatedLayouts: number;
  exhausted: boolean;
}

interface SearchState {
  placements: readonly ProposedPlacement[];
  candidateIndices: readonly number[];
  objectIds: readonly string[];
  score: number;
}

interface CandidateSet {
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
  side: PerimeterSide;
}

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
  return Object.is(quantized, -0) ? 0 : Number(quantized.toFixed(6));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function compareNumbers(first: readonly number[], second: readonly number[]): number {
  for (let index = 0; index < Math.min(first.length, second.length); index += 1) {
    const difference = first[index]! - second[index]!;
    if (difference !== 0) return difference;
  }
  return first.length - second.length;
}

function compareText(first: string, second: string): number {
  if (first < second) return -1;
  if (first > second) return 1;
  return 0;
}

function compareSearchStates(first: SearchState, second: SearchState): number {
  if (first.score !== second.score) return second.score - first.score;
  const candidateOrder = compareNumbers(first.candidateIndices, second.candidateIndices);
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
  return objects
    .filter((object) => object.type === type)
    .sort((first, second) => compareText(first.id, second.id))[0];
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

function objectIsInsideOpeningClearance(scene: Scene, object: SceneObject): boolean {
  const footprint = objectFootprint(object);
  return openingClearanceZones(scene).some((zone) => footprintsOverlap(footprint, zone));
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
  const firstProjections = footprintCorners(objectFootprint(first)).map((point) =>
    axisProjection(point, axis),
  );
  const secondProjections = footprintCorners(objectFootprint(second)).map((point) =>
    axisProjection(point, axis),
  );
  const firstMinimum = Math.min(...firstProjections);
  const firstMaximum = Math.max(...firstProjections);
  const secondMinimum = Math.min(...secondProjections);
  const secondMaximum = Math.max(...secondProjections);

  if (secondMinimum >= firstMaximum) return secondMinimum - firstMaximum;
  if (firstMinimum >= secondMaximum) return firstMinimum - secondMaximum;
  return -Math.min(firstMaximum, secondMaximum) + Math.max(firstMinimum, secondMinimum);
}

function footprintRadiusAlongAxis(object: SceneObject, axis: PointXZ): number {
  const centerProjection = axisProjection(objectFootprint(object).center, axis);
  return Math.max(
    ...footprintCorners(objectFootprint(object)).map((point) =>
      Math.abs(axisProjection(point, axis) - centerProjection),
    ),
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

function respectsHardConstraints(scene: Scene, objects: readonly SceneObject[]): boolean {
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

  const sofa = firstObject(objects, "sofa");
  const table = firstObject(objects, "coffee_table");
  if (sofa && table) {
    const gapMm = millimetres(tableEdgeGap(sofa, table));
    if (gapMm < 350 || gapMm > 550) return false;
  }

  const rug = firstObject(objects, "rug");
  if (
    rug &&
    table &&
    !pointInsideFootprint({ x: table.position[0], z: table.position[2] }, rug)
  ) {
    return false;
  }

  if (accessoryInsideSeatingHull(objects)) return false;

  const rugs = objects.filter(({ type }) => type === "rug");
  return hasCirculationPath(scene, objects.map(objectFootprint), rugs);
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

  const corners = footprintCorners(objectFootprint(sofa));
  const minimumX = Math.min(...corners.map(({ x }) => x));
  const maximumX = Math.max(...corners.map(({ x }) => x));
  const minimumZ = Math.min(...corners.map(({ z }) => z));
  const maximumZ = Math.max(...corners.map(({ z }) => z));
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

function accessoriesScore(scene: Scene, objects: readonly SceneObject[]): number {
  const accessories = objects.filter(
    ({ type }) => type === "floor_lamp" || type === "plant",
  );
  if (accessories.length === 0) return 1000;

  const total = accessories.reduce((sum, object) => {
    const corners = footprintCorners(objectFootprint(object));
    const minimumX = Math.min(...corners.map(({ x }) => x));
    const maximumX = Math.max(...corners.map(({ x }) => x));
    const minimumZ = Math.min(...corners.map(({ z }) => z));
    const maximumZ = Math.max(...corners.map(({ z }) => z));
    const perimeterGap = Math.min(
      Math.abs(minimumX + scene.room.width / 2),
      Math.abs(scene.room.width / 2 - maximumX),
      Math.abs(minimumZ + scene.room.depth / 2),
      Math.abs(scene.room.depth / 2 - maximumZ),
    );
    return sum + proximityScore(millimetres(perimeterGap), millimetres(PLACEMENT_LIMITS.roomInsetM), 800);
  }, 0);
  return Math.round(total / accessories.length);
}

function movementScore(
  scene: Scene,
  objects: readonly SceneObject[],
): number {
  const movable = objects.filter(({ locked, type }) => !locked && type !== "unknown");
  if (movable.length === 0) return 1000;

  const total = movable.reduce((sum, object) => {
    const original = scene.objects.find(({ id }) => id === object.id)!;
    const distanceMm = Math.hypot(
      millimetres(object.position[0] - original.position[0]),
      millimetres(object.position[2] - original.position[2]),
    );
    const rotationDelta = Math.abs(object.rotation[1] - original.rotation[1]);
    const normalizedRotation = Math.min(rotationDelta, Math.PI * 2 - rotationDelta);
    const movementMm = Math.round(distanceMm + normalizedRotation * 250);
    return sum + proximityScore(movementMm, 0, 1000);
  }, 0);
  return Math.round(total / movable.length);
}

function aggregateScore(
  scene: Scene,
  objects: readonly SceneObject[],
  includeCirculation: boolean,
): number {
  const rugs = objects.filter(({ type }) => type === "rug");
  const circulation =
    includeCirculation && hasCirculationPath(scene, objects.map(objectFootprint), rugs)
      ? 1000
      : 0;
  const terms = {
    circulation,
    sofaWallAndSide: sofaWallAndSideScore(scene, objects),
    tableRelation: tableRelationScore(objects),
    rugRelation: rugRelationScore(objects),
    chairRelation: chairRelationScore(objects),
    accessories: accessoriesScore(scene, objects),
    movement: movementScore(scene, objects),
  };

  return (Object.keys(PLACEMENT_SCORE_WEIGHTS) as (keyof typeof PLACEMENT_SCORE_WEIGHTS)[])
    .reduce(
      (score, term) =>
        score + Math.round((terms[term] * PLACEMENT_SCORE_WEIGHTS[term]) / 1000),
      0,
    );
}

function evaluateCompleteLayout(
  scene: Scene,
  placements: readonly ProposedPlacement[],
): EvaluatedLayout {
  const objects = layoutObjects(scene, placements);
  const valid = respectsHardConstraints(scene, objects);
  return {
    valid,
    score: aggregateScore(scene, objects, true),
    placements: placements.map((placement) => ({
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
): readonly PerimeterPoint[] {
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
    const corner = index === 0 ? "left" : index === xValues.length - 1 ? "right" : null;
    ring.push({ x, z: minimumZ, side: corner ? `back-${corner}` : "back" });
    ring.push({ x, z: maximumZ, side: corner ? `front-${corner}` : "front" });
  }
  for (let z = minimumZ + PLACEMENT_LIMITS.gridM; z < maximumZ - 1e-9; z += PLACEMENT_LIMITS.gridM) {
    const quantizedZ = quantize(z, PLACEMENT_LIMITS.gridM);
    ring.push({ x: minimumX, z: quantizedZ, side: "left" });
    ring.push({ x: maximumX, z: quantizedZ, side: "right" });
  }
  return ring;
}

/**
 * Reorders a coordinate-sorted wall so that every prefix still spans it: both ends
 * first, then the midpoint, then the quarter points. Taking the first n entries
 * therefore samples the whole wall instead of the run nearest one corner.
 */
function spreadOrder(
  points: readonly ProposedPlacement[],
): readonly ProposedPlacement[] {
  if (points.length <= 2) return points;
  const last = points.length - 1;
  const ordered: ProposedPlacement[] = [points[0]!, points[last]!];
  const taken = new Uint8Array(points.length);
  taken[0] = 1;
  taken[last] = 1;
  const segments: [number, number][] = [[0, last]];
  for (let head = 0; head < segments.length; head += 1) {
    const [low, high] = segments[head]!;
    if (high - low < 2) continue;
    const middle = low + Math.floor((high - low) / 2);
    if (!taken[middle]) {
      taken[middle] = 1;
      ordered.push(points[middle]!);
    }
    segments.push([low, middle], [middle, high]);
  }
  return ordered;
}

/**
 * Perimeter candidates for an accessory, aware of the partial layout it is joining.
 * Positions the settled obstacles already cover are dropped before the candidate cap
 * applies, and the survivors are drawn round-robin from every wall and corner, so the
 * cap can never be spent on the single arc nearest the object's current position.
 */
function accessoryCandidates(
  scene: Scene,
  object: SceneObject,
  obstacles: readonly SceneObject[],
): readonly ProposedPlacement[] {
  const rotationY = object.rotation[1];
  const blockers = obstacles
    .filter(({ id, type }) => id !== object.id && type !== "rug")
    .map(objectFootprint);
  const clearances = openingClearanceZones(scene);
  const isFree = (placement: ProposedPlacement): boolean => {
    const footprint = objectFootprint(withPlacement(object, placement));
    return (
      footprintInsideRoom(footprint, scene.room, PLACEMENT_LIMITS.roomInsetM) &&
      !clearances.some((zone) => footprintsOverlap(footprint, zone)) &&
      !blockers.some((blocker) => footprintsOverlap(footprint, blocker))
    );
  };

  const lanes = new Map<PerimeterSide, ProposedPlacement[]>(
    PERIMETER_SIDES.map((side) => [side, []]),
  );
  for (const point of perimeterRing(scene, object, rotationY)) {
    const placement = candidate(object, point.x, point.z, rotationY);
    if (isFree(placement)) lanes.get(point.side)!.push(placement);
  }

  const incumbent = placementFor(object);
  const result: ProposedPlacement[] = isFree(incumbent) ? [incumbent] : [];
  const spread = PERIMETER_SIDES.map((side) => spreadOrder(lanes.get(side)!));
  const deepest = spread.reduce((longest, lane) => Math.max(longest, lane.length), 0);
  for (let depth = 0; depth < deepest; depth += 1) {
    for (const lane of spread) {
      const placement = lane[depth];
      if (placement) result.push(placement);
    }
  }
  return result;
}

function uniqueCandidates(
  candidates: readonly ProposedPlacement[],
  limit: number,
): CandidateSet {
  const seen = new Set<string>();
  const unique: ProposedPlacement[] = [];
  let truncated = false;
  for (const placement of candidates) {
    const key = `${millimetres(placement.position[0])}:${millimetres(placement.position[2])}:${placement.rotationY}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (unique.length < limit) {
      unique.push(placement);
    } else {
      truncated = true;
      break;
    }
  }
  return { candidates: unique, truncated };
}

function candidatesFor(
  scene: Scene,
  object: SceneObject,
  placements: readonly ProposedPlacement[],
  placedIds: ReadonlySet<string>,
  limit: number,
): CandidateSet {
  const objects = layoutObjects(scene, placements);
  let candidates: readonly ProposedPlacement[];
  switch (object.type) {
    case "sofa":
      candidates = sofaCandidates(scene, object);
      break;
    case "rug":
      candidates = rugCandidates(scene, object, objects);
      break;
    case "coffee_table":
      candidates = tableCandidates(scene, object, objects);
      break;
    case "chair":
      candidates = chairCandidates(scene, object, objects);
      break;
    case "floor_lamp":
    case "plant":
      candidates = accessoryCandidates(
        scene,
        object,
        objects.filter(
          (other) =>
            other.locked || other.type === "unknown" || placedIds.has(other.id),
        ),
      );
      break;
    case "unknown":
      candidates = [];
      break;
  }
  return uniqueCandidates(candidates, limit);
}

function respectsPartialConstraints(
  scene: Scene,
  placements: readonly ProposedPlacement[],
  placedIds: ReadonlySet<string>,
): boolean {
  const objects = layoutObjects(scene, placements);
  const fixedOrPlaced = objects.filter(
    (object) => object.locked || object.type === "unknown" || placedIds.has(object.id),
  );
  for (const object of fixedOrPlaced) {
    if (
      placedIds.has(object.id) &&
      (!footprintInsideRoom(objectFootprint(object), scene.room, PLACEMENT_LIMITS.roomInsetM) ||
        objectIsInsideOpeningClearance(scene, object))
    ) {
      return false;
    }
  }
  const nonRugs = fixedOrPlaced.filter(({ type }) => type !== "rug");
  for (let first = 0; first < nonRugs.length; first += 1) {
    for (let second = first + 1; second < nonRugs.length; second += 1) {
      if (footprintsOverlap(objectFootprint(nonRugs[first]!), objectFootprint(nonRugs[second]!))) {
        return false;
      }
    }
  }
  if (accessoryInsideSeatingHull(fixedOrPlaced)) return false;
  return true;
}

function settledObstacles(
  scene: Scene,
  placements: readonly ProposedPlacement[],
  placedIds: ReadonlySet<string>,
): readonly SceneObject[] {
  return layoutObjects(scene, placements).filter(
    (object) =>
      object.locked || object.type === "unknown" || placedIds.has(object.id),
  );
}

/**
 * Hard-constraint rejections that are already decidable for a partial layout.
 * Both are monotone: the objects still to be placed can only add obstacles, so a
 * partial that fails here can never complete into a valid layout, and dropping
 * it frees a beam slot for a branch that still can.
 */
function partialBlocksEntryZone(
  entryPoints: readonly PointXZ[],
  obstacles: readonly SceneObject[],
): boolean {
  return occupiesEntryZone(
    entryPoints,
    obstacles
      .filter(({ type }) => type !== "rug")
      .map(objectFootprint),
  );
}

function partialBlocksCirculation(
  scene: Scene,
  obstacles: readonly SceneObject[],
): boolean {
  return !hasCirculationPath(
    scene,
    obstacles.map(objectFootprint),
    obstacles.filter(({ type }) => type === "rug"),
  );
}

/**
 * The current layout is itself a complete candidate. When the bounded search keeps no
 * valid layout of its own, a room that already satisfies the hard constraints still has
 * one answer to report, so exhaustion is never raised for a Scene that is already safe.
 */
function settledSearch(
  best: EvaluatedLayout | null,
  evaluatedLayouts: number,
  exhausted: boolean,
  incumbent: EvaluatedLayout,
): LayoutSearch {
  if (best !== null || !incumbent.valid) {
    return { best, evaluatedLayouts, exhausted };
  }
  return { best: incumbent, evaluatedLayouts: evaluatedLayouts + 1, exhausted: false };
}

function searchLayouts(
  scene: Scene,
  limits: typeof PLACEMENT_LIMITS,
  incumbent: EvaluatedLayout,
): LayoutSearch {
  const movable = scene.objects
    .filter(({ locked, type }) => !locked && type !== "unknown")
    .sort(compareObjects);
  let beam: SearchState[] = [
    { placements: [], candidateIndices: [], objectIds: [], score: 0 },
  ];
  let prunedByBeam = false;
  let truncatedCandidates = false;
  let evaluatedLayouts = 0;
  const entryPoints = entryZonePoints(scene);

  for (let objectIndex = 0; objectIndex < movable.length; objectIndex += 1) {
    const object = movable[objectIndex]!;
    const expanded: SearchState[] = [];
    for (const state of beam) {
      const placedIds = new Set(state.objectIds);
      const candidateSet = candidatesFor(
        scene,
        object,
        state.placements,
        placedIds,
        limits.candidatesPerObject,
      );
      if (candidateSet.truncated) truncatedCandidates = true;
      const objectIds = [...state.objectIds, object.id];
      const nextIds = new Set(objectIds);
      for (
        let candidateIndex = 0;
        candidateIndex < candidateSet.candidates.length;
        candidateIndex += 1
      ) {
        const placements = [...state.placements, candidateSet.candidates[candidateIndex]!];
        if (!respectsPartialConstraints(scene, placements, nextIds)) continue;
        const objects = layoutObjects(scene, placements);
        expanded.push({
          placements,
          candidateIndices: [...state.candidateIndices, candidateIndex],
          objectIds,
          score: aggregateScore(scene, objects, false),
        });
      }
    }

    expanded.sort(compareSearchStates);
    const kept: SearchState[] = [];
    let ranked = 0;
    for (; ranked < expanded.length && kept.length < limits.beamWidth; ranked += 1) {
      const state = expanded[ranked]!;
      const obstacles = settledObstacles(
        scene,
        state.placements,
        new Set(state.objectIds),
      );
      if (partialBlocksEntryZone(entryPoints, obstacles)) continue;
      if (objectIndex === 0 && partialBlocksCirculation(scene, obstacles)) {
        continue;
      }
      kept.push(state);
    }
    if (ranked < expanded.length) prunedByBeam = true;
    beam = kept;
    if (beam.length === 0) {
      return settledSearch(
        null,
        evaluatedLayouts,
        prunedByBeam || truncatedCandidates,
        incumbent,
      );
    }
  }

  let bestState: SearchState | null = null;
  let best: EvaluatedLayout | null = null;
  for (const state of beam) {
    evaluatedLayouts += 1;
    const evaluated = evaluateCompleteLayout(scene, state.placements);
    if (!evaluated.valid) continue;
    if (
      !best ||
      evaluated.score > best.score ||
      (evaluated.score === best.score && bestState && compareSearchStates(state, bestState) < 0)
    ) {
      best = evaluated;
      bestState = state;
    }
  }

  return settledSearch(
    best,
    evaluatedLayouts,
    best === null && (prunedByBeam || truncatedCandidates),
    incumbent,
  );
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

function proposeSinglePass(scene: Scene): NaturalPlacementResult {
  const current = evaluateCompleteLayout(scene, currentPlacements(scene));
  const search = searchLayouts(scene, PLACEMENT_LIMITS, current);
  if (search.exhausted) return { kind: "failed", reason: "search-limit-exhausted" };
  if (!search.best) return { kind: "failed", reason: "no-valid-layout" };
  if (
    current.valid &&
    search.best.score < current.score + PLACEMENT_LIMITS.improvementThreshold
  ) {
    return {
      kind: "unchanged",
      reason: search.best.score === current.score ? "already-safe" : "no-safe-improvement",
      diagnostics: diagnostics(current, search),
    };
  }
  return {
    kind: "changed",
    placements: search.best.placements,
    diagnostics: diagnostics(current, search),
  };
}

function sceneWithPlacements(
  scene: Scene,
  placements: readonly ProposedPlacement[],
): Scene {
  const next = structuredClone(scene);
  const byId = new Map(placements.map((placement) => [placement.objectId, placement]));
  for (const object of next.objects) {
    const placement = byId.get(object.id);
    if (!placement) continue;
    object.position = [...placement.position];
    object.rotation[1] = placement.rotationY;
  }
  return next;
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
