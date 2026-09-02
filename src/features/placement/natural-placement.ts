import { hasCirculationPath } from "./circulation";
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

const CATEGORY_ORDER: readonly SceneObjectType[] = [
  "sofa",
  "rug",
  "coffee_table",
  "chair",
  "floor_lamp",
  "plant",
];

const MILLIMETRES_PER_METRE = 1000;

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

function tableEdgeGap(sofa: SceneObject, table: SceneObject): number {
  const sofaCorners = footprintCorners(objectFootprint(sofa));
  const tableCorners = footprintCorners(objectFootprint(table));
  const sofaMinimumZ = Math.min(...sofaCorners.map(({ z }) => z));
  const sofaMaximumZ = Math.max(...sofaCorners.map(({ z }) => z));
  const tableMinimumZ = Math.min(...tableCorners.map(({ z }) => z));
  const tableMaximumZ = Math.max(...tableCorners.map(({ z }) => z));

  if (tableMinimumZ >= sofaMaximumZ) return tableMinimumZ - sofaMaximumZ;
  if (sofaMinimumZ >= tableMaximumZ) return sofaMinimumZ - tableMaximumZ;
  return -Math.min(sofaMaximumZ, tableMaximumZ) + Math.max(sofaMinimumZ, tableMinimumZ);
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
  const minimumZ = Math.min(...corners.map(({ z }) => z));
  const maximumZ = Math.max(...corners.map(({ z }) => z));
  const wallGap = Math.min(
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
  const gap = proximityScore(millimetres(tableEdgeGap(sofa, table)), 450, 450);
  const alignment = proximityScore(
    millimetres(Math.abs(table.position[0] - sofa.position[0])),
    600,
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

  const direction = Math.sign(table.position[2] - sofa.position[2]) || 1;
  const opposite = Math.sign(chair.position[2] - table.position[2]) === direction ? 1000 : 0;
  const lateral = proximityScore(
    millimetres(Math.abs(chair.position[0] - table.position[0])),
    0,
    1400,
  );
  return Math.round((opposite * 7 + lateral * 3) / 10);
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
  for (const rotationY of [0, Math.PI] as const) {
    const range = usableCenterRange(scene, object, rotationY);
    const [minimumX, maximumX] = inwardGridRange(range.minimumX, range.maximumX, PLACEMENT_LIMITS.gridM);
    const [minimumZ, maximumZ] = inwardGridRange(range.minimumZ, range.maximumZ, PLACEMENT_LIMITS.gridM);
    const z = rotationY === 0 ? minimumZ : maximumZ;
    const xValues: number[] = [];
    for (let x = minimumX; x <= maximumX + 1e-9; x += PLACEMENT_LIMITS.gridM) {
      const quantizedX = quantize(x, PLACEMENT_LIMITS.gridM);
      if (Math.sign(quantizedX) === sign) xValues.push(quantizedX);
    }
    xValues.sort((first, second) =>
      Math.abs(first - object.position[0]) - Math.abs(second - object.position[0]) ||
      first - second,
    );
    for (const x of xValues) result.push(candidate(object, x, z, rotationY));
  }
  return result;
}

function idealTablePosition(
  scene: Scene,
  objects: readonly SceneObject[],
): { x: number; z: number } | null {
  const sofa = firstObject(objects, "sofa");
  const table = firstObject(objects, "coffee_table");
  if (!sofa || !table) return null;
  const direction = sofa.position[2] <= 0 ? 1 : -1;
  const xOffset = Math.sign(sofa.position[0]) <= 0 ? 0.7 : -0.7;
  const range = usableCenterRange(scene, table, table.rotation[1]);
  return {
    x: quantize(clamp(sofa.position[0] + xOffset, range.minimumX, range.maximumX), PLACEMENT_LIMITS.gridM),
    z: quantize(
      clamp(
        sofa.position[2] +
          direction *
            (sofa.dimensionsM.depth / 2 + table.dimensionsM.depth / 2 + 0.45),
        range.minimumZ,
        range.maximumZ,
      ),
      PLACEMENT_LIMITS.gridM,
    ),
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
  const range = usableCenterRange(scene, object, 0);
  for (const deltaZ of [0, -0.1, 0.1, -0.2, 0.2]) {
    for (const deltaX of [0, -0.1, 0.1, -0.2, 0.2]) {
      result.push(
        candidate(
          object,
          quantize(clamp(target.x + deltaX, range.minimumX, range.maximumX), PLACEMENT_LIMITS.gridM),
          quantize(clamp(target.z + deltaZ, range.minimumZ, range.maximumZ), PLACEMENT_LIMITS.gridM),
          0,
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
  const direction = sofa.position[2] <= 0 ? 1 : -1;
  const range = usableCenterRange(scene, object, 0);
  for (const gap of [0.45, 0.4, 0.5, 0.35, 0.55]) {
    const z = quantize(
      sofa.position[2] +
        direction *
          (sofa.dimensionsM.depth / 2 + object.dimensionsM.depth / 2 + gap),
      PLACEMENT_LIMITS.gridM,
    );
    if (z < range.minimumZ || z > range.maximumZ) continue;
    for (const deltaX of [0, -0.1, 0.1, -0.2, 0.2, -0.3, 0.3]) {
      const x = quantize(clamp(ideal.x + deltaX, range.minimumX, range.maximumX), PLACEMENT_LIMITS.gridM);
      const proposed = withPlacement(object, candidate(object, x, z, 0));
      const gapMm = millimetres(tableEdgeGap(sofa, proposed));
      if (gapMm >= 350 && gapMm <= 550) result.push(candidate(object, x, z, 0));
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
  const direction = Math.sign(table.position[2] - sofa.position[2]) || 1;
  const range = usableCenterRange(scene, object, sofa.rotation[1] + Math.PI);
  for (const gap of [0.4, 0.5, 0.6, 0.7]) {
    const z = quantize(
      table.position[2] +
        direction *
          (table.dimensionsM.depth / 2 + object.dimensionsM.depth / 2 + gap),
      PLACEMENT_LIMITS.gridM,
    );
    if (z < range.minimumZ || z > range.maximumZ) continue;
    for (const deltaX of [0, -0.1, 0.1, -0.2, 0.2]) {
      result.push(
        candidate(
          object,
          quantize(clamp(table.position[0] + deltaX, range.minimumX, range.maximumX), PLACEMENT_LIMITS.gridM),
          z,
          sofa.rotation[1] + Math.PI,
        ),
      );
    }
  }
  return result;
}

function accessoryCandidates(scene: Scene, object: SceneObject): readonly ProposedPlacement[] {
  const result: ProposedPlacement[] = [placementFor(object)];
  const range = usableCenterRange(scene, object, 0);
  const [minimumX, maximumX] = inwardGridRange(range.minimumX, range.maximumX, PLACEMENT_LIMITS.gridM);
  const [minimumZ, maximumZ] = inwardGridRange(range.minimumZ, range.maximumZ, PLACEMENT_LIMITS.gridM);
  const perimeter: { x: number; z: number }[] = [];

  for (let x = minimumX; x <= maximumX + 1e-9; x += PLACEMENT_LIMITS.gridM) {
    perimeter.push({ x: quantize(x, PLACEMENT_LIMITS.gridM), z: minimumZ });
    perimeter.push({ x: quantize(x, PLACEMENT_LIMITS.gridM), z: maximumZ });
  }
  for (let z = minimumZ + PLACEMENT_LIMITS.gridM; z < maximumZ - 1e-9; z += PLACEMENT_LIMITS.gridM) {
    perimeter.push({ x: minimumX, z: quantize(z, PLACEMENT_LIMITS.gridM) });
    perimeter.push({ x: maximumX, z: quantize(z, PLACEMENT_LIMITS.gridM) });
  }
  perimeter.sort(
    (first, second) =>
      Math.hypot(first.x - object.position[0], first.z - object.position[2]) -
        Math.hypot(second.x - object.position[0], second.z - object.position[2]) ||
      first.z - second.z ||
      first.x - second.x,
  );
  for (const point of perimeter) result.push(candidate(object, point.x, point.z, 0));
  return result;
}

function uniqueCandidates(
  candidates: readonly ProposedPlacement[],
  limit: number,
): readonly ProposedPlacement[] {
  const seen = new Set<string>();
  const unique: ProposedPlacement[] = [];
  for (const placement of candidates) {
    const key = `${millimetres(placement.position[0])}:${millimetres(placement.position[2])}:${placement.rotationY}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(placement);
    if (unique.length === limit) break;
  }
  return unique;
}

function candidatesFor(
  scene: Scene,
  object: SceneObject,
  placements: readonly ProposedPlacement[],
  limit: number,
): readonly ProposedPlacement[] {
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
      candidates = accessoryCandidates(scene, object);
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
  return true;
}

function searchLayouts(
  scene: Scene,
  limits: typeof PLACEMENT_LIMITS,
): LayoutSearch {
  const movable = scene.objects
    .filter(({ locked, type }) => !locked && type !== "unknown")
    .sort(compareObjects);
  let beam: SearchState[] = [
    { placements: [], candidateIndices: [], objectIds: [], score: 0 },
  ];
  let prunedByBeam = false;
  let evaluatedLayouts = 0;

  for (let objectIndex = 0; objectIndex < movable.length; objectIndex += 1) {
    const object = movable[objectIndex]!;
    const expanded: SearchState[] = [];
    for (const state of beam) {
      const candidates = candidatesFor(
        scene,
        object,
        state.placements,
        limits.candidatesPerObject,
      );
      for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
        const placements = [...state.placements, candidates[candidateIndex]!];
        const objectIds = [...state.objectIds, object.id];
        if (!respectsPartialConstraints(scene, placements, new Set(objectIds))) continue;
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
    if (expanded.length > limits.beamWidth) prunedByBeam = true;
    beam = expanded.slice(0, limits.beamWidth);
    if (beam.length === 0) {
      return { best: null, evaluatedLayouts, exhausted: prunedByBeam };
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

  return {
    best,
    evaluatedLayouts,
    exhausted: best === null && prunedByBeam,
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

export function proposeNaturalPlacement(scene: Scene): NaturalPlacementResult {
  if (!SceneSchema.safeParse(scene).success || hasUnlockedUnknown(scene)) {
    return { kind: "failed", reason: "invalid-input" };
  }
  const current = evaluateCompleteLayout(scene, currentPlacements(scene));
  const search = searchLayouts(scene, PLACEMENT_LIMITS);
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
