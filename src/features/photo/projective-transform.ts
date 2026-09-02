import type { NormalizedQuad } from "./photo-assets";

const NUMERICAL_TOLERANCE = 1e-9;

export interface PixelPoint {
  x: number;
  y: number;
}

export type ProjectiveTransform = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  1,
];

type FourPoints = readonly [PixelPoint, PixelPoint, PixelPoint, PixelPoint];

function cross(first: PixelPoint, second: PixelPoint, third: PixelPoint) {
  return (
    (second.x - first.x) * (third.y - first.y) -
    (second.y - first.y) * (third.x - first.x)
  );
}

function pointOnSegment(
  point: PixelPoint,
  start: PixelPoint,
  end: PixelPoint,
) {
  return (
    point.x >= Math.min(start.x, end.x) - NUMERICAL_TOLERANCE &&
    point.x <= Math.max(start.x, end.x) + NUMERICAL_TOLERANCE &&
    point.y >= Math.min(start.y, end.y) - NUMERICAL_TOLERANCE &&
    point.y <= Math.max(start.y, end.y) + NUMERICAL_TOLERANCE
  );
}

function segmentsIntersect(
  firstStart: PixelPoint,
  firstEnd: PixelPoint,
  secondStart: PixelPoint,
  secondEnd: PixelPoint,
) {
  const firstToSecondStart = cross(firstStart, firstEnd, secondStart);
  const firstToSecondEnd = cross(firstStart, firstEnd, secondEnd);
  const secondToFirstStart = cross(secondStart, secondEnd, firstStart);
  const secondToFirstEnd = cross(secondStart, secondEnd, firstEnd);

  if (
    firstToSecondStart * firstToSecondEnd < 0 &&
    secondToFirstStart * secondToFirstEnd < 0
  ) {
    return true;
  }

  return (
    (Math.abs(firstToSecondStart) < NUMERICAL_TOLERANCE &&
      pointOnSegment(secondStart, firstStart, firstEnd)) ||
    (Math.abs(firstToSecondEnd) < NUMERICAL_TOLERANCE &&
      pointOnSegment(secondEnd, firstStart, firstEnd)) ||
    (Math.abs(secondToFirstStart) < NUMERICAL_TOLERANCE &&
      pointOnSegment(firstStart, secondStart, secondEnd)) ||
    (Math.abs(secondToFirstEnd) < NUMERICAL_TOLERANCE &&
      pointOnSegment(firstEnd, secondStart, secondEnd))
  );
}

export function isValidFloorQuad(quad: NormalizedQuad): boolean {
  if (
    quad.length !== 4 ||
    quad.some(
      ({ x, y }) =>
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < 0 ||
        x > 1 ||
        y < 0 ||
        y > 1,
    )
  ) {
    return false;
  }

  if (
    segmentsIntersect(quad[0], quad[1], quad[2], quad[3]) ||
    segmentsIntersect(quad[1], quad[2], quad[3], quad[0])
  ) {
    return false;
  }

  for (let index = 0; index < quad.length; index += 1) {
    if (
      cross(
        quad[index]!,
        quad[(index + 1) % quad.length]!,
        quad[(index + 2) % quad.length]!,
      ) <= NUMERICAL_TOLERANCE
    ) {
      return false;
    }
  }

  return true;
}

function allFinite(points: FourPoints) {
  return points.every(
    ({ x, y }) => Number.isFinite(x) && Number.isFinite(y),
  );
}

export function solveProjectiveTransform(
  source: FourPoints,
  destination: FourPoints,
): ProjectiveTransform | null {
  if (!allFinite(source) || !allFinite(destination)) return null;

  const matrix: number[][] = [];
  for (let index = 0; index < source.length; index += 1) {
    const { x, y } = source[index]!;
    const { x: destinationX, y: destinationY } = destination[index]!;
    matrix.push(
      [x, y, 1, 0, 0, 0, -destinationX * x, -destinationX * y, destinationX],
      [0, 0, 0, x, y, 1, -destinationY * x, -destinationY * y, destinationY],
    );
  }

  for (let column = 0; column < 8; column += 1) {
    let pivotRow = column;
    let pivotMagnitude = Math.abs(matrix[pivotRow]![column]!);
    for (let row = column + 1; row < 8; row += 1) {
      const candidateMagnitude = Math.abs(matrix[row]![column]!);
      if (candidateMagnitude > pivotMagnitude) {
        pivotRow = row;
        pivotMagnitude = candidateMagnitude;
      }
    }
    if (
      !Number.isFinite(pivotMagnitude) ||
      pivotMagnitude < NUMERICAL_TOLERANCE
    ) {
      return null;
    }

    if (pivotRow !== column) {
      [matrix[column], matrix[pivotRow]] = [matrix[pivotRow]!, matrix[column]!];
    }

    const pivot = matrix[column]![column]!;
    for (let row = column + 1; row < 8; row += 1) {
      const factor = matrix[row]![column]! / pivot;
      matrix[row]![column] = 0;
      for (let entry = column + 1; entry <= 8; entry += 1) {
        const value = matrix[row]![entry]! - factor * matrix[column]![entry]!;
        if (!Number.isFinite(value)) return null;
        matrix[row]![entry] = value;
      }
    }
  }

  const solution = Array<number>(8).fill(0);
  for (let row = 7; row >= 0; row -= 1) {
    const pivot = matrix[row]![row]!;
    if (!Number.isFinite(pivot) || Math.abs(pivot) < NUMERICAL_TOLERANCE) {
      return null;
    }
    let value = matrix[row]![8]!;
    for (let column = row + 1; column < 8; column += 1) {
      value -= matrix[row]![column]! * solution[column]!;
    }
    solution[row] = value / pivot;
    if (!Number.isFinite(solution[row])) return null;
  }

  const transform: ProjectiveTransform = [
    solution[0]!,
    solution[1]!,
    solution[2]!,
    solution[3]!,
    solution[4]!,
    solution[5]!,
    solution[6]!,
    solution[7]!,
    1,
  ];
  if (
    source.some(
      ({ x, y }) =>
        Math.abs(transform[6] * x + transform[7] * y + 1) <
        NUMERICAL_TOLERANCE,
    )
  ) {
    return null;
  }

  return transform;
}

export function applyProjectiveTransform(
  transform: ProjectiveTransform,
  point: PixelPoint,
): PixelPoint {
  const denominator = transform[6] * point.x + transform[7] * point.y + 1;
  if (
    !Number.isFinite(denominator) ||
    Math.abs(denominator) < NUMERICAL_TOLERANCE
  ) {
    return { x: Number.NaN, y: Number.NaN };
  }
  return {
    x:
      (transform[0] * point.x + transform[1] * point.y + transform[2]) /
      denominator,
    y:
      (transform[3] * point.x + transform[4] * point.y + transform[5]) /
      denominator,
  };
}

export function projectiveTransformCss(transform: ProjectiveTransform): string {
  const values = [
    transform[0], transform[3], 0, transform[6],
    transform[1], transform[4], 0, transform[7],
    0, 0, 1, 0,
    transform[2], transform[5], 0, 1,
  ];
  return `matrix3d(${values.join(", ")})`;
}
