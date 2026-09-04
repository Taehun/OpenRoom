import type {
  CSSProperties,
  KeyboardEventHandler,
  PointerEventHandler,
} from "react";

import styles from "../demo/demo-workspace.module.css";
import type { SceneObject } from "../scene/scene-schema";
import type { PhotoAsset } from "./photo-assets";
import { PhotoAssetFallback, PhotoAssetImage } from "./photo-asset-image";
import type { ProjectedPlacement } from "./photo-projection";
import type { SelectedPhotoView } from "./photo-views";

interface PhotoObjectLayerProps {
  label: string;
  object: SceneObject;
  onClick(): void;
  onKeyDown: KeyboardEventHandler<HTMLButtonElement>;
  /** A capture taken away mid-gesture ends it; without this the stage freezes. */
  onLostPointerCapture: PointerEventHandler<HTMLButtonElement>;
  onPointerCancel: PointerEventHandler<HTMLButtonElement>;
  onPointerDown: PointerEventHandler<HTMLButtonElement>;
  onPointerMove: PointerEventHandler<HTMLButtonElement>;
  onPointerUp: PointerEventHandler<HTMLButtonElement>;
  onRotationLostPointerCapture: PointerEventHandler<HTMLButtonElement>;
  onRotationPointerCancel: PointerEventHandler<HTMLButtonElement>;
  onRotationPointerDown: PointerEventHandler<HTMLButtonElement>;
  onRotationPointerMove: PointerEventHandler<HTMLButtonElement>;
  onRotationPointerUp: PointerEventHandler<HTMLButtonElement>;
  placement: ProjectedPlacement;
  selected: boolean;
  showRotationHandle: boolean;
  /** The registered view chosen for this object's facing, mirrored or not. */
  view: SelectedPhotoView | null;
  visualWidth: number;
}

export function PhotoObjectLayer({
  label,
  object,
  onClick,
  onKeyDown,
  onLostPointerCapture,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onRotationLostPointerCapture,
  onRotationPointerCancel,
  onRotationPointerDown,
  onRotationPointerMove,
  onRotationPointerUp,
  placement,
  selected,
  showRotationHandle,
  view,
  visualWidth,
}: PhotoObjectLayerProps) {
  // The cutout is a photograph, never a tilted picture: the chosen view carries
  // its own pixels and, when mirrored, its own anchor. Every piece of floor
  // chrome below reads that same anchor so it cannot disagree with the pixels.
  const asset: PhotoAsset | null = view
    ? {
        id: object.assetId ?? object.id,
        src: view.view.src,
        intrinsicWidth: view.view.intrinsicWidth,
        intrinsicHeight: view.view.intrinsicHeight,
        anchorX: view.anchorX,
        anchorY: view.view.anchorY,
      }
    : null;
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
    "--photo-anchor-x": anchorXPercent,
    "--photo-anchor-y": anchorYPercent,
    "--photo-anchor-x-offset": `${anchorX * -100}%`,
    "--photo-anchor-y-offset": `${anchorY * -100}%`,
  } as CSSProperties;
  // The stacking order belongs to the frame alone: a z-index on the cutout
  // button would lift it above the later-in-DOM rotation handle and floor
  // anchor, which sit inside its box now that they follow the silhouette.
  const frameStyle = {
    ...customStyle,
    zIndex: placement.zIndex,
    left,
    top,
    transform: `translate(${-anchorX * 100}%, ${-anchorY * 100}%)`,
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
  // The measured silhouette (alpha content box) of the drawn view, flipped
  // with a mirrored twin, so the selection hugs the furniture rather than the
  // image's transparent margins and the rotation handle sits on its top edge.
  const box = view?.view.contentBox ?? null;
  const silhouette = box
    ? view?.mirrored
      ? { left: 1 - box.right, right: 1 - box.left, top: box.top, bottom: box.bottom }
      : box
    : null;
  const silhouetteStyle = silhouette
    ? ({
        left: `${silhouette.left * 100}%`,
        top: `${silhouette.top * 100}%`,
        width: `${(silhouette.right - silhouette.left) * 100}%`,
        height: `${(silhouette.bottom - silhouette.top) * 100}%`,
      } as CSSProperties)
    : null;
  const rotationHandleStyle = {
    left: anchorXPercent,
    top: silhouette ? `${silhouette.top * 100}%` : 0,
    transform: "translate(-50%, -100%)",
  } as CSSProperties;

  return (
    <div
      className={styles.photoObjectFrame}
      // The room shows the piece, not a caption about it: the disclosure that a
      // facing is only approximated lives in the inspector and in the cutout's
      // alt text. The flag stays here for the tests and the stylesheet.
      data-photo-approximate={view ? String(!view.exact) : undefined}
      data-photo-mirrored={view ? String(view.mirrored) : undefined}
      data-photo-view={view?.view.view}
      data-testid={`photo-object-frame-${object.id}`}
      style={frameStyle}
    >
      <button
        aria-label={label}
        aria-pressed={selected}
        className={[
          selected ? styles.photoObjectSelected : styles.photoObject,
          view?.mirrored ? styles.photoMirrored : null,
          silhouette ? styles.photoObjectSilhouetted : null,
        ]
          .filter(Boolean)
          .join(" ")}
        data-object-id={object.id}
        disabled={false}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onLostPointerCapture={onLostPointerCapture}
        onPointerCancel={onPointerCancel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={objectStyle}
        type="button"
      >
        {asset && view ? (
          <PhotoAssetImage
            approximate={!view.exact}
            asset={asset}
            key={asset.src}
            label={label}
            mirrored={view.mirrored}
            view={view.view.view}
          />
        ) : (
          <PhotoAssetFallback label={label} />
        )}
        {object.locked ? (
          <span aria-hidden="true" className={styles.photoLockedBadge}>
            Locked
          </span>
        ) : null}
      </button>

      {/*
        Always rendered, never conditioned on the selection: the span is the one
        place the room draws a ring, and the stylesheet colours it moss for the
        selection, inverse-surface for keyboard focus. Rendering it only when
        selected would leave a focused-but-unselected cutout with no ring at all.
      */}
      {silhouetteStyle ? (
        <span
          aria-hidden="true"
          className={styles.photoSilhouetteOutline}
          data-testid={`photo-silhouette-${object.id}`}
          style={silhouetteStyle}
        />
      ) : null}

      {selected ? (
        <span
          aria-hidden="true"
          className={styles.floorAnchor}
          data-testid={`photo-floor-anchor-${object.id}`}
          style={floorAnchorStyle}
        />
      ) : null}

      {showRotationHandle ? (
        // Pointer-only: keyboard rotation lives on the cutout (← →), so the
        // handle stays out of the tab order and the accessibility tree.
        <button
          aria-hidden="true"
          aria-label={`Rotate ${label}`}
          className={styles.rotationHandle}
          data-testid={`rotation-handle-${object.id}`}
          onLostPointerCapture={onRotationLostPointerCapture}
          onPointerCancel={onRotationPointerCancel}
          onPointerDown={onRotationPointerDown}
          onPointerMove={onRotationPointerMove}
          onPointerUp={onRotationPointerUp}
          style={rotationHandleStyle}
          tabIndex={-1}
          type="button"
        >
          <span aria-hidden="true">↻</span>
        </button>
      ) : null}
    </div>
  );
}
