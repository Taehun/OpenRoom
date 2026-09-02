import type {
  CSSProperties,
  KeyboardEventHandler,
  PointerEventHandler,
} from "react";
import { useState } from "react";

import styles from "../demo/demo-workspace.module.css";
import type { SceneObject } from "../scene/scene-schema";
import { getPhotoAsset, type PhotoAsset } from "./photo-assets";
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

function PhotoAssetFallback({ label }: { label: string }) {
  return (
    <span
      className={styles.photoAssetFallback}
      role="img"
      aria-label={`${label} preview unavailable`}
    >
      {label}
    </span>
  );
}

function PhotoAssetImage({
  asset,
  label,
}: {
  asset: PhotoAsset;
  label: string;
}) {
  const [failed, setFailed] = useState(false);

  return failed ? (
    <PhotoAssetFallback label={label} />
  ) : (
    // Transformable transparent cutouts need the native image box with no layout wrapper.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt=""
      draggable={false}
      onError={() => setFailed(true)}
      src={asset.src}
    />
  );
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
  const left = `${placement.left * 100}%`;
  const top = `${placement.top * 100}%`;
  const width = `${visualWidth}%`;
  const rotation = `${(object.rotation[1] * 180) / Math.PI}deg`;
  const anchorXPercent = `${anchorX * 100}%`;
  const anchorYPercent = `${anchorY * 100}%`;
  const customStyle = {
    "--photo-left": left,
    "--photo-top": top,
    "--photo-width": width,
    "--photo-rotation": rotation,
    "--photo-anchor-x": anchorXPercent,
    "--photo-anchor-y": anchorYPercent,
    "--photo-anchor-x-offset": `${anchorX * -100}%`,
    "--photo-anchor-y-offset": `${anchorY * -100}%`,
    zIndex: layerZIndex(object, placement.zIndex),
  } as CSSProperties;
  const frameStyle = {
    ...customStyle,
    left,
    top,
    transform: `translate(${-anchorX * 100}%, ${-anchorY * 100}%) rotate(${rotation})`,
    transformOrigin: `${anchorXPercent} ${anchorYPercent}`,
    width,
  } as CSSProperties;
  const objectStyle = {
    ...customStyle,
    transform: "none",
    width: "100%",
  } as CSSProperties;
  const floorAnchorStyle = {
    left: anchorXPercent,
    top: anchorYPercent,
    transform: "translate(-50%, -50%)",
  } as CSSProperties;
  const rotationHandleStyle = {
    left: anchorXPercent,
    top: 0,
    transform: "translate(-50%, -100%)",
  } as CSSProperties;

  return (
    <div
      className={styles.photoObjectFrame}
      data-testid={`photo-object-frame-${object.id}`}
      style={frameStyle}
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
        style={objectStyle}
        type="button"
      >
        {asset ? (
          <PhotoAssetImage key={asset.src} asset={asset} label={label} />
        ) : (
          <PhotoAssetFallback label={label} />
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
          style={floorAnchorStyle}
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
          style={rotationHandleStyle}
          type="button"
        >
          <span aria-hidden="true">↻</span>
        </button>
      ) : null}
    </div>
  );
}
