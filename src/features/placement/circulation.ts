import type { Scene, SceneObject } from "../scene/scene-schema";
import { openingClearanceZones } from "./footprint-geometry";
import type {
  Footprint2D,
  OpeningClearanceZone,
  PointXZ,
} from "./placement-types";

const GRID_METRES = 0.1;
const PATH_WIDTH_METRES = 0.75;
const PATH_RADIUS_METRES = PATH_WIDTH_METRES / 2;
const BOUND_EPSILON = 1e-9;

/**
 * A footprint prepared for repeated point tests: its rotation resolved once and a
 * world-axis bound that no contained point can fall outside. The bound only ever admits
 * extra cells, which are still decided by the exact local test, so it narrows the work
 * without changing an answer.
 */
interface OrientedBox {
  centerX: number;
  centerZ: number;
  halfWidth: number;
  halfDepth: number;
  cosine: number;
  sine: number;
  boundX: number;
  boundZ: number;
}

// Math.cos(0) and Math.sin(0) are exactly 1 and 0; skipping the call for the axis-aligned
// case (the overwhelming majority) keeps every result bit-for-bit the same.
function cosineOf(rotationY: number): number {
  return Object.is(rotationY, 0) ? 1 : Math.cos(rotationY);
}

function sineOf(rotationY: number): number {
  return Object.is(rotationY, 0) ? 0 : Math.sin(rotationY);
}

function orientedBox(footprint: Footprint2D, inflateM: number): OrientedBox {
  const cosine = cosineOf(footprint.rotationY);
  const sine = sineOf(footprint.rotationY);
  const halfWidth = footprint.halfWidth + inflateM;
  const halfDepth = footprint.halfDepth + inflateM;
  return {
    centerX: footprint.center.x,
    centerZ: footprint.center.z,
    halfWidth,
    halfDepth,
    cosine,
    sine,
    boundX:
      Math.abs(halfWidth * cosine) + Math.abs(halfDepth * sine) + BOUND_EPSILON,
    boundZ:
      Math.abs(halfWidth * sine) + Math.abs(halfDepth * cosine) + BOUND_EPSILON,
  };
}

function boxContains(box: OrientedBox, x: number, z: number): boolean {
  const deltaX = x - box.centerX;
  const deltaZ = z - box.centerZ;
  const localX = deltaX * box.cosine + deltaZ * box.sine;
  const localZ = -deltaX * box.sine + deltaZ * box.cosine;

  return (
    Math.abs(localX) <= box.halfWidth && Math.abs(localZ) <= box.halfDepth
  );
}

function gridDimension(lengthM: number) {
  return Math.floor(lengthM / GRID_METRES + 1e-9);
}

function cellCenter(scene: Scene, column: number, row: number): PointXZ {
  return {
    x: -scene.room.width / 2 + (column + 0.5) * GRID_METRES,
    z: -scene.room.depth / 2 + (row + 0.5) * GRID_METRES,
  };
}

/** Inclusive cell-index window the box can reach along one axis. */
function cellWindow(
  origin: number,
  center: number,
  bound: number,
  cells: number,
): { first: number; last: number } {
  return {
    first: Math.max(0, Math.floor((center - bound - origin) / GRID_METRES - 0.5)),
    last: Math.min(
      cells - 1,
      Math.ceil((center + bound - origin) / GRID_METRES - 0.5),
    ),
  };
}

function doorZones(
  scene: Scene,
  zones: readonly OpeningClearanceZone[],
): readonly OpeningClearanceZone[] {
  const doorZoneIds = new Set(
    scene.openings
      .filter((opening) => opening.kind === "door")
      .map((opening) => opening.id),
  );
  return zones.filter(({ objectId }) => doorZoneIds.has(objectId));
}

function doorStartZones(scene: Scene): readonly OpeningClearanceZone[] {
  return doorZones(scene, openingClearanceZones(scene));
}

/**
 * Grid scratch reused between calls. The flood fill is not reentrant and clears what it
 * uses, so sharing the buffers only removes an allocation per call.
 */
let blockedScratch = new Uint8Array(0);
let visitedScratch = new Uint8Array(0);
let queueScratch = new Int32Array(0);

function grids(cellCount: number) {
  if (blockedScratch.length < cellCount) {
    blockedScratch = new Uint8Array(cellCount);
    visitedScratch = new Uint8Array(cellCount);
    queueScratch = new Int32Array(cellCount);
  } else {
    blockedScratch.fill(0, 0, cellCount);
    visitedScratch.fill(0, 0, cellCount);
  }
  return { blocked: blockedScratch, visited: visitedScratch, queue: queueScratch };
}

function isEntryPoint(
  scene: Scene,
  point: PointXZ,
  startZones: readonly OrientedBox[],
): boolean {
  if (startZones.length > 0) {
    return startZones.some((zone) => boxContains(zone, point.x, point.z));
  }
  return (
    point.z >= scene.room.depth / 2 - GRID_METRES &&
    Math.abs(point.x) <= PATH_RADIUS_METRES
  );
}

/**
 * Occupancy-grid cell centers of the calibrated foreground entry zone: the door
 * clearance zones when the room has a door, otherwise the front-wall center
 * segment. These are the cells `hasCirculationPath` floods out from.
 */
export function entryZonePoints(scene: Scene): readonly PointXZ[] {
  const columns = gridDimension(scene.room.width);
  const rows = gridDimension(scene.room.depth);
  const startZones = doorStartZones(scene).map((zone) => orientedBox(zone, 0));
  const points: PointXZ[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const point = cellCenter(scene, column, row);
      if (isEntryPoint(scene, point, startZones)) points.push(point);
    }
  }

  return points;
}

