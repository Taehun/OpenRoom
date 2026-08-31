"use client";

import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useRef, useState } from "react";

import { useSceneStore } from "./scene-context";
import { SceneObject, type SceneGroup } from "./scene-object";
import { TransformGizmo } from "./transform-gizmo";

export function SceneCanvas({
  onObjectSelected,
}: {
  onObjectSelected?(): void;
}) {
  const scene = useSceneStore((store) => store.scene);
  const toolMode = useSceneStore((store) => store.toolMode);
  const isTransforming = useSceneStore((store) => store.isTransforming);
  const selectObject = useSceneStore((store) => store.selectObject);
  const setTransforming = useSceneStore((store) => store.setTransforming);
  const commitTransform = useSceneStore((store) => store.commitTransform);
  const resetVersion = useSceneStore((store) => store.resetVersion);
  const [selectedGroup, setSelectedGroup] = useState<SceneGroup | null>(null);
  const suppressSelectionClear = useRef(false);
  const selectedObject = scene.objects.find(
    ({ id }) => id === scene.selectedObjectId,
  );
  const canTransform =
    selectedObject !== undefined &&
    selectedObject.type !== "rug" &&
    toolMode !== "select";

  if (
    typeof window === "undefined" ||
    !("WebGLRenderingContext" in window)
  ) {
    return <div data-testid="scene-canvas-fallback" />;
  }

  function selectSceneObject(objectId: string) {
    selectObject(objectId);
    onObjectSelected?.();
  }

  function clearSelection() {
    if (!isTransforming && !suppressSelectionClear.current) {
      selectObject(null);
    }
  }

  function handleTransforming(value: boolean) {
    if (!value) {
      suppressSelectionClear.current = true;
      window.requestAnimationFrame(() => {
        suppressSelectionClear.current = false;
      });
    }
    setTransforming(value);
  }

  return (
    <Canvas
      key={resetVersion}
      aria-label="Editable 3D room canvas"
      data-testid="scene-canvas"
      dpr={[1, 1.5]}
      onCreated={({ gl }) => {
        gl.domElement.dataset.testid = "scene-canvas";
        gl.domElement.setAttribute("aria-label", "Editable 3D room canvas");
      }}
      onPointerMissed={clearSelection}
      shadows={false}
    >
      <color attach="background" args={["#d8d2c7"]} />
      <ambientLight intensity={1.6} />
      <directionalLight intensity={2.1} position={[4, 7, 5]} />
      <PerspectiveCamera makeDefault position={[6, 5, 7]} fov={46} />
      <OrbitControls
        enabled={!isTransforming}
        enableDamping
        makeDefault
        maxDistance={14}
        minDistance={5}
        target={[0, 0.7, 0]}
      />

      <mesh
        position={[0, -0.035, 0]}
        onClick={(event) => {
          event.stopPropagation();
          clearSelection();
        }}
      >
        <boxGeometry args={[scene.room.width, 0.07, scene.room.depth]} />
        <meshStandardMaterial color="#c9bca8" roughness={0.96} />
      </mesh>
      <mesh position={[0, scene.room.height / 2, -scene.room.depth / 2]}>
        <boxGeometry args={[scene.room.width, scene.room.height, 0.06]} />
        <meshStandardMaterial color="#e6e0d5" roughness={0.95} />
      </mesh>
      <mesh position={[-scene.room.width / 2, scene.room.height / 2, 0]}>
        <boxGeometry args={[0.06, scene.room.height, scene.room.depth]} />
        <meshStandardMaterial color="#ded7ca" roughness={0.95} />
      </mesh>

      {scene.objects.map((object) => (
        <SceneObject
          key={object.id}
          object={object}
          onSelect={selectSceneObject}
          ref={object.id === selectedObject?.id ? setSelectedGroup : undefined}
          selected={object.id === selectedObject?.id}
        />
      ))}

      {canTransform && selectedGroup ? (
        <TransformGizmo
          commitTransform={(objectId, position, rotationY) => {
            commitTransform(objectId, position, rotationY);
          }}
          object={selectedObject}
          objectGroup={selectedGroup}
          setTransforming={handleTransforming}
          toolMode={toolMode}
        />
      ) : null}
    </Canvas>
  );
}
