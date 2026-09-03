import { type Dispatch, useRef, useState, useSyncExternalStore } from "react";
import type { LocalMcpRelay } from "../../local-mcp/use-local-mcp-relay";
import { getDocumentModelContext } from "../../webmcp/register-tools";
import { RoomPhotoStage } from "../photo/room-photo-stage";
import { useSceneStore } from "../scene/scene-context";
import type { Scene } from "../scene/scene-schema";
import type { DemoAction, DemoState } from "./demo-types";
import { LocalAgentStatus } from "./local-agent-status";
import { OpenRoomIcon } from "./open-room-icon";
import styles from "./demo-workspace.module.css";

const ROOM_OBJECTS = [
  { id: "sofa_01", label: "Sofa", abbreviation: "SO" },
  { id: "table_01", label: "Coffee table", abbreviation: "CT" },
  { id: "rug_01", label: "Rug", abbreviation: "RG" },
  { id: "lamp_01", label: "Floor lamp", abbreviation: "FL" },
  { id: "chair_01", label: "Chair", abbreviation: "CH" },
  { id: "plant_01", label: "Plant", abbreviation: "PL" },
] as const;

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

type CopyStatus =
  | { kind: "success"; message: "Prompt copied" }
  | {
      kind: "error";
      message: "Could not copy. Select and copy the prompt manually.";
    }
  | null;

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
  /** Pairing state for the localhost MCP companion. */
  localMcp: LocalMcpRelay;
  scene: Scene;
  state: DemoState;
}

export function RoomCanvas({
  dispatch,
  localMcp,
  scene,
  state,
}: RoomCanvasProps) {
  const toolMode = useSceneStore((store) => store.toolMode);
  const setToolMode = useSceneStore((store) => store.setToolMode);
  const arrangeNaturally = useSceneStore((store) => store.arrangeNaturally);
  const isTransforming = useSceneStore((store) => store.isTransforming);
  const placementNotice = useSceneStore((store) => store.placementNotice);
  const nativeWebMcpAvailable = useSyncExternalStore(
    subscribeToNativeWebMcp,
    getNativeWebMcpSnapshot,
    getServerNativeWebMcpSnapshot,
  );
  const [copyStatus, setCopyStatus] = useState<CopyStatus>(null);
  const copyRequestId = useRef(0);
  const selectedObject = scene.objects.find(
    ({ id }) => id === scene.selectedObjectId,
  );

  async function copyPrompt() {
    const requestId = copyRequestId.current + 1;
    copyRequestId.current = requestId;

    try {
      await navigator.clipboard.writeText(PRIMARY_PROMPT);
      if (copyRequestId.current === requestId) {
        setCopyStatus({ kind: "success", message: "Prompt copied" });
      }
    } catch {
      if (copyRequestId.current === requestId) {
        setCopyStatus({
          kind: "error",
          message: "Could not copy. Select and copy the prompt manually.",
        });
      }
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
            <OpenRoomIcon name="select" />
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
            <OpenRoomIcon name="move" />
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
            <OpenRoomIcon name="rotate" />
            <span>Rotate</span>
          </button>
        </div>

        <section className={styles.objectSection} aria-label="Objects in room">
          <h2 className={styles.visuallyHidden}>Objects in room</h2>
          <ul className={styles.objectList}>
            {ROOM_OBJECTS.map((object) => {
              const isSelected = scene.selectedObjectId === object.id;

              return (
                <li key={object.id}>
                  <button
                    aria-label={object.label}
                    aria-pressed={isSelected}
                    className={
                      isSelected
                        ? styles.objectButtonSelected
                        : styles.objectButton
                    }
                    onClick={() => {
                      dispatch({ type: "select-object", objectId: object.id });
                      dispatch({ type: "show-inspector" });
                    }}
                    title={object.label}
                    type="button"
                  >
                    {object.abbreviation}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
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
            <button
              className={styles.arrangeButton}
              disabled={
                isTransforming || scene.objects.every(({ locked }) => locked)
              }
              onClick={() => arrangeNaturally()}
              type="button"
            >
              Arrange naturally
            </button>
          </div>

          {placementNotice ? (
            <div
              aria-atomic="true"
              aria-label="Placement status"
              className={styles.placementStatus}
              role="status"
            >
              <span>{placementNotice.message}</span>
              {placementNotice.kind === "manual-arranged" ? (
                <button
                  onClick={() => dispatch({ type: "undo" })}
                  type="button"
                >
                  Undo placement
                </button>
              ) : null}
            </div>
          ) : null}

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
                <OpenRoomIcon name="check" size={16} />
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
            <OpenRoomIcon name="sparkles" />
          </span>
          <div className={styles.promptGuidance}>
            <p>{PRIMARY_PROMPT}</p>
            <div className={styles.promptSuggestions}>
              <span className="md-chip md-chip--dense">
                Modern organic, soft neutral textures
              </span>
              <span className="md-chip md-chip--dense">
                Mid-century, warm walnut and brass
              </span>
            </div>
            <div className={styles.agentStatusRow}>
              <div
                aria-label="Native WebMCP status"
                className="md-chip md-chip--dense"
                role="status"
              >
                Native WebMCP:{" "}
                {nativeWebMcpAvailable ? "Available" : "Unavailable"}
              </div>
              <LocalAgentStatus relay={localMcp} />
            </div>
          </div>
          <button
            className={`md-button md-button--filled ${styles.agentButton}`}
            onClick={copyPrompt}
            type="button"
          >
            Copy redesign prompt
          </button>
          {copyStatus ? (
            <span
              aria-label="Prompt copy status"
              className={
                copyStatus.kind === "success"
                  ? styles.copyStatusSuccess
                  : styles.copyStatusError
              }
              role="status"
            >
              {copyStatus.message}
            </span>
          ) : null}
        </section>
      </main>
    </div>
  );
}
