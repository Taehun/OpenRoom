"use client";

import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import styles from "../demo/demo-workspace.module.css";
import { useSceneStore, useSceneStoreApi } from "../scene/scene-context";
import type { SceneObject, Vec3 } from "../scene/scene-schema";
import { getPhotoAsset, OPENROOM_ROOM_BACKGROUND } from "./photo-assets";
import { PhotoContactShadow } from "./photo-contact-shadow";
import { PhotoObjectLayer } from "./photo-object-layer";
import { PhotoRugLayer } from "./photo-rug-layer";
import {
  LAYER_DEPTH_STRIDE,
  objectElevationOffset,
  objectVisualWidth,
  projectContactShadow,
  projectRoomPoint,
  projectRugPlacement,
  stableLayerOrder,
  unprojectStagePoint,
} from "./photo-projection";
import {
  getPhotoAssetSet,
  selectPhotoView,
  type SelectedPhotoView,
} from "./photo-views";
import type { NormalizedPoint } from "./photo-calibration";

interface TransformPreview {
  kind: "move" | "rotate";
  pointerId: number;
  objectId: string;
  startPointer: NormalizedPoint;
  startAnchor: NormalizedPoint;
  startPointerAngle: number;
  startPosition: Vec3;
  startRotationY: number;
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
  side_table: "Side table",
  bookshelf: "Bookshelf",
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

export function normalizeAngleDelta(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function pointerAngle(point: NormalizedPoint, anchor: NormalizedPoint) {
  return Math.atan2(point.x - anchor.x, anchor.y - point.y);
}

export function RoomPhotoStage() {
  const scene = useSceneStore((state) => state.scene);
  const toolMode = useSceneStore((state) => state.toolMode);
  const sceneStore = useSceneStoreApi();
  const stageRef = useRef<HTMLElement>(null);
  const transformPreviewRef = useRef<TransformPreview | null>(null);
  const previewListenersRef = useRef(new Set<() => void>());
  const subscribeToTransformPreview = useCallback((listener: () => void) => {
    previewListenersRef.current.add(listener);
    return () => previewListenersRef.current.delete(listener);
  }, []);
  const getTransformPreview = useCallback(
    () => transformPreviewRef.current,
    [],
  );
  const transformPreview = useSyncExternalStore(
    subscribeToTransformPreview,
    getTransformPreview,
    getTransformPreview,
  );
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });

  function renderTransformPreview() {
    for (const listener of previewListenersRef.current) listener();
  }

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const measureStage = () => {
      const bounds = stage.getBoundingClientRect();
      const width = Number.isFinite(bounds.width) ? Math.max(0, bounds.width) : 0;
      const height = Number.isFinite(bounds.height)
        ? Math.max(0, bounds.height)
        : 0;
      setStageSize((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height },
      );
    };

