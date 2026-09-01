"use client";

import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useState,
} from "react";

import styles from "../demo/demo-workspace.module.css";
import { useSceneStore } from "../scene/scene-context";
import type { SceneObject, Vec3 } from "../scene/scene-schema";
import { NOOK_ROOM_BACKGROUND } from "./photo-assets";
import { PhotoObjectLayer } from "./photo-object-layer";
import {
  objectVisualWidth,
  projectRoomPoint,
  unprojectStagePoint,
} from "./photo-projection";

interface TransformPreview {
  pointerId: number;
  objectId: string;
  position: Vec3;
  rotationY: number;
  changed: boolean;
}

const OBJECT_LABELS: Record<SceneObject["type"], string> = {
  sofa: "Sofa",
  coffee_table: "Coffee table",
  rug: "Rug",
  floor_lamp: "Floor lamp",
  chair: "Chair",
  plant: "Plant",
  unknown: "Room object",
};

const MOVE_STEP_M = 0.08;
const MOVE_SHIFT_STEP_M = 0.24;
const ROTATE_STEP_RADIANS = (5 * Math.PI) / 180;
const ROTATE_SHIFT_STEP_RADIANS = (15 * Math.PI) / 180;
const TRANSFORM_EPSILON = 1e-9;

function objectLabel(object: SceneObject) {
  return object.product?.title ?? OBJECT_LABELS[object.type];
}

function capturePointer(element: HTMLElement, pointerId: number) {
  element.setPointerCapture?.(pointerId);
}

function positionsMatch(first: Vec3, second: Vec3) {
  return (
    Math.abs(first[0] - second[0]) <= TRANSFORM_EPSILON &&
    Math.abs(first[1] - second[1]) <= TRANSFORM_EPSILON &&
    Math.abs(first[2] - second[2]) <= TRANSFORM_EPSILON
  );
}

function rotationsMatch(first: number, second: number) {
  const difference = first - second;
  return (
    Math.abs(Math.atan2(Math.sin(difference), Math.cos(difference))) <=
    TRANSFORM_EPSILON
  );
}

