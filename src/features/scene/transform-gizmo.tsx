"use client";

import { TransformControls } from "@react-three/drei";
import { useRef } from "react";

import type { SceneObject, ToolMode, Vec3 } from "./scene-schema";
import type { SceneGroup } from "./scene-object";

interface TransformGizmoProps {
  object: SceneObject;
  objectGroup: SceneGroup;
  toolMode: Exclude<ToolMode, "select">;
  commitTransform(objectId: string, position: Vec3, rotationY: number): void;
  setTransforming(value: boolean): void;
}

interface StartingTransform {
  position: Vec3;
  rotationY: number;
}

const EPSILON = 0.0001;

export function TransformGizmo({
  commitTransform,
  object,
  objectGroup,
  setTransforming,
  toolMode,
}: TransformGizmoProps) {
  const startingTransform = useRef<StartingTransform | null>(null);

  function handleMouseDown() {
    startingTransform.current = {
      position: [
        objectGroup.position.x,
        objectGroup.position.y,
        objectGroup.position.z,
      ],
      rotationY: objectGroup.rotation.y,
    };
    setTransforming(true);
  }

  function handleMouseUp() {
    const start = startingTransform.current;
    setTransforming(false);
    startingTransform.current = null;
    if (!start) return;

    const position: Vec3 = [
      objectGroup.position.x,
      objectGroup.position.y,
      objectGroup.position.z,
    ];
    const changed =
      position.some(
        (value, index) =>
          Math.abs(value - start.position[index]) > EPSILON,
      ) ||
      Math.abs(objectGroup.rotation.y - start.rotationY) > EPSILON;
    if (!changed) return;

    commitTransform(object.id, position, objectGroup.rotation.y);
  }

  return (
    <TransformControls
      mode={toolMode === "move" ? "translate" : "rotate"}
      object={objectGroup}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      showX={toolMode === "move"}
      showY={toolMode === "rotate"}
      showZ={toolMode === "move"}
      size={0.72}
      space="world"
    />
  );
}
