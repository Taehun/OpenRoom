import type { CSSProperties } from "react";
import { useState } from "react";

import styles from "../demo/demo-workspace.module.css";
import type { PhotoAsset } from "./photo-assets";

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
  asset,
  className,
  fallbackClassName,
  fallbackStyle,
  label,
  style,
}: {
  asset: PhotoAsset;
  className?: string;
  fallbackClassName?: string;
  fallbackStyle?: CSSProperties;
  label: string;
  style?: CSSProperties;
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
      draggable={false}
      height={asset.intrinsicHeight}
      onError={() => setFailed(true)}
      src={asset.src}
      style={style}
      width={asset.intrinsicWidth}
    />
  );
}