    measureStage();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measureStage);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  function startTransform(
    object: SceneObject,
    event: PointerEvent<HTMLElement>,
    kind: TransformPreview["kind"],
  ) {
    if (transformPreviewRef.current) return;

    sceneStore.getState().selectObject(object.id);
    if (object.locked) return;

    const startPointer = stagePoint(event);
    if (!startPointer) return;
    const startAnchor = projectRoomPoint(
      { x: object.position[0], z: object.position[2] },
      scene.room,
    );

    capturePointer(event.currentTarget, event.pointerId);
    transformPreviewRef.current = {
      kind,
      pointerId: event.pointerId,
      objectId: object.id,
      startPointer,
      startAnchor,
      startPointerAngle: pointerAngle(startPointer, startAnchor),
      startPosition: [...object.position],
      startRotationY: object.rotation[1],
      position: [...object.position],
      rotationY: object.rotation[1],
      changed: false,
    };
    renderTransformPreview();
    sceneStore.getState().setTransforming(true);
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
    const point = stagePoint(event);
    if (!point) return;
    const current = transformPreviewRef.current;
    if (
      current?.kind !== "move" ||
      current.pointerId !== event.pointerId ||
      current.objectId !== object.id
    ) {
      return;
    }

    const targetAnchor = {
      x: current.startAnchor.x + point.x - current.startPointer.x,
      y: current.startAnchor.y + point.y - current.startPointer.y,
    };
    const position = unprojectStagePoint(targetAnchor, scene.room);
    const previewPosition: Vec3 = [
      position.x,
      current.startPosition[1],
      position.z,
    ];
    transformPreviewRef.current = {
      ...current,
      position: previewPosition,
      changed:
        !positionsMatch(previewPosition, current.startPosition) ||
        !rotationsMatch(current.rotationY, current.startRotationY),
    };
    renderTransformPreview();
  }

  function previewRotation(
    object: SceneObject,
    event: PointerEvent<HTMLElement>,
  ) {
    const point = stagePoint(event);
    if (!point) return;
    const current = transformPreviewRef.current;
    if (
      current?.kind !== "rotate" ||
      current.pointerId !== event.pointerId ||
      current.objectId !== object.id
    ) {
      return;
    }

    const currentPointerAngle = pointerAngle(point, current.startAnchor);
    const rotationY =
      current.startRotationY +
      normalizeAngleDelta(currentPointerAngle - current.startPointerAngle);
    transformPreviewRef.current = {
      ...current,
      rotationY,
      changed:
        !positionsMatch(current.position, current.startPosition) ||
        !rotationsMatch(rotationY, current.startRotationY),
    };
    renderTransformPreview();
  }

  function finishTransform(
    object: SceneObject,
    event: PointerEvent<HTMLElement>,
  ) {
    const transformPreview = transformPreviewRef.current;
    if (
      transformPreview?.pointerId !== event.pointerId ||
      transformPreview.objectId !== object.id
    ) {
      return;
    }

    if (transformPreview.changed) {
      sceneStore.getState().commitTransform(
        object.id,
        transformPreview.position,
        transformPreview.rotationY,
      );
    }
    transformPreviewRef.current = null;
    renderTransformPreview();
    sceneStore.getState().setTransforming(false);
  }

  function cancelTransform(
    object: SceneObject,
    event: PointerEvent<HTMLElement>,
  ) {
    const transformPreview = transformPreviewRef.current;
    if (
      transformPreview?.pointerId !== event.pointerId ||
      transformPreview.objectId !== object.id
    ) {
      return;
    }

    transformPreviewRef.current = null;
    renderTransformPreview();
    sceneStore.getState().setTransforming(false);
  }

  function handleObjectKeyDown(
    object: SceneObject,
    event: KeyboardEvent<HTMLButtonElement>,
  ) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      sceneStore.getState().selectObject(object.id);
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
      sceneStore
        .getState()
        .commitTransform(object.id, position, object.rotation[1]);
      return;
    }

    if (
      toolMode === "rotate" &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      const step = event.shiftKey
        ? ROTATE_SHIFT_STEP_RADIANS
        : ROTATE_STEP_RADIANS;
      const direction = event.key === "ArrowLeft" ? -1 : 1;

      event.preventDefault();
      sceneStore.getState().commitTransform(
        object.id,
        object.position,
        object.rotation[1] + direction * step,
      );
    }
  }

  function clearSelection(event: MouseEvent<HTMLElement>) {
    if (event.target === event.currentTarget) {
      sceneStore.getState().selectObject(null);
    }
  }

  const renderModel = useMemo(() => {
    const lexicalIndexById = new Map(
      scene.objects
        .map(({ id }) => id)
        .toSorted()
        .map((id, index) => [id, index] as const),
    );
    const visualObjects = scene.objects.map((object) =>
      transformPreview?.objectId === object.id
        ? {
            ...object,
            position: transformPreview.position,
            rotation: [
              object.rotation[0],
              transformPreview.rotationY,
              object.rotation[2],
            ] as Vec3,
          }
        : object,
    );
    const placements = new Map<string, ReturnType<typeof projectRoomPoint>>();
    const rugProjections = new Map<
      string,
      ReturnType<typeof projectRugPlacement>
    >();
    const rugObjects: SceneObject[] = [];
    const verticalObjects: SceneObject[] = [];
    const views = new Map<string, SelectedPhotoView | null>();

    for (const object of visualObjects) {
      const projectedPlacement = projectRoomPoint(
        { x: object.position[0], z: object.position[2] },
        scene.room,
      );
      // An object standing on another one is drawn that much higher up the stage and
      // one depth band above it, so it covers the thing it stands on. Its floor
      // anchor, rotation handle and selection frame ride the raised frame; its
      // contact shadow is projected from the footprint and stays on the floor.
      const elevationOffset = objectElevationOffset(object, scene.room);
      const placement = {
        ...projectedPlacement,
        y: projectedPlacement.y - elevationOffset,
        top: projectedPlacement.top - elevationOffset,
        zIndex:
          stableLayerOrder(
            object,
            projectedPlacement,
            lexicalIndexById.get(object.id) ?? 0,
          ) + (elevationOffset > 0 ? LAYER_DEPTH_STRIDE : 0),
      };
      placements.set(object.id, placement);

      if (object.type === "rug") {
        rugObjects.push(object);
        const asset = getPhotoAsset(object);
        rugProjections.set(
          object.id,
          asset
            ? projectRugPlacement(object, asset, scene.room, stageSize)
            : null,
        );
      } else {
        verticalObjects.push(object);
        // Rugs keep their floor homography and their own rotation; only the
        // vertical cutouts are chosen by front vector.
        const set = getPhotoAssetSet(object);
        views.set(object.id, set ? selectPhotoView(object, set) : null);
      }
    }

    return {
      previewObjectId: transformPreview?.objectId ?? null,
      rugObjects,
      rugProjections,
      placements,
      verticalObjects,
      views,
    };
  }, [scene, stageSize, transformPreview]);

  return (
    <section
      aria-label="Editable room photo"
      className={styles.photoStage}
      onClick={clearSelection}
      ref={stageRef}
      role="region"
      style={{ backgroundImage: `url(${OPENROOM_ROOM_BACKGROUND})` }}
    >
      {renderModel.rugObjects.map((object) => {
        const placement = renderModel.placements.get(object.id)!;
        const selected = scene.selectedObjectId === object.id;

        return (
          <PhotoRugLayer
            key={object.id}
            label={objectLabel(object)}
            object={object}
            onClick={() => sceneStore.getState().selectObject(object.id)}
            onKeyDown={(event) => handleObjectKeyDown(object, event)}
            onPointerCancel={(event) => cancelTransform(object, event)}
            onPointerDown={(event) => startTransform(object, event, "move")}
            onPointerMove={(event) => previewMove(object, event)}
            onPointerUp={(event) => finishTransform(object, event)}
            onRotationPointerCancel={(event) =>
              cancelTransform(object, event)
            }
            onRotationPointerDown={(event) =>
              startTransform(object, event, "rotate")
            }
            onRotationPointerMove={(event) => previewRotation(object, event)}
            onRotationPointerUp={(event) => finishTransform(object, event)}
            placement={placement}
            projection={renderModel.rugProjections.get(object.id) ?? null}
            selected={selected}
            showRotationHandle={
              selected &&
              toolMode === "rotate" &&
              !object.locked
            }
            transforming={renderModel.previewObjectId === object.id}
            visualWidth={objectVisualWidth(object, scene.room)}
          />
        );
      })}

      {renderModel.verticalObjects.map((object) => (
        <PhotoContactShadow
          key={`shadow-${object.id}`}
          objectId={object.id}
          projection={projectContactShadow(object, scene.room)}
        />
      ))}

      {renderModel.verticalObjects.map((object) => {
        const placement = renderModel.placements.get(object.id)!;
        const selected = scene.selectedObjectId === object.id;

        return (
          <PhotoObjectLayer
            key={object.id}
            label={objectLabel(object)}
            object={object}
            onClick={() => sceneStore.getState().selectObject(object.id)}
            onKeyDown={(event) => handleObjectKeyDown(object, event)}
            onPointerCancel={(event) => cancelTransform(object, event)}
            onPointerDown={(event) => startTransform(object, event, "move")}
            onPointerMove={(event) => previewMove(object, event)}
            onPointerUp={(event) => finishTransform(object, event)}
            onRotationPointerCancel={(event) =>
              cancelTransform(object, event)
            }
            onRotationPointerDown={(event) =>
              startTransform(object, event, "rotate")
            }
            onRotationPointerMove={(event) => previewRotation(object, event)}
            onRotationPointerUp={(event) => finishTransform(object, event)}
            placement={placement}
            selected={selected}
            showRotationHandle={
              selected && toolMode === "rotate" && !object.locked
            }
            view={renderModel.views.get(object.id) ?? null}
            visualWidth={objectVisualWidth(object, scene.room)}
          />
        );
      })}
    </section>
  );
}
