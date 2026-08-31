"use client";

import { forwardRef, type Ref } from "react";
import type { ThreeElements, ThreeEvent } from "@react-three/fiber";

import type { SceneObject as SceneObjectData } from "./scene-schema";

const PLACEHOLDER_COLORS: Record<SceneObjectData["type"], string> = {
  sofa: "#d9d0bf",
  coffee_table: "#a9784f",
  rug: "#c7ad86",
  floor_lamp: "#6f6558",
  chair: "#9c7355",
  plant: "#657354",
  unknown: "#a5a097",
};

const PRODUCT_COLORS: Record<string, string> = {
  "light-oak": "#c89b67",
  oak: "#b88454",
  ivory: "#d7cdbb",
  travertine: "#c7b59b",
  walnut: "#714b36",
};

type Point = [number, number, number];
type RefInstance<T> = T extends Ref<infer Instance> ? Instance : never;
export type SceneGroup = RefInstance<
  NonNullable<ThreeElements["group"]["ref"]>
>;

interface SceneObjectProps {
  object: SceneObjectData;
  selected: boolean;
  onSelect(objectId: string): void;
}

function Box({
  color,
  position = [0, 0, 0],
  size,
}: {
  color: string;
  position?: Point;
  size: Point;
}) {
  return (
    <mesh position={position}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.82} />
    </mesh>
  );
}

function Sofa({ color, width, height, depth }: PrimitiveProps) {
  const seatHeight = height * 0.34;
  const armWidth = Math.min(width * 0.09, 0.18);
  return (
    <>
      <Box
        color={color}
        position={[0, -height / 2 + seatHeight / 2, depth * 0.05]}
        size={[width, seatHeight, depth * 0.82]}
      />
      <Box
        color={color}
        position={[0, height * 0.12, -depth * 0.39]}
        size={[width, height * 0.76, depth * 0.2]}
      />
      <Box
        color={color}
        position={[-width / 2 + armWidth / 2, -height * 0.08, depth * 0.05]}
        size={[armWidth, height * 0.58, depth * 0.8]}
      />
      <Box
        color={color}
        position={[width / 2 - armWidth / 2, -height * 0.08, depth * 0.05]}
        size={[armWidth, height * 0.58, depth * 0.8]}
      />
    </>
  );
}

function CoffeeTable({ color, width, height, depth }: PrimitiveProps) {
  const topHeight = Math.min(0.1, height * 0.25);
  const legHeight = height - topHeight;
  const legWidth = Math.min(0.08, width * 0.08);
  const x = width / 2 - legWidth * 1.5;
  const z = depth / 2 - legWidth * 1.5;
  return (
    <>
      <Box
        color={color}
        position={[0, height / 2 - topHeight / 2, 0]}
        size={[width, topHeight, depth]}
      />
      {[
        [-x, -height / 2 + legHeight / 2, -z],
        [x, -height / 2 + legHeight / 2, -z],
        [-x, -height / 2 + legHeight / 2, z],
        [x, -height / 2 + legHeight / 2, z],
      ].map((position, index) => (
        <Box
          color={color}
          key={index}
          position={position as Point}
          size={[legWidth, legHeight, legWidth]}
        />
      ))}
    </>
  );
}

function FloorLamp({ color, width, height }: PrimitiveProps) {
  const stemHeight = height * 0.74;
  return (
    <>
      <mesh position={[0, -height / 2 + 0.035, 0]}>
        <cylinderGeometry args={[width * 0.32, width * 0.42, 0.07, 24]} />
        <meshStandardMaterial color={color} roughness={0.72} />
      </mesh>
      <mesh position={[0, -height / 2 + stemHeight / 2 + 0.05, 0]}>
        <cylinderGeometry args={[0.018, 0.024, stemHeight, 12]} />
        <meshStandardMaterial color={color} roughness={0.55} />
      </mesh>
      <mesh position={[0, height * 0.37, 0]}>
        <sphereGeometry args={[width * 0.42, 24, 16]} />
        <meshStandardMaterial color="#e2d5b9" roughness={0.9} />
      </mesh>
    </>
  );
}

function Chair({ color, width, height, depth }: PrimitiveProps) {
  const seatHeight = height * 0.24;
  return (
    <>
      <Box
        color={color}
        position={[0, -height * 0.18, depth * 0.05]}
        size={[width, seatHeight, depth * 0.88]}
      />
      <Box
        color={color}
        position={[0, height * 0.2, -depth * 0.36]}
        size={[width, height * 0.58, depth * 0.18]}
      />
      <Box
        color="#645448"
        position={[-width * 0.36, -height * 0.39, 0]}
        size={[0.07, height * 0.38, depth * 0.62]}
      />
      <Box
        color="#645448"
        position={[width * 0.36, -height * 0.39, 0]}
        size={[0.07, height * 0.38, depth * 0.62]}
      />
    </>
  );
}

function Plant({ color, width, height }: PrimitiveProps) {
  return (
    <>
      <mesh position={[0, -height * 0.34, 0]}>
        <cylinderGeometry args={[width * 0.32, width * 0.4, height * 0.3, 24]} />
        <meshStandardMaterial color="#8b654c" roughness={0.88} />
      </mesh>
      {[
        [0, 0.05, 0],
        [-width * 0.22, height * 0.14, 0],
        [width * 0.2, height * 0.22, 0.03],
        [0, height * 0.38, -0.02],
      ].map((position, index) => (
        <mesh key={index} position={position as Point} scale={[1, 1.5, 0.72]}>
          <sphereGeometry args={[width * 0.28, 20, 14]} />
          <meshStandardMaterial color={color} roughness={0.9} />
        </mesh>
      ))}
    </>
  );
}

interface PrimitiveProps {
  color: string;
  width: number;
  height: number;
  depth: number;
}

function ObjectPrimitive({
  object,
  color,
}: {
  object: SceneObjectData;
  color: string;
}) {
  const props = { color, ...object.dimensionsM };
  switch (object.type) {
    case "sofa":
      return <Sofa {...props} />;
    case "coffee_table":
      return <CoffeeTable {...props} />;
    case "rug":
      return (
        <Box color={color} size={[props.width, props.height, props.depth]} />
      );
    case "floor_lamp":
      return <FloorLamp {...props} />;
    case "chair":
      return <Chair {...props} />;
    case "plant":
      return <Plant {...props} />;
    case "unknown":
      return (
        <Box color={color} size={[props.width, props.height, props.depth]} />
      );
  }
}

function objectColor(object: SceneObjectData) {
  if (!object.product) return PLACEHOLDER_COLORS[object.type];
  return (
    PRODUCT_COLORS[object.product.color ?? ""] ??
    PRODUCT_COLORS[object.product.material ?? ""] ??
    "#ad825c"
  );
}

export const SceneObject = forwardRef<SceneGroup, SceneObjectProps>(
  function SceneObject({ object, selected, onSelect }, ref) {
    const dimensions = object.dimensionsM;

    function handleClick(event: ThreeEvent<MouseEvent>) {
      event.stopPropagation();
      onSelect(object.id);
    }

    return (
      <group
        ref={ref}
        name={object.id}
        position={object.position}
        rotation={object.rotation}
        scale={object.scale}
        onClick={handleClick}
      >
        <ObjectPrimitive color={objectColor(object)} object={object} />
        {selected ? (
          <mesh scale={[1.045, 1.045, 1.045]}>
            <boxGeometry
              args={[dimensions.width, dimensions.height, dimensions.depth]}
            />
            <meshBasicMaterial color="#526148" wireframe />
          </mesh>
        ) : null}
      </group>
    );
  },
);
