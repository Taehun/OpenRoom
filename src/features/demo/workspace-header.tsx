import Link from "next/link";
import type { Dispatch, RefObject } from "react";
import { GitHubMark } from "../home/github-mark";
import { REPOSITORY_URL } from "../home/repository";
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

/** The cart is the room, so the badge counts product-backed objects only. */
function cartCountOf(scene: Scene): number {
  return scene.objects.filter(
    (object) => object.source === "product" && object.product,
  ).length;
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
  const cartCount = cartCountOf(scene);

  return (
    <header className={styles.header}>
      <div className={styles.brandBlock}>
        <Link className="md-wordmark" href="/" aria-label="OpenRoom home">
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
            <small>Showing</small>
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
          <a
            className={`md-button md-button--text ${styles.quietButton}`}
            href={guideHref}
          >
            <span>Guide</span>
          </a>
        ) : null}
        <button
          className={`md-button md-button--text ${styles.quietButton}`}
          disabled={!canUndo}
          onClick={() => dispatch({ type: "undo" })}
          title="Undo last scene change (Cmd/Ctrl+Z)"
          type="button"
        >
          <OpenRoomIcon name="undo" />
          <span>Undo</span>
        </button>
        <button
          className={`md-button md-button--text ${styles.quietButton}`}
          onClick={() => dispatch({ type: "reset" })}
          title="Restore the canonical demo room"
          type="button"
        >
          <OpenRoomIcon name="reset" />
          <span>Reset Demo</span>
        </button>
        <button
          aria-label="View cart"
          className={`md-button md-button--filled ${styles.cartButton}`}
          onClick={() => dispatch({ type: "open-cart" })}
          ref={cartButtonRef}
          type="button"
        >
          <OpenRoomIcon name="cart" />
          <span>View cart</span>
          {cartCount > 0 ? (
            <span className={styles.cartCount} aria-hidden="true">
              {cartCount}
            </span>
          ) : null}
        </button>
        <a
          aria-label="OpenRoom on GitHub"
          className={`md-icon-button ${styles.repoLink}`}
          href={REPOSITORY_URL}
          rel="noopener noreferrer"
          target="_blank"
          title="View on GitHub"
        >
          <GitHubMark />
        </a>
      </div>
    </header>
  );
}
