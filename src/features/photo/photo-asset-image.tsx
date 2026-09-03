import type { CSSProperties } from "react";
import { useState } from "react";

import styles from "../demo/demo-workspace.module.css";
import type { PhotoAsset } from "./photo-assets";
import type { PhotoViewName } from "./photo-facing";

export function PhotoAssetFallback({
  className,
  label,
  style,
}: {
  className?: string;
  label: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={
        className
          ? `${styles.photoAssetFallback} ${className}`
          : styles.photoAssetFallback
      }
      role="img"
      aria-label={`${label} preview unavailable`}
      style={style}
    >
      {label}
    </span>
  );
}

export function PhotoAssetImage({
  approximate,
  asset,
  className,
  fallbackClassName,
  fallbackStyle,
  label,
  mirrored,
  style,
  view,
}: {
  /** True when the nearest registered view is more than 45° from the facing. */
  approximate?: boolean;
  asset: PhotoAsset;
  className?: string;
  fallbackClassName?: string;
  fallbackStyle?: CSSProperties;
  label: string;
  /** Renders the cutout's left/right twin; the anchor is mirrored with it. */
  mirrored?: boolean;
  style?: CSSProperties;
  view?: PhotoViewName;
}) {
  const [failed, setFailed] = useState(false);

  return failed ? (
    <PhotoAssetFallback
      className={fallbackClassName}
      label={label}
      style={fallbackStyle}
    />
  ) : (
    // Registered local alpha cutouts need their intrinsic native image boxes so
    // arbitrary floor homographies do not acquire a Next Image layout wrapper.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt=""
      className={className}
      data-photo-approximate={
        approximate === undefined ? undefined : String(approximate)
      }
      data-photo-mirrored={
        mirrored === undefined ? undefined : String(mirrored)
      }
      data-photo-view={view}
      draggable={false}
      height={asset.intrinsicHeight}
      onError={() => setFailed(true)}
      src={asset.src}
      style={mirrored ? { ...style, transform: "scaleX(-1)" } : style}
      width={asset.intrinsicWidth}
    />
  );
}
