"use client";

import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import styles from "../demo/demo-workspace.module.css";
import { useSceneStore, useSceneStoreApi } from "../scene/scene-context";
import type { SceneObject, Vec3 } from "../scene/scene-schema";
import { supportOf } from "../scene/support";
import { getPhotoAsset, OPENROOM_ROOM_BACKGROUND } from "./photo-assets";
import { PhotoContactShadow } from "./photo-contact-shadow";
import { PhotoObjectLayer } from "./photo-object-layer";
import { PhotoRugLayer } from "./photo-rug-layer";
import {
  LAYER_DEPTH_STRIDE,
  objectElevationOffset,
  objectVisualWidth,
  type CutoutPresentation,
  projectContactShadow,
  projectRoomPoint,
  projectRugPlacement,
  stableLayerOrder,
  supportedTopOffset,
  unprojectStagePoint,
} from "./photo-projection";
import {
  getPhotoAssetSet,
  isRadial,
  selectPhotoView,
  type IncumbentView,
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
  /**
   * The twin the cutout was already drawn with when the gesture began. The
   * preview keeps it, so a piece dragged past the room's centre line does not
   * flip left/right under the pointer; the choice is re-made on release.
   */
  incumbentView: IncumbentView | undefined;
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

/** `input` types that are buttons or sliders rather than places to type. */
const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "radio",
  "range",
  "reset",
  "submit",
]);

type NudgeDirection = "left" | "right" | "back" | "forward";

function objectLabel(object: SceneObject) {
  return object.product?.title ?? OBJECT_LABELS[object.type];
}

/**
 * A radial cutout is the same photograph at every angle, so turning a lamp or a
 * plant changes nothing anyone can see — except the floor clamp sliding it
 * sideways. A rug is the exception: its floor homography draws the turn, so the
 * one radial type that can show a rotation keeps its handle and its arrow keys.
 */
export function turnIsVisible(object: Pick<SceneObject, "assetId" | "type">) {
  return (
    object.type === "rug" || !isRadial(object.type, getPhotoAssetSet(object))
  );
}

/**
 * True for anything holding a caret or a typed value. Focus follows the
 * selection into the room, but it is never taken away from someone typing.
 */
