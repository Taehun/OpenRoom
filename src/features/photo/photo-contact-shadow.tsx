import type { CSSProperties } from "react";

import styles from "../demo/demo-workspace.module.css";
import type { ContactShadowProjection } from "./photo-projection";

export function PhotoContactShadow({
  objectId,
  projection,
}: {
  objectId: string;
  projection: ContactShadowProjection;
}) {
  const style = {
    filter: `blur(${projection.blurPx}px)`,
    height: `${projection.height}%`,
    left: `${projection.left * 100}%`,
    opacity: projection.opacity,
    pointerEvents: "none",
    top: `${projection.top * 100}%`,
    transform: `translate(-50%, -50%) rotate(${projection.rotationDegrees}deg)`,
    width: `${projection.width}%`,
    zIndex: projection.zIndex,
  } satisfies CSSProperties;

  return (
    <span
      aria-hidden="true"
      className={styles.photoContactShadow}
      data-testid={`photo-contact-shadow-${objectId}`}
      style={style}
    />
  );
}
