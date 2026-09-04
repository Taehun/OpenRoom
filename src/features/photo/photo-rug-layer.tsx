import type {
  CSSProperties,
  KeyboardEventHandler,
  PointerEventHandler,
} from "react";

import styles from "../demo/demo-workspace.module.css";
import type { SceneObject } from "../scene/scene-schema";
import { getPhotoAsset } from "./photo-assets";
import { PhotoAssetFallback, PhotoAssetImage } from "./photo-asset-image";
import type {
  ProjectedPlacement,
  RugProjection,
} from "./photo-projection";

interface PhotoRugLayerProps {
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
  projection: RugProjection | null;
  selected: boolean;
  showRotationHandle: boolean;
  transforming: boolean;
  visualWidth: number;
}

const INTERACTION_LAYER = 8_000_000;

function destinationQuadValue(projection: RugProjection) {
  return projection.destinationNormalized
    .map(({ x, y }) => `${x},${y}`)
    .join(" ");
}

function destinationClipPath(projection: RugProjection) {
  return `polygon(${projection.destinationNormalized
    .map(({ x, y }) => `${x * 100}% ${y * 100}%`)
    .join(", ")})`;
}

/**
 * The centre of the projected floor quad. The rug's chrome is drawn in a layer that spans
 * the whole stage but is clipped to this quad, so anything anchored to the layer's own
 * corners falls outside the rug and is never painted; the centroid of a convex quad is
 * always inside it.
 */
function destinationCentroid(projection: RugProjection) {
  const corners = projection.destinationNormalized;
  return {
    x: corners.reduce((sum, { x }) => sum + x, 0) / corners.length,
    y: corners.reduce((sum, { y }) => sum + y, 0) / corners.length,
  };
}

