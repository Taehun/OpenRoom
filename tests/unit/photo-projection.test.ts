import { describe, expect, it } from "vitest";
import { NOOK_PHOTO_CALIBRATION } from "../../src/features/photo/photo-calibration";
import {
  layerOrder,
  objectVisualWidth,
  projectRoomPoint,
  unprojectStagePoint,
} from "../../src/features/photo/photo-projection";

const room = { width: 6, depth: 4.8, height: 2.8 };

describe("photo projection", () => {
  it("projects and inverts the room center", () => {
    const projected = projectRoomPoint({ x: 0, z: 0 }, room);
    const restored = unprojectStagePoint(projected, room);
    expect(restored.x).toBeCloseTo(0, 5);
    expect(restored.z).toBeCloseTo(0, 5);
  });

  it("maps back and front room corners to calibrated floor limits", () => {
    expect(projectRoomPoint({ x: -3, z: -2.4 }, room)).toMatchObject({
      left: NOOK_PHOTO_CALIBRATION.backLeft.x,
      top: NOOK_PHOTO_CALIBRATION.backFloorY,
      scale: NOOK_PHOTO_CALIBRATION.minScale,
    });
    expect(projectRoomPoint({ x: 3, z: 2.4 }, room)).toMatchObject({
      left: NOOK_PHOTO_CALIBRATION.frontRight.x,
      top: NOOK_PHOTO_CALIBRATION.frontFloorY,
      scale: NOOK_PHOTO_CALIBRATION.maxScale,
    });
  });

  it("clamps pointer coordinates before inversion", () => {
    expect(unprojectStagePoint({ x: -2, y: 3 }, room)).toEqual({
      x: -3,
      z: 2.4,
    });
  });

  it("keeps rugs below furniture at the same depth", () => {
    expect(layerOrder("rug", 700)).toBeLessThan(layerOrder("sofa", 700));
  });

  it("clamps visual width derived from real dimensions", () => {
    expect(objectVisualWidth(0.05, 1)).toBe(8);
    expect(objectVisualWidth(8, 1.4)).toBe(58);
  });
});
