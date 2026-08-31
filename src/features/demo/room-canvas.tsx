import Image from "next/image";
import type { Dispatch, FormEvent } from "react";
import type { Scene } from "../scene/scene-schema";
import type { DemoAction, DemoState } from "./demo-types";
import { NookIcon } from "./nook-icon";
import styles from "./demo-workspace.module.css";

const ROOM_OBJECTS = [
  { id: "sofa_01", label: "Sofa", abbreviation: "SO" },
  { id: "table_01", label: "Coffee table", abbreviation: "CT" },
  { id: "rug_01", label: "Rug", abbreviation: "RG" },
  { id: "lamp_01", label: "Floor lamp", abbreviation: "FL" },
  { id: "chair_01", label: "Chair", abbreviation: "CH" },
  { id: "plant_01", label: "Plant", abbreviation: "PL" },
] as const;

interface RoomCanvasProps {
  dispatch: Dispatch<DemoAction>;
  scene: Scene;
  state: DemoState;
}

export function RoomCanvas({ dispatch, scene, state }: RoomCanvasProps) {
  const selectedObject = scene.objects.find(
    ({ id }) => id === scene.selectedObjectId,
  );
  const previewProduct = scene.objects.find(
    ({ id }) => id === "table_01",
  )?.product;

  function runAgentMove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    dispatch({ type: "run-agent-move" });
  }

  return (
    <div className={styles.canvasShell}>
      <aside className={styles.toolRail} aria-label="Room tools">
        <div className={styles.toolButtons}>
          <p className={styles.visuallyHidden} id="transform-tools-unavailable">
            Move and Rotate are not available in this read-only demo workspace.
          </p>
          <button
            aria-label="Select tool"
            aria-pressed="true"
            className={styles.toolButtonActive}
            title="Select"
            type="button"
          >
            <NookIcon name="select" />
            <span>Select</span>
          </button>
          <button
            aria-label="Move tool"
            aria-describedby="transform-tools-unavailable"
            aria-pressed="false"
            className={styles.toolButton}
            disabled
            title="Unavailable in this read-only demo"
            type="button"
          >
            <NookIcon name="move" />
            <span>Move</span>
          </button>
          <button
            aria-label="Rotate tool"
            aria-describedby="transform-tools-unavailable"
            aria-pressed="false"
            className={styles.toolButton}
            disabled
            title="Unavailable in this read-only demo"
            type="button"
          >
            <NookIcon name="rotate" />
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
          <Image
            alt="Warm living room with a cream sofa, oak coffee table, woven rug, floor lamp, chair, and potted plant."
            className={styles.roomImage}
            fill
            preload
            sizes="(min-width: 1280px) calc(100vw - 432px), 66vw"
            src="/demo/nook-room.png"
          />
          <figcaption className={styles.visuallyHidden}>
            Approximate room visualization. Use the object list to inspect every
            scene object.
          </figcaption>

          <div className={styles.canvasTopbar}>
            <span className={styles.demoBadge}>Deterministic demo</span>
            <span>Approximate visualization</span>
          </div>

          {scene.selectedObjectId === "table_01" ? (
            <div className={styles.tableSelection} aria-hidden="true">
              <span>
                {previewProduct
                  ? `Previewing ${previewProduct.title}`
                  : "Coffee table · selected"}
              </span>
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

        <form className={styles.composer} onSubmit={runAgentMove}>
          <span className={styles.composerIcon} aria-hidden="true">
            <NookIcon name="sparkles" />
          </span>
          <label className={styles.visuallyHidden} htmlFor="agent-prompt">
            Agent instruction
          </label>
          <input
            defaultValue="Move the lamp to work with this layout."
            id="agent-prompt"
            type="text"
          />
          <button className={styles.agentButton} type="submit">
            Run Agent move
          </button>
        </form>
      </main>
    </div>
  );
}
