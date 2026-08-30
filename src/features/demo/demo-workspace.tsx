"use client";

import { useEffect, useReducer } from "react";
import { CartApprovalSheet } from "./cart-approval-sheet";
import { ContextPanel } from "./context-panel";
import { createInitialDemoState, demoReducer } from "./demo-state";
import { RoomCanvas } from "./room-canvas";
import { WorkspaceHeader } from "./workspace-header";
import styles from "./demo-workspace.module.css";

export function DemoWorkspace() {
  const [state, dispatch] = useReducer(
    demoReducer,
    undefined,
    createInitialDemoState,
  );

  useEffect(() => {
    function handleWorkspaceKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        dispatch(
          state.isCartOpen
            ? { type: "close-cart" }
            : { type: "select-object", objectId: null },
        );
        return;
      }

      if (
        event.key.toLowerCase() === "z" &&
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey
      ) {
        event.preventDefault();
        dispatch({ type: "undo" });
      }
    }

    window.addEventListener("keydown", handleWorkspaceKeyDown);
    return () => window.removeEventListener("keydown", handleWorkspaceKeyDown);
  }, [state.isCartOpen]);

  return (
    <div className={styles.workspace}>
      <WorkspaceHeader dispatch={dispatch} state={state} />
      <div className={styles.desktopNotice} role="note">
        Nook’s room editor is desktop-first. Use a viewport at least 1280px
        wide for the complete atelier.
      </div>
      <div className={styles.workspaceBody}>
        <RoomCanvas dispatch={dispatch} state={state} />
        <ContextPanel dispatch={dispatch} state={state} />
      </div>

      {state.isCartOpen ? <CartApprovalSheet dispatch={dispatch} /> : null}

      <div
        aria-atomic="true"
        aria-live="polite"
        className={styles.liveRegion}
        role="status"
      >
        {state.announcement}
      </div>
    </div>
  );
}
