import Link from "next/link";
import type { Dispatch, RefObject } from "react";
import type { Scene } from "../scene/scene-schema";
import type { DemoAction } from "./demo-types";
import { OpenRoomIcon } from "./open-room-icon";
import styles from "./demo-workspace.module.css";

interface WorkspaceHeaderProps {
  cartButtonRef: RefObject<HTMLButtonElement | null>;
  canUndo: boolean;
  dispatch: Dispatch<DemoAction>;
  /** Set only by the adaptive home page, which also hosts the guide. */
  guideHref?: string | undefined;
  provider: string;
  roomTotalMinor: number;
  scene: Scene;
}

function formatRoomTotal(totalMinor: number) {
  return `$${Math.round(totalMinor / 100).toLocaleString("en-US")}`;
}

export function WorkspaceHeader({
  cartButtonRef,
  canUndo,
  dispatch,
  guideHref,
  provider,
  roomTotalMinor,
  scene,
}: WorkspaceHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.brandBlock}>
        <Link className={styles.brand} href="/" aria-label="OpenRoom home">
          OpenRoom
        </Link>
        <span className={styles.headerDivider} aria-hidden="true" />
        <div className={styles.roomIdentity}>
          <strong>Living room</strong>
          <span>Revision {scene.revision}</span>
        </div>
      </div>

      <div className={styles.headerStatus} aria-label="Workspace status">
        <div className={styles.providerStatus}>
          <span className={styles.statusDot} aria-hidden="true" />
          <span>
            <small>Provider</small>
            <strong>{provider}</strong>
          </span>
        </div>
        <div className={styles.roomTotal}>
          <small>Room total</small>
          <strong>{formatRoomTotal(roomTotalMinor)}</strong>
        </div>
      </div>

      <div className={styles.headerActions}>
        {guideHref ? (
          // Same-route query switch: a soft navigation would leave the
          // workspace mounted in browsers without the Navigation API.
          <a className={styles.quietButton} href={guideHref}>
            <span>Guide</span>
          </a>
        ) : null}
        <button
          className={styles.quietButton}
          disabled={!canUndo}
          onClick={() => dispatch({ type: "undo" })}
          title="Undo last scene change (Cmd/Ctrl+Z)"
          type="button"
        >
          <OpenRoomIcon name="undo" />
          <span>Undo</span>
        </button>
        <button
          className={styles.quietButton}
          onClick={() => dispatch({ type: "reset" })}
          title="Restore the canonical demo room"
          type="button"
        >
          <OpenRoomIcon name="reset" />
          <span>Reset Demo</span>
        </button>
        <button
          aria-label="View cart"
          className={styles.cartButton}
          onClick={() => dispatch({ type: "open-cart" })}
          ref={cartButtonRef}
          type="button"
        >
          <OpenRoomIcon name="cart" />
          <span>View cart</span>
          <span className={styles.cartCount} aria-hidden="true">
            4
          </span>
        </button>
      </div>
    </header>
  );
}