export function RoomPhotoStage() {
  const scene = useSceneStore((state) => state.scene);
  const toolMode = useSceneStore((state) => state.toolMode);
  const selectObject = useSceneStore((state) => state.selectObject);
  const setTransforming = useSceneStore((state) => state.setTransforming);
  const commitTransform = useSceneStore((state) => state.commitTransform);
  const [transformPreview, setTransformPreview] =
    useState<TransformPreview | null>(null);

  function startTransform(
    object: SceneObject,
    event: PointerEvent<HTMLElement>,
  ) {
    if (transformPreview) return;

    selectObject(object.id);
    if (object.locked) return;

    capturePointer(event.currentTarget, event.pointerId);
    setTransformPreview({
      pointerId: event.pointerId,
      objectId: object.id,
      position: [...object.position],
      rotationY: object.rotation[1],
      changed: false,
    });
    setTransforming(true);
  }

  function stagePoint(event: PointerEvent<HTMLElement>) {
    const stage = event.currentTarget.closest<HTMLElement>(
      '[aria-label="Editable room photo"]',
    );
    if (!stage) return null;
    const bounds = stage.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return null;

    return {
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height,
    };
  }

  function previewMove(
    object: SceneObject,
    event: PointerEvent<HTMLElement>,
  ) {
    if (
      transformPreview?.pointerId !== event.pointerId ||
      transformPreview.objectId !== object.id
    ) {
      return;
    }
    const point = stagePoint(event);
    if (!point) return;
    const position = unprojectStagePoint(point, scene.room);
    const previewPosition: Vec3 = [
      position.x,
      object.position[1],
      position.z,
    ];

    setTransformPreview({
      ...transformPreview,
      position: previewPosition,
      changed:
        !positionsMatch(previewPosition, object.position) ||
        !rotationsMatch(transformPreview.rotationY, object.rotation[1]),
    });
  }

  function previewRotation(
    object: SceneObject,
    event: PointerEvent<HTMLElement>,
  ) {
    if (
      transformPreview?.pointerId !== event.pointerId ||
      transformPreview.objectId !== object.id
    ) {
      return;
    }
    const point = stagePoint(event);
    if (!point) return;
    const anchor = projectRoomPoint(
      { x: object.position[0], z: object.position[2] },
      scene.room,
    );
    const rotationY = Math.atan2(
      point.x - anchor.left,
      anchor.top - point.y,
    );

    setTransformPreview({
      ...transformPreview,
      rotationY,
      changed:
        !positionsMatch(transformPreview.position, object.position) ||
        !rotationsMatch(rotationY, object.rotation[1]),
    });
  }

  function finishTransform(
    object: SceneObject,
    event: PointerEvent<HTMLElement>,
  ) {
    if (
      transformPreview?.pointerId !== event.pointerId ||
      transformPreview.objectId !== object.id
    ) {
      return;
    }

    if (transformPreview.changed) {
      commitTransform(
        object.id,
        transformPreview.position,
        transformPreview.rotationY,
      );
    }
    setTransformPreview(null);
    setTransforming(false);
  }

  function cancelTransform(
    object: SceneObject,
    event: PointerEvent<HTMLElement>,
  ) {
    if (
      transformPreview?.pointerId !== event.pointerId ||
      transformPreview.objectId !== object.id
    ) {
      return;
    }

    setTransformPreview(null);
    setTransforming(false);
  }

  function handleObjectKeyDown(
    object: SceneObject,
    event: KeyboardEvent<HTMLButtonElement>,
  ) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectObject(object.id);
      return;
    }

    if (object.locked || scene.selectedObjectId !== object.id) return;

    if (toolMode === "move") {
      const step = event.shiftKey ? MOVE_SHIFT_STEP_M : MOVE_STEP_M;
      const position: Vec3 = [...object.position];

      if (event.key === "ArrowLeft") position[0] -= step;
      else if (event.key === "ArrowRight") position[0] += step;
      else if (event.key === "ArrowUp") position[2] -= step;
      else if (event.key === "ArrowDown") position[2] += step;
      else return;

      event.preventDefault();
      commitTransform(object.id, position, object.rotation[1]);
      return;
    }

    if (
      toolMode === "rotate" &&
      object.type !== "rug" &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      const step = event.shiftKey
        ? ROTATE_SHIFT_STEP_RADIANS
        : ROTATE_STEP_RADIANS;
      const direction = event.key === "ArrowLeft" ? -1 : 1;

      event.preventDefault();
      commitTransform(
        object.id,
        object.position,
        object.rotation[1] + direction * step,
      );
    }
  }

  function clearSelection(event: MouseEvent<HTMLElement>) {
    if (event.target === event.currentTarget) selectObject(null);
  }

  return (
    <section
      aria-label="Editable room photo"
      className={styles.photoStage}
      onClick={clearSelection}
      role="region"
      style={{ backgroundImage: `url(${NOOK_ROOM_BACKGROUND})` }}
    >
      {scene.objects.map((object) => {
        const preview =
          transformPreview?.objectId === object.id ? transformPreview : null;
        const visualObject = preview
          ? {
              ...object,
              position: preview.position,
              rotation: [
                object.rotation[0],
                preview.rotationY,
                object.rotation[2],
              ] as Vec3,
            }
          : object;
        const placement = projectRoomPoint(
          { x: visualObject.position[0], z: visualObject.position[2] },
          scene.room,
        );
        const selected = scene.selectedObjectId === object.id;

        return (
          <PhotoObjectLayer
            key={object.id}
            label={objectLabel(object)}
            object={visualObject}
            onClick={() => selectObject(object.id)}
            onKeyDown={(event) => handleObjectKeyDown(object, event)}
            onPointerCancel={(event) => cancelTransform(object, event)}
            onPointerDown={(event) => startTransform(object, event)}
            onPointerMove={(event) => previewMove(object, event)}
            onPointerUp={(event) => finishTransform(object, event)}
            onRotationPointerCancel={(event) =>
              cancelTransform(object, event)
            }
            onRotationPointerDown={(event) => startTransform(object, event)}
            onRotationPointerMove={(event) => previewRotation(object, event)}
            onRotationPointerUp={(event) => finishTransform(object, event)}
            placement={placement}
            selected={selected}
            showRotationHandle={
              selected &&
              toolMode === "rotate" &&
              !object.locked &&
              object.type !== "rug"
            }
            visualWidth={objectVisualWidth(
              object.dimensionsM.width,
              placement.scale,
            )}
          />
        );
      })}
    </section>
  );
}
