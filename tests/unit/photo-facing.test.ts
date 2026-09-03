import { describe, expect, it } from "vitest";
import {
  FRONT_VECTORS,
  angleBetweenDegrees,
  facingOf,
  normalizeFacing,
  rotationYOf,
  roundFacing,
} from "../../src/features/photo/photo-facing";

describe("facing math", () => {
  it("faces the camera side at rotation 0", () => {
    expect(facingOf(0)).toEqual({ x: -0, z: 1 });
  });

  it("round-trips every 45° step through rotationYOf", () => {
    for (let k = -3; k <= 4; k += 1) {
      const yaw = (k * Math.PI) / 4;
      expect(rotationYOf(facingOf(yaw))).toBeCloseTo(yaw, 12);
    }
  });

  it("normalises rotationYOf into (-π, π]", () => {
    expect(rotationYOf(facingOf(Math.PI * 3))).toBeCloseTo(Math.PI, 12);
    expect(rotationYOf(facingOf(-Math.PI / 2))).toBeCloseTo(-Math.PI / 2, 12);
  });

  it("rejects zero-length and non-finite vectors", () => {
    expect(normalizeFacing({ x: 0, z: 0 })).toBeNull();
    expect(normalizeFacing({ x: 1e-7, z: 0 })).toBeNull();
    expect(normalizeFacing({ x: Number.NaN, z: 1 })).toBeNull();
    expect(normalizeFacing({ x: 3, z: 4 })).toEqual({ x: 0.6, z: 0.8 });
  });

  it("stores the canonical front vectors", () => {
    expect(FRONT_VECTORS["front-quarter"].x).toBeCloseTo(0.5736, 4);
    expect(FRONT_VECTORS["front-quarter"].z).toBeCloseTo(0.8192, 4);
    expect(FRONT_VECTORS.side).toEqual({ x: 1, z: 0 });
    expect(FRONT_VECTORS["back-quarter"].z).toBeCloseTo(-0.8192, 4);
    expect(FRONT_VECTORS.back).toEqual({ x: 0, z: -1 });
  });

  it("measures angles in degrees from 0 to 180", () => {
    expect(angleBetweenDegrees({ x: 0, z: 1 }, { x: 0, z: 1 })).toBe(0);
    expect(angleBetweenDegrees({ x: 0, z: 1 }, { x: 1, z: 0 })).toBeCloseTo(90, 9);
    expect(angleBetweenDegrees({ x: 0, z: 1 }, { x: 0, z: -1 })).toBeCloseTo(180, 9);
    expect(angleBetweenDegrees({ x: 0, z: 1 }, FRONT_VECTORS["front-quarter"])).toBeCloseTo(35, 1);
  });

  it("rounds to four decimals", () => {
    expect(roundFacing({ x: 0.57357643, z: 0.81915204 })).toEqual({ x: 0.5736, z: 0.8192 });
  });
});