export function PhotoRugLayer({
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
  projection,
  selected,
  showRotationHandle,
  transforming,
  visualWidth,
}: PhotoRugLayerProps) {
  const asset = getPhotoAsset(object);
  const rotation = `${(object.rotation[1] * 180) / Math.PI}deg`;

  if (!projection || !asset) {
    const anchorX = asset?.anchorX ?? 0.5;
    const anchorY = asset?.anchorY ?? 1;
    const left = `${placement.left * 100}%`;
    const top = `${placement.top * 100}%`;
    const width = `${visualWidth}%`;
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
    } as CSSProperties;
    // Stacking belongs to the frame only, so the handle stays reachable.
    const frameStyle = {
      ...customStyle,
      zIndex: placement.zIndex,
      left,
      top,
      transform: `translate(${-anchorX * 100}%, ${-anchorY * 100}%) rotate(${rotation})`,
      transformOrigin: `${anchorXPercent} ${anchorYPercent}`,
      width,
    } satisfies CSSProperties;
    const buttonStyle = {
      ...customStyle,
      transform: "none",
      width: "100%",
    } satisfies CSSProperties;

    return (
      <div
        className={styles.photoObjectFrame}
        data-floor-projected="false"
        data-testid={`photo-rug-visual-${object.id}`}
        style={frameStyle}
      >
        <button
          aria-label={label}
          aria-pressed={selected}
          className={
            selected ? styles.photoObjectSelected : styles.photoObject
          }
          data-object-id={object.id}
          onClick={onClick}
          onKeyDown={onKeyDown}
          onPointerCancel={onPointerCancel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={buttonStyle}
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
            style={{
              left: `${anchorX * 100}%`,
              top: `${anchorY * 100}%`,
            }}
          />
        ) : null}

        {showRotationHandle ? (
          <button
            aria-hidden="true"
            aria-label={`Rotate ${label}`}
            className={styles.rotationHandle}
            data-testid={`rotation-handle-${object.id}`}
            onPointerCancel={onRotationPointerCancel}
            onPointerDown={onRotationPointerDown}
            onPointerMove={onRotationPointerMove}
            onPointerUp={onRotationPointerUp}
            style={{
              left: anchorXPercent,
              top: 0,
              transform: "translate(-50%, -100%)",
            }}
            tabIndex={-1}
            type="button"
          >
            <span aria-hidden="true">↻</span>
          </button>
        ) : null}
      </div>
    );
  }

  const destinationQuad = destinationQuadValue(projection);
  const clipPath = destinationClipPath(projection);
  const lockedBadgeCenter = destinationCentroid(projection);
  const topEdgeCenter = {
    x:
      (projection.destinationNormalized[0].x +
        projection.destinationNormalized[1].x) /
      2,
    y:
      (projection.destinationNormalized[0].y +
        projection.destinationNormalized[1].y) /
      2,
  };
  const imageStyle = {
    height: `${asset.intrinsicHeight}px`,
    transform: projection.cssTransform,
    transformOrigin: "0 0",
    width: `${asset.intrinsicWidth}px`,
    willChange: transforming ? "transform" : undefined,
  } satisfies CSSProperties;
  const fallbackStyle = {
    left: `${placement.left * 100}%`,
    top: `${placement.top * 100}%`,
    transform: "translate(-50%, -50%)",
    width: `${visualWidth}%`,
  } satisfies CSSProperties;

  return (
    <div className={styles.photoRugLayer}>
      <button
        aria-label={label}
        aria-pressed={selected}
        className={styles.photoRugButton}
        data-destination-quad={destinationQuad}
        data-object-id={object.id}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onPointerCancel={onPointerCancel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ clipPath, zIndex: placement.zIndex }}
        type="button"
      >
        <span
          className={styles.photoRugVisual}
          data-floor-projected="true"
          data-testid={`photo-rug-visual-${object.id}`}
        >
          <PhotoAssetImage
            key={asset.src}
            asset={asset}
            fallbackClassName={styles.photoRugFallback}
            fallbackStyle={fallbackStyle}
            label={label}
            style={imageStyle}
          />
          {object.locked ? (
            <span
              aria-hidden="true"
              className={`${styles.photoLockedBadge} ${styles.photoRugLockedBadge}`}
              style={{
                left: `${lockedBadgeCenter.x * 100}%`,
                top: `${lockedBadgeCenter.y * 100}%`,
              }}
            >
              Locked
            </span>
          ) : null}
        </span>
      </button>

      <svg
        aria-hidden="true"
        className={
          selected
            ? `${styles.photoRugSelection} ${styles.photoRugSelectionVisible}`
            : styles.photoRugSelection
        }
        data-destination-quad={destinationQuad}
        data-testid={`photo-rug-selection-${object.id}`}
        preserveAspectRatio="none"
        style={{ zIndex: INTERACTION_LAYER }}
        viewBox="0 0 1 1"
      >
        <polygon
          points={destinationQuad}
          strokeWidth={3}
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {selected ? (
        <span
          aria-hidden="true"
          className={styles.floorAnchor}
          data-destination-quad={destinationQuad}
          data-testid={`photo-floor-anchor-${object.id}`}
          style={{
            left: `${placement.left * 100}%`,
            top: `${placement.top * 100}%`,
            zIndex: INTERACTION_LAYER + 1,
          }}
        />
      ) : null}

      {showRotationHandle ? (
        <button
          aria-hidden="true"
          aria-label={`Rotate ${label}`}
          className={`${styles.rotationHandle} ${styles.photoRugRotationHandle}`}
          data-destination-quad={destinationQuad}
          data-testid={`rotation-handle-${object.id}`}
          onPointerCancel={onRotationPointerCancel}
          onPointerDown={onRotationPointerDown}
          onPointerMove={onRotationPointerMove}
          onPointerUp={onRotationPointerUp}
          style={
            {
              "--photo-rotation": rotation,
              left: `${topEdgeCenter.x * 100}%`,
              top: `${topEdgeCenter.y * 100}%`,
              transform: "translate(-50%, -100%)",
              zIndex: INTERACTION_LAYER + 2,
            } as CSSProperties
          }
          tabIndex={-1}
          type="button"
        >
          <span aria-hidden="true">↻</span>
        </button>
      ) : null}
    </div>
  );
}
