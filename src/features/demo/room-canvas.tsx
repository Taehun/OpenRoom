import { type Dispatch, useState, useSyncExternalStore } from "react";
import { getDocumentModelContext } from "../../webmcp/register-tools";
import { RoomPhotoStage } from "../photo/room-photo-stage";
import { useSceneStore } from "../scene/scene-context";
import type { Scene } from "../scene/scene-schema";
import type { DemoAction, DemoState } from "./demo-types";
import { NookIcon } from "./nook-icon";
import styles from "./demo-workspace.module.css";

const PRIMARY_PROMPT =
  "Redesign this room as a warm minimal Japandi interior. Replace every outdated unlocked item with a coherent catalog result, keep the sofa on the left, and leave a clear path to the windows. Read the latest scene after each change.";

const OBJECT_LABELS = {
  sofa: "Sofa",
  coffee_table: "Coffee table",
  rug: "Rug",
  floor_lamp: "Floor lamp",
  chair: "Chair",
  plant: "Plant",
  unknown: "Object",
} as const;

function subscribeToNativeWebMcp() {
  return () => undefined;
}

function getNativeWebMcpSnapshot() {
  return getDocumentModelContext() !== null;
}

function getServerNativeWebMcpSnapshot() {
  return false;
}

interface RoomCanvasProps {
  dispatch: Dispatch<DemoAction>;
  scene: Scene;
  state: DemoState;
}

export function RoomCanvas({ dispatch, scene, state }: RoomCanvasProps) {
  const toolMode = useSceneStore((store) => store.toolMode);
  const setToolMode = useSceneStore((store) => store.setToolMode);
  const nativeWebMcpAvailable = useSyncExternalStore(
    subscribeToNativeWebMcp,
    getNativeWebMcpSnapshot,
    getServerNativeWebMcpSnapshot,
  );
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const selectedObject = scene.objects.find(
    ({ id }) => id === scene.selectedObjectId,
  );

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(PRIMARY_PROMPT);
      setCopyStatus("Prompt copied");
    } catch {
      setCopyStatus("Copy unavailable");
    }
  }

  return (
    <div className={styles.canvasShell}>
      <aside className={styles.toolRail} aria-label="Room tools">
        <div className={styles.toolButtons}>
          <button
            aria-label="Select tool"
            aria-pressed={toolMode === "select"}
            className={
              toolMode === "select"
                ? styles.toolButtonActive
                : styles.toolButton
            }
            onClick={() => setToolMode("select")}
            title="Select"
            type="button"
          >
            <NookIcon name="select" />
            <span>Select</span>
          </button>
          <button
            aria-label="Move tool"
            aria-pressed={toolMode === "move"}
            className={
              toolMode === "move" ? styles.toolButtonActive : styles.toolButton
            }
            onClick={() => setToolMode("move")}
            title="Move selected object"
            type="button"
          >
            <NookIcon name="move" />
            <span>Move</span>
          </button>
          <button
            aria-label="Rotate tool"
            aria-pressed={toolMode === "rotate"}
            className={
              toolMode === "rotate"
                ? styles.toolButtonActive
                : styles.toolButton
            }
            onClick={() => setToolMode("rotate")}
            title="Rotate selected object"
            type="button"
          >
            <NookIcon name="rotate" />
            <span>Rotate</span>
          </button>
        </div>

      </aside>

      <main className={styles.canvas} aria-label="Room canvas">
        <figure className={styles.roomFigure}>
          <div
            className={styles.sceneViewport}
            onClick={() => dispatch({ type: "show-inspector" })}
          >
            <RoomPhotoStage />
          </div>
          <figcaption className={styles.visuallyHidden}>
            Edit catalog cutouts directly over the room photo with pointer or
            keyboard controls.
          </figcaption>

          <div className={styles.canvasTopbar}>
            <span className={styles.demoBadge}>Photo placement</span>
            <span>Live Scene transforms</span>
          </div>

          {selectedObject ? (
            <div className={styles.sceneSelectionLabel} aria-hidden="true">
              {selectedObject.product
                ? `Previewing ${selectedObject.product.title}`
                : `${OBJECT_LABELS[selectedObject.type]} · selected`}
            </div>
          ) : null}

          {selectedObject === undefined ? (
            <p className={styles.selectionHint}>Selection cleared</p>
          ) : null}

          {state.toast ? (
            <div className={styles.undoToast} role="status">
              <span className={styles.toastCheck} aria-hidden="true">
                <NookIcon name="check" size={16} />
              </span>
              <span>{state.toast.message}</span>
              <button
                onClick={() => dispatch({ type: "undo" })}
                type="button"
              >
                Undo
              </button>
            </div>
          ) : null}
        </figure>

        <section
          aria-label="Agent prompt guidance"
          className={styles.composer}
        >
          <span className={styles.composerIcon} aria-hidden="true">
            <NookIcon name="sparkles" />
          </span>
          <div className={styles.promptGuidance}>
            <p>{PRIMARY_PROMPT}</p>
            <div className={styles.promptSuggestions}>
              <span>Modern organic, soft neutral textures</span>
              <span>Mid-century, warm walnut and brass</span>
            </div>
            <div
              aria-label="Native WebMCP status"
              className={styles.webMcpStatus}
              role="status"
            >
              Native WebMCP: {nativeWebMcpAvailable ? "Available" : "Unavailable"}
            </div>
            <small>
              Copy this guidance into an active agent surface; this workspace
              does not simulate agent actions.
            </small>
          </div>
          <button
            className={styles.agentButton}
            onClick={copyPrompt}
            type="button"
          >
            Copy redesign prompt
          </button>
          {copyStatus ? (
            <span className={styles.visuallyHidden} role="status">
              {copyStatus}
            </span>
          ) : null}
        </section>
      </main>
    </div>
  );
}
