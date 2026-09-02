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

function pointInsideFootprint(point: PointXZ, footprint: Footprint2D): boolean {
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

function inflated(footprint: Footprint2D): Footprint2D {
  return {
    ...footprint,
    halfWidth: footprint.halfWidth + PATH_RADIUS_METRES,
    halfDepth: footprint.halfDepth + PATH_RADIUS_METRES,
  };
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

function doorStartZones(scene: Scene): readonly OpeningClearanceZone[] {
  const doorZoneIds = new Set(
    scene.openings
      .filter((opening) => opening.kind === "door")
      .map((opening) => opening.id),
  );
  return openingClearanceZones(scene).filter(({ objectId }) =>
    doorZoneIds.has(objectId),
  );
}

function isEntryPoint(
  scene: Scene,
  point: PointXZ,
  startZones: readonly OpeningClearanceZone[],
): boolean {
  if (startZones.length > 0) {
    return startZones.some((zone) => pointInsideFootprint(point, zone));
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
  const startZones = doorStartZones(scene);
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
  const blocking = obstacles.map(inflated);
  return entryPoints.every((point) =>
    blocking.some((footprint) => pointInsideFootprint(point, footprint)),
  );
}

export function hasCirculationPath(
  scene: Scene,
  obstacles: readonly Footprint2D[],
  _traversableRugs: readonly SceneObject[],
): boolean {
  const columns = gridDimension(scene.room.width);
  const rows = gridDimension(scene.room.depth);
  const traversableRugIds = new Set(_traversableRugs.map((rug) => rug.id));
  const blockingFootprints = obstacles
    .filter(({ objectId }) => !traversableRugIds.has(objectId))
    .map(inflated);
  const cells = Array.from({ length: columns * rows }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const point = cellCenter(scene, column, row);
    return {
      point,
      blocked: blockingFootprints.some((footprint) =>
        pointInsideFootprint(point, footprint),
      ),
    };
  });
  const indexAt = (column: number, row: number) => row * columns + column;
  const openings = openingClearanceZones(scene);
  const startZones = doorStartZones(scene);
  const starts = cells.flatMap(({ point, blocked }, index) =>
    !blocked && isEntryPoint(scene, point, startZones) ? [index] : [],
  );

  if (starts.length === 0) return false;

  const visited = new Uint8Array(cells.length);
  const queue = [...starts];
  for (const start of starts) visited[start] = 1;

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    const column = current % columns;
    const row = Math.floor(current / columns);
    const neighbors: readonly [number, number][] = [
      [column, row - 1],
      [column + 1, row],
      [column, row + 1],
      [column - 1, row],
    ];

    for (const [neighborColumn, neighborRow] of neighbors) {
      if (
        neighborColumn < 0 ||
        neighborColumn >= columns ||
        neighborRow < 0 ||
        neighborRow >= rows
      ) {
        continue;
      }

      const neighbor = indexAt(neighborColumn, neighborRow);
      if (visited[neighbor] || cells[neighbor].blocked) continue;
      visited[neighbor] = 1;
      queue.push(neighbor);
    }
  }

  return openings.every((opening) =>
    cells.some(
      ({ point }, index) =>
        visited[index] === 1 && pointInsideFootprint(point, opening),
    ),
  );
}