/**
 * True when every entry cell is already inside an inflated obstacle, so no
 * 0.75m route can start. Adding obstacles can never reopen an occupied entry
 * zone, which makes this a sound early rejection for partial layouts.
 */
export function occupiesEntryZone(
  entryPoints: readonly PointXZ[],
  obstacles: readonly Footprint2D[],
): boolean {
  if (entryPoints.length === 0) return true;
  const blocking = obstacles.map((footprint) =>
    orientedBox(footprint, PATH_RADIUS_METRES),
  );
  return entryPoints.every((point) =>
    blocking.some((box) => boxContains(box, point.x, point.z)),
  );
}

export function hasCirculationPath(
  scene: Scene,
  obstacles: readonly Footprint2D[],
  _traversableRugs: readonly SceneObject[],
): boolean {
  const columns = gridDimension(scene.room.width);
  const rows = gridDimension(scene.room.depth);
  if (columns * rows === 0) return false;

  // The grid carries a permanently blocked one-cell border, so the flood needs no bounds
  // test and no row/column arithmetic per step.
  const stride = columns + 2;
  const cellCount = stride * (rows + 2);
  const originX = -scene.room.width / 2;
  const originZ = -scene.room.depth / 2;
  const { blocked, visited, queue } = grids(cellCount);
  blocked.fill(1, 0, stride);
  blocked.fill(1, cellCount - stride, cellCount);
  for (let row = 1; row <= rows; row += 1) {
    blocked[row * stride] = 1;
    blocked[row * stride + columns + 1] = 1;
  }

  const traversableRugIds = new Set(_traversableRugs.map((rug) => rug.id));
  for (const footprint of obstacles) {
    if (traversableRugIds.has(footprint.objectId)) continue;
    const box = orientedBox(footprint, PATH_RADIUS_METRES);
    const columnWindow = cellWindow(originX, box.centerX, box.boundX, columns);
    const rowWindow = cellWindow(originZ, box.centerZ, box.boundZ, rows);
    for (let row = rowWindow.first; row <= rowWindow.last; row += 1) {
      const z = originZ + (row + 0.5) * GRID_METRES;
      const rowOffset = (row + 1) * stride + 1;
      for (
        let column = columnWindow.first;
        column <= columnWindow.last;
        column += 1
      ) {
        const index = rowOffset + column;
        if (blocked[index] === 1) continue;
        if (boxContains(box, originX + (column + 0.5) * GRID_METRES, z)) {
          blocked[index] = 1;
        }
      }
    }
  }

  const zones = openingClearanceZones(scene);
  const startZones = doorZones(scene, zones).map((zone) => orientedBox(zone, 0));
  let tail = 0;
  const seed = (row: number, column: number) => {
    const index = (row + 1) * stride + column + 1;
    if (blocked[index] === 1 || visited[index] === 1) return;
    visited[index] = 1;
    queue[tail] = index;
    tail += 1;
  };

  if (startZones.length > 0) {
    for (const box of startZones) {
      const columnWindow = cellWindow(originX, box.centerX, box.boundX, columns);
      const rowWindow = cellWindow(originZ, box.centerZ, box.boundZ, rows);
      for (let row = rowWindow.first; row <= rowWindow.last; row += 1) {
        const z = originZ + (row + 0.5) * GRID_METRES;
        for (
          let column = columnWindow.first;
          column <= columnWindow.last;
          column += 1
        ) {
          if (boxContains(box, originX + (column + 0.5) * GRID_METRES, z)) {
            seed(row, column);
          }
        }
      }
    }
  } else {
    // The fallback ingress is the front-wall center segment: z rises with the row, so
    // the qualifying rows are the last ones.
    for (let row = rows - 1; row >= 0; row -= 1) {
      const z = originZ + (row + 0.5) * GRID_METRES;
      if (z < scene.room.depth / 2 - GRID_METRES) break;
      for (let column = 0; column < columns; column += 1) {
        const x = originX + (column + 0.5) * GRID_METRES;
        if (Math.abs(x) <= PATH_RADIUS_METRES) seed(row, column);
      }
    }
  }

  if (tail === 0) return false;
  // With no openings to reach, a usable entry cell is the whole question.
  if (zones.length === 0) return true;

  for (let head = 0; head < tail; head += 1) {
    const current = queue[head]!;
    let neighbor = current - stride;
    if (visited[neighbor] === 0 && blocked[neighbor] === 0) {
      visited[neighbor] = 1;
      queue[tail] = neighbor;
      tail += 1;
    }
    neighbor = current + 1;
    if (visited[neighbor] === 0 && blocked[neighbor] === 0) {
      visited[neighbor] = 1;
      queue[tail] = neighbor;
      tail += 1;
    }
    neighbor = current + stride;
    if (visited[neighbor] === 0 && blocked[neighbor] === 0) {
      visited[neighbor] = 1;
      queue[tail] = neighbor;
      tail += 1;
    }
    neighbor = current - 1;
    if (visited[neighbor] === 0 && blocked[neighbor] === 0) {
      visited[neighbor] = 1;
      queue[tail] = neighbor;
      tail += 1;
    }
  }

  return zones.every((opening) => {
    const box = orientedBox(opening, 0);
    const columnWindow = cellWindow(originX, box.centerX, box.boundX, columns);
    const rowWindow = cellWindow(originZ, box.centerZ, box.boundZ, rows);
    for (let row = rowWindow.first; row <= rowWindow.last; row += 1) {
      const z = originZ + (row + 0.5) * GRID_METRES;
      const rowOffset = (row + 1) * stride + 1;
      for (
        let column = columnWindow.first;
        column <= columnWindow.last;
        column += 1
      ) {
        if (visited[rowOffset + column] === 0) continue;
        if (boxContains(box, originX + (column + 0.5) * GRID_METRES, z)) {
          return true;
        }
      }
    }
    return false;
  });
}
