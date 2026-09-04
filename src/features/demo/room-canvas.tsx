import {
  type Dispatch,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { LocalMcpRelay } from "../../local-mcp/use-local-mcp-relay";
import { getDocumentModelContext } from "../../webmcp/register-tools";
import { RoomPhotoStage } from "../photo/room-photo-stage";
import { useSceneStore } from "../scene/scene-context";
import type { Scene, SceneObjectType } from "../scene/scene-schema";
import type { DemoAction, DemoState } from "./demo-types";
import { LocalAgentStatus } from "./local-agent-status";
import { OpenRoomIcon } from "./open-room-icon";
import { OBJECT_ABBREVIATIONS, OBJECT_LABELS, objectDisplayName } from "./object-labels";
import styles from "./demo-workspace.module.css";

const ROOM_OBJECTS = [
  { id: "sofa_01", type: "sofa" },
  { id: "table_01", type: "coffee_table" },
  { id: "rug_01", type: "rug" },
  { id: "lamp_01", type: "floor_lamp" },
  { id: "chair_01", type: "chair" },
  { id: "plant_01", type: "plant" },
] as const satisfies readonly { id: string; type: SceneObjectType }[];

/** How long the copy confirmation stays on screen. */
const COPY_STATUS_MS = 2500;

const PRIMARY_PROMPT =
  "Redesign this room as a warm, minimal Japandi interior. Swap the dated pieces for catalog products that go together, keep the sofa on the left, and leave a clear path to the windows. Read the room again after each change.";

export { OBJECT_ABBREVIATIONS, OBJECT_LABELS } from "./object-labels";

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
  const nativeWebMcpAvailable = useSyncExternalStore(
    subscribeToNativeWebMcp,
    getNativeWebMcpSnapshot,
    getServerNativeWebMcpSnapshot,
  );
  const [copyStatus, setCopyStatus] = useState<CopyStatus>(null);
  // "Prompt copied" is a confirmation, not a state: it leaves on its own.
  useEffect(() => {
    if (!copyStatus) return;
    const timer = window.setTimeout(() => setCopyStatus(null), COPY_STATUS_MS);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);
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
            title="Move the selected piece (arrow keys; hold Shift for bigger steps)"
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
            title="Turn the selected piece (← → keys; hold Shift for bigger steps)"
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
              const label = OBJECT_LABELS[object.type];

              return (
                <li key={object.id}>
                  <button
                    aria-label={label}
                    aria-pressed={isSelected}
                    className={
                      isSelected
                        ? styles.objectButtonSelected
                        : styles.objectButton
                    }
                    data-rail-object-id={object.id}
                    onClick={() => {
                      dispatch({ type: "select-object", objectId: object.id });
                      dispatch({ type: "show-inspector" });
                    }}
                    title={label}
                    type="button"
                  >
                    {OBJECT_ABBREVIATIONS[object.type]}
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


          {selectedObject ? (
            <div className={styles.sceneSelectionLabel} aria-hidden="true">
              {objectDisplayName(selectedObject)}
            </div>
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
          aria-label="AI app prompt"
          className={styles.composer}
        >
          <span className={styles.composerIcon} aria-hidden="true">
            <OpenRoomIcon name="sparkles" />
          </span>
          <div className={styles.promptGuidance}>
            <p>{PRIMARY_PROMPT}</p>
            <div className={styles.composerChips}>
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
                  aria-label="In-browser AI status"
                  className="md-chip md-chip--dense"
                  role="status"
                >
                  In-browser AI:{" "}
                  {nativeWebMcpAvailable ? "Ready" : "Not available"}
                </div>
                <LocalAgentStatus relay={localMcp} />
              </div>
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
