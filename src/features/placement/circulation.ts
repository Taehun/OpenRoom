import type { Scene, SceneObject } from "../scene/scene-schema";
import { openingClearanceZones } from "./footprint-geometry";
import type { Footprint2D, PointXZ } from "./placement-types";

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
  const doorZoneIds = new Set(
    scene.openings
      .filter((opening) => opening.kind === "door")
      .map((opening) => opening.id),
  );
  const startZones = openings.filter(({ objectId }) => doorZoneIds.has(objectId));
  const starts = cells.flatMap(({ point, blocked }, index) => {
    if (blocked) return [];
    const startsAtDoor = startZones.some((zone) =>
      pointInsideFootprint(point, zone),
    );
    const startsAtFrontCenter =
      startZones.length === 0 &&
      point.z >= scene.room.depth / 2 - GRID_METRES &&
      Math.abs(point.x) <= PATH_RADIUS_METRES;
    return startsAtDoor || startsAtFrontCenter ? [index] : [];
  });

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