function isTextEntry(element: HTMLElement) {
  if (
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    return true;
  }
  if (element instanceof HTMLInputElement) {
    return !NON_TEXT_INPUT_TYPES.has(element.type);
  }
  const editable = element.getAttribute("contenteditable");
  return editable === "" || editable === "true";
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
  // Every tool pick and every rail click bumps this, so re-picking the active
  // tool still hands the arrow keys back to the room.
  const focusRequest = useSceneStore((state) => state.focusRequest);
  const selectedObjectId = scene.selectedObjectId;
  const sceneStore = useSceneStoreApi();
  const stageRef = useRef<HTMLElement>(null);
  // Initialised to the mounted values, so neither the mount nor Strict Mode's
  // repeated mount effect counts as a request: pulling focus into the room on
  // load would skip the header and the rail for keyboard users.
  const lastFocusRequestRef = useRef({
    id: selectedObjectId,
    request: focusRequest,
    tool: toolMode,
  });
  const [srNote, setSrNote] = useState("");
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

  // Arrow-key move and rotate are handled by the cutout itself, so a keyboard
  // user who selects from the object rail and then picks Move or Rotate would
  // be left pressing arrows at the rail. Focus follows the selection into the
  // room instead, and follows a tool change too, so the arrows work at once.
  useEffect(() => {
    const last = lastFocusRequestRef.current;
    const requested =
      last.request !== focusRequest ||
      last.id !== selectedObjectId ||
      last.tool !== toolMode;
    lastFocusRequestRef.current = {
      id: selectedObjectId,
      request: focusRequest,
      tool: toolMode,
    };
    if (!requested) return;
    // Deselecting (Escape, or a click on the backdrop) leaves the cutout focused,
    // so the room still paints a focus ring on a piece the inspector calls
    // unselected. Focus goes back where the selection came from: the rail button
    // for that object, or the stage itself when the rail is not rendered.
    if (!selectedObjectId) {
      const active = document.activeElement;
      const cutout =
        active instanceof HTMLElement && stageRef.current?.contains(active)
          ? active.closest<HTMLElement>("[data-object-id]")
          : null;
      const clearedId = cutout?.dataset.objectId;
      if (clearedId) {
        const rail = document.querySelector<HTMLElement>(
          `[data-rail-object-id="${CSS.escape(clearedId)}"]`,
        );
        (rail ?? stageRef.current)?.focus({ preventScroll: true });
      }
      return;
    }

    const selector = `[data-object-id="${CSS.escape(selectedObjectId)}"]`;
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      // Focus already on this object's cutout, or in a field being typed in:
      // either way it stays put. Another object's cutout does not count — the
      // arrow keys only reach the object that is selected.
      if (active.closest(selector)) return;
      if (isTextEntry(active)) return;
    }

    const cutout = stageRef.current?.querySelector<HTMLButtonElement>(selector);
    cutout?.focus({ preventScroll: true });
  }, [focusRequest, selectedObjectId, toolMode]);

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

    const set = getPhotoAssetSet(object);
    // Rugs are drawn by floor homography, never by a chosen twin.
    const incumbentView =
      set && object.type !== "rug"
        ? { mirrored: selectPhotoView(object, set).mirrored }
        : undefined;

    capturePointer(event.currentTarget, event.pointerId);
    transformPreviewRef.current = {
      kind,
      incumbentView,
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

    // Select is the default tool and the one a piece is dragged with, so the
    // arrows nudge there too; Rotate keeps the horizontal pair for turning.
    if (toolMode === "select") {
      const step = event.shiftKey ? MOVE_SHIFT_STEP_M : MOVE_STEP_M;
      const position: Vec3 = [...object.position];
      let direction: NudgeDirection;

      if (event.key === "ArrowLeft") {
        position[0] -= step;
        direction = "left";
      } else if (event.key === "ArrowRight") {
        position[0] += step;
        direction = "right";
      } else if (event.key === "ArrowUp") {
        position[2] -= step;
        direction = "back";
      } else if (event.key === "ArrowDown") {
        position[2] += step;
        direction = "forward";
      } else return;

      event.preventDefault();
      sceneStore
        .getState()
        .commitTransform(object.id, position, object.rotation[1]);
      setSrNote(`${objectLabel(object)} moved ${direction}`);
      return;
    }

    if (
      toolMode === "rotate" &&
      turnIsVisible(object) &&
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
      setSrNote(
        `${objectLabel(object)} turned ${Math.round((step * 180) / Math.PI)}° to the ${
          direction === -1 ? "left" : "right"
        }`,
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
    const presentations = new Map<string, CutoutPresentation>();

    // The pictures come first: an object standing on another one is anchored to the
    // supporter's *drawn* top, so the supporter's presentation has to exist before
    // any placement is projected, whatever order the scene lists them in.
    for (const object of visualObjects) {
      // Rugs keep their floor homography and their own rotation; only the
      // vertical cutouts are chosen by front vector.
      if (object.type === "rug") continue;
      const set = getPhotoAssetSet(object);
      // Mid-gesture the twin recorded at pointer-down wins the tie-break, so the
      // cutout is steady under the pointer; released, the room decides again.
      const incumbent =
        transformPreview?.objectId === object.id
          ? transformPreview.incumbentView
          : undefined;
      const selected = set ? selectPhotoView(object, set, incumbent) : null;
      views.set(object.id, selected);
      presentations.set(object.id, {
        view: selected?.view.view,
        symmetry: set?.symmetry,
        contentBox: selected?.view.contentBox,
        intrinsicWidth: selected?.view.intrinsicWidth,
        intrinsicHeight: selected?.view.intrinsicHeight,
      });
    }

    const visualScene = { ...scene, objects: visualObjects };

    for (const object of visualObjects) {
      const projectedPlacement = projectRoomPoint(
        { x: object.position[0], z: object.position[2] },
        scene.room,
      );
      // An object standing on another one is drawn that much higher up the stage and
      // one depth band above it, so it covers the thing it stands on. Its floor
      // anchor, rotation handle and selection frame ride the raised frame; its
      // contact shadow is projected from the footprint and stays on the floor.
      // The lift comes from the supporter's photographed top whenever there is one,
      // because that is the surface the eye reads it as standing on.
      const supporter = supportOf(visualScene, object);
      const supporterPresentation = supporter
        ? presentations.get(supporter.id)
        : undefined;
      const elevationOffset =
        (supporter && supporterPresentation
          ? supportedTopOffset(
              object,
              supporter,
              supporterPresentation,
              scene.room,
              stageSize,
            )
          : null) ?? objectElevationOffset(object, scene.room);
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
      }
    }

    return {
      previewObjectId: transformPreview?.objectId ?? null,
      presentations,
      rugObjects,
      rugProjections,
      placements,
      verticalObjects,
      views,
    };
  }, [scene, stageSize, transformPreview]);

  // Everything the width projection needs about the picture: the chosen view, the
  // set's symmetry, the image's measured content box and its pixel dimensions.
  const presentationFor = (object: SceneObject): CutoutPresentation =>
    renderModel.presentations.get(object.id) ?? {};


  return (
    <section
      aria-label="Editable room photo"
      className={styles.photoStage}
      onClick={clearSelection}
      ref={stageRef}
      role="region"
      style={{ backgroundImage: `url(${OPENROOM_ROOM_BACKGROUND})` }}
      // Focus lands here when a deselection has nowhere better to send it. The
      // stage is never a tab stop: -1 makes it programmatically focusable only.
      tabIndex={-1}
    >
      {/*
        A keyboard nudge or turn moves pixels only; without this the change is
        silent for a screen reader. It lives inside the stage so it survives
        every re-render of the cutouts above it.
      */}
      <span
        aria-live="polite"
        className={styles.visuallyHidden}
        role="status"
      >
        {srNote}
      </span>

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
            onLostPointerCapture={(event) => cancelTransform(object, event)}
            onPointerCancel={(event) => cancelTransform(object, event)}
            onPointerDown={(event) => startTransform(object, event, "move")}
            onPointerMove={(event) => previewMove(object, event)}
            onPointerUp={(event) => finishTransform(object, event)}
            onRotationLostPointerCapture={(event) =>
              cancelTransform(object, event)
            }
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
            visualWidth={objectVisualWidth(object, scene.room, presentationFor(object))}
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
            onLostPointerCapture={(event) => cancelTransform(object, event)}
            onPointerCancel={(event) => cancelTransform(object, event)}
            onPointerDown={(event) => startTransform(object, event, "move")}
            onPointerMove={(event) => previewMove(object, event)}
            onPointerUp={(event) => finishTransform(object, event)}
            onRotationLostPointerCapture={(event) =>
              cancelTransform(object, event)
            }
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
              selected &&
              toolMode === "rotate" &&
              !object.locked &&
              turnIsVisible(object)
            }
            view={renderModel.views.get(object.id) ?? null}
            visualWidth={objectVisualWidth(object, scene.room, presentationFor(object))}
          />
        );
      })}
    </section>
  );
}
