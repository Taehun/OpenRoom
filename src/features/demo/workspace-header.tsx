import Link from "next/link";
import type { Dispatch, RefObject } from "react";
import type { Scene } from "../scene/scene-schema";
import type { DemoAction } from "./demo-types";
import { NookIcon } from "./nook-icon";
import styles from "./demo-workspace.module.css";

interface WorkspaceHeaderProps {
  cartButtonRef: RefObject<HTMLButtonElement | null>;
  canUndo: boolean;
  dispatch: Dispatch<DemoAction>;
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
  provider,
  roomTotalMinor,
  scene,
}: WorkspaceHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.brandBlock}>
        <Link className={styles.brand} href="/" aria-label="Nook home">
          Nook
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
        <button
          className={styles.quietButton}
          disabled={!canUndo}
          onClick={() => dispatch({ type: "undo" })}
          title="Undo last scene change (Cmd/Ctrl+Z)"
          type="button"
        >
          <NookIcon name="undo" />
          <span>Undo</span>
        </button>
        <button
          className={styles.quietButton}
          onClick={() => dispatch({ type: "reset" })}
          title="Restore the canonical demo room"
          type="button"
        >
          <NookIcon name="reset" />
          <span>Reset Demo</span>
        </button>
        <button
          aria-label="View cart"
          className={styles.cartButton}
          onClick={() => dispatch({ type: "open-cart" })}
          ref={cartButtonRef}
          type="button"
        >
          <NookIcon name="cart" />
          <span>View cart</span>
          <span className={styles.cartCount} aria-hidden="true">
            4
          </span>
        </button>
      </div>
    </header>
  );
}
