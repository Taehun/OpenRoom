import type {
  CSSProperties,
  KeyboardEventHandler,
  PointerEventHandler,
} from "react";

import styles from "../demo/demo-workspace.module.css";
import type { SceneObject } from "../scene/scene-schema";
import { getPhotoAsset } from "./photo-assets";
import {
  layerOrder,
  type ProjectedPlacement,
} from "./photo-projection";

interface PhotoObjectLayerProps {
  label: string;
  object: SceneObject;
  onClick(): void;
  onKeyDown: KeyboardEventHandler<HTMLButtonElement>;
  onPointerCancel: PointerEventHandler<HTMLButtonElement>;
  onPointerDown: PointerEventHandler<HTMLButtonElement>;
  onPointerMove: PointerEventHandler<HTMLButtonElement>;
  onPointerUp: PointerEventHandler<HTMLButtonElement>;
  onRotationPointerCancel: PointerEventHandler<HTMLButtonElement>;
  onRotationPointerDown: PointerEventHandler<HTMLButtonElement>;
  onRotationPointerMove: PointerEventHandler<HTMLButtonElement>;
  onRotationPointerUp: PointerEventHandler<HTMLButtonElement>;
  placement: ProjectedPlacement;
  selected: boolean;
  showRotationHandle: boolean;
  visualWidth: number;
}

function layerZIndex(object: SceneObject, zIndex: number) {
  return object.type === "unknown"
    ? zIndex
    : layerOrder(object.type, zIndex);
}

export function PhotoObjectLayer({
  label,
  object,
  onClick,
  onKeyDown,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onRotationPointerCancel,
  onRotationPointerDown,
  onRotationPointerMove,
  onRotationPointerUp,
  placement,
  selected,
  showRotationHandle,
  visualWidth,
}: PhotoObjectLayerProps) {
  const asset = getPhotoAsset(object);
  const anchorX = asset?.anchorX ?? 0.5;
  const anchorY = asset?.anchorY ?? 1;
  const customStyle = {
    "--photo-left": `${placement.left * 100}%`,
    "--photo-top": `${placement.top * 100}%`,
    "--photo-width": `${visualWidth}%`,
    "--photo-rotation": `${(object.rotation[1] * 180) / Math.PI}deg`,
    "--photo-anchor-x": `${anchorX * 100}%`,
    "--photo-anchor-y": `${anchorY * 100}%`,
    "--photo-anchor-x-offset": `${anchorX * -100}%`,
    "--photo-anchor-y-offset": `${anchorY * -100}%`,
    zIndex: layerZIndex(object, placement.zIndex),
  } as CSSProperties;

  return (
    <div
      className={styles.photoObjectFrame}
      data-testid={`photo-object-frame-${object.id}`}
      style={customStyle}
    >
      <button
        aria-label={label}
        aria-pressed={selected}
        className={
          selected ? styles.photoObjectSelected : styles.photoObject
        }
        data-object-id={object.id}
        disabled={false}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onPointerCancel={onPointerCancel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={customStyle}
        type="button"
      >
        {asset ? (
          // Transformable transparent cutouts need the native image box with no layout wrapper.
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" draggable={false} src={asset.src} />
        ) : (
          <span
            className={styles.photoAssetFallback}
            role="img"
            aria-label={`${label} preview unavailable`}
          >
            {label}
          </span>
        )}
        {object.locked ? (
          <span aria-hidden="true" className={styles.photoLockedBadge}>
            Locked
          </span>
        ) : null}
      </button>

      {selected ? (
        <span
          aria-hidden="true"
          className={styles.floorAnchor}
          data-testid={`photo-floor-anchor-${object.id}`}
        />
      ) : null}

      {showRotationHandle ? (
        <button
          aria-label={`Rotate ${label}`}
          className={styles.rotationHandle}
          onPointerCancel={onRotationPointerCancel}
          onPointerDown={onRotationPointerDown}
          onPointerMove={onRotationPointerMove}
          onPointerUp={onRotationPointerUp}
          style={customStyle}
          type="button"
        >
          <span aria-hidden="true">↻</span>
        </button>
      ) : null}
    </div>
  );
}
