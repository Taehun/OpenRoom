import type { Dispatch } from "react";
import { DEMO_PRODUCTS } from "./demo-data";
import type { DemoAction, DemoState } from "./demo-types";
import { NookIcon } from "./nook-icon";
import styles from "./demo-workspace.module.css";

interface ContextPanelProps {
  dispatch: Dispatch<DemoAction>;
  state: DemoState;
}

const OBJECT_NAMES: Record<string, string> = {
  sofa_01: "Linen sofa",
  table_01: "Coffee table",
  rug_01: "Woven rug",
  lamp_01: "Floor lamp",
  chair_01: "Lounge chair",
  plant_01: "Fiddle-leaf fig",
};

function formatPrice(priceMinor: number) {
  return `$${Math.round(priceMinor / 100).toLocaleString("en-US")}`;
}

function InspectorPanel({
  dispatch,
  state,
}: {
  dispatch: Dispatch<DemoAction>;
  state: DemoState;
}) {
  if (!state.selectedObjectId) {
    return (
      <div className={styles.emptyInspector}>
        <span className={styles.panelEyebrow}>Selection</span>
        <h2>No object selected</h2>
        <p>Choose an object from the rail to inspect it in the room.</p>
      </div>
    );
  }

  const selectedName = OBJECT_NAMES[state.selectedObjectId] ?? "Room object";

  return (
    <section className={styles.inspectorPanel} aria-labelledby="inspector-title">
      <div className={styles.panelHeading}>
        <span className={styles.panelEyebrow}>Selected object</span>
        <h2 id="inspector-title">Object inspector</h2>
        <p>{selectedName}</p>
      </div>

      <dl className={styles.objectSummary}>
        <div>
          <dt>Dimensions</dt>
          <dd>120 × 60 × 38 cm</dd>
        </div>
        <div>
          <dt>Position</dt>
          <dd>X 0.00 · Y 0.00 · Z −0.84</dd>
        </div>
        <div>
          <dt>Rotation</dt>
          <dd>0° · 0° · 0°</dd>
        </div>
        <div>
          <dt>Style</dt>
          <dd>Warm oak · Natural</dd>
        </div>
      </dl>

      <div className={styles.lockRow}>
        <span className={styles.lockMark} aria-hidden="true">
          〼
        </span>
        <span>
          <strong>Placement locked</strong>
          <small>Preview swaps preserve this transform.</small>
        </span>
      </div>

      <button
        className={styles.primaryPanelButton}
        onClick={() => dispatch({ type: "show-products" })}
        type="button"
      >
        Find alternatives
      </button>
    </section>
  );
}

function ProductsPanel({
  dispatch,
  state,
}: {
  dispatch: Dispatch<DemoAction>;
  state: DemoState;
}) {
  return (
    <section
      aria-labelledby="products-title"
      aria-label="Tables for your room"
      className={styles.productsPanel}
    >
      <div className={styles.panelHeadingWithAction}>
        <div>
          <span className={styles.panelEyebrow}>Product alternatives</span>
          <h2 id="products-title">Tables for your room</h2>
        </div>
        <button
          className={styles.textButton}
          onClick={() => dispatch({ type: "show-inspector" })}
          type="button"
        >
          Inspector
        </button>
      </div>
      <p className={styles.panelIntro}>
        Three locally cached fixtures, fitted to the selected footprint.
      </p>

      <div className={styles.productList}>
        {DEMO_PRODUCTS.map((product, index) => {
          const isPreviewing = product.id === state.previewProductId;

          return (
            <article
              className={isPreviewing ? styles.productActive : styles.product}
              key={product.id}
            >
              <div
                aria-hidden="true"
                className={styles.productMaterial}
                data-material={index + 1}
              >
                <span />
              </div>
              <div className={styles.productCopy}>
                <div className={styles.productTitleRow}>
                  <h3>{product.name}</h3>
                  <strong>{formatPrice(product.priceMinor)}</strong>
                </div>
                <p>{product.description}</p>
                <button
                  aria-pressed={isPreviewing}
                  className={
                    isPreviewing
                      ? styles.previewButtonActive
                      : styles.previewButton
                  }
                  onClick={() =>
                    dispatch({
                      type: "preview-product",
                      productId: product.id,
                    })
                  }
                  type="button"
                >
                  {isPreviewing ? "Active preview" : `Preview ${product.name}`}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ActivityPanel({
  dispatch,
  state,
}: {
  dispatch: Dispatch<DemoAction>;
  state: DemoState;
}) {
  return (
    <section className={styles.activityPanel} aria-labelledby="activity-title">
      <div className={styles.panelHeadingWithAction}>
        <div>
          <span className={styles.panelEyebrow}>Human + Agent co-edit</span>
          <h2 id="activity-title">Agent activity</h2>
        </div>
        <button
          className={styles.textButton}
          onClick={() => dispatch({ type: "show-inspector" })}
          type="button"
        >
          Inspector
        </button>
      </div>

      <blockquote className={styles.agentPrompt}>
        “Move the lamp to work with this layout.”
      </blockquote>

      <ol className={styles.activityList}>
        <li>
          <span className={styles.activityIcon} aria-hidden="true">
            01
          </span>
          <div>
            <strong>get_scene</strong>
            <p>Read 6 objects from revision {state.revision - 1}.</p>
          </div>
          <span className={styles.completeState}>Complete</span>
        </li>
        <li>
          <span className={styles.activityIcon} aria-hidden="true">
            02
          </span>
          <div>
            <strong>move_object</strong>
            <p>Moved floor_lamp_01 by 42 cm.</p>
          </div>
          <span className={styles.completeState}>Complete</span>
        </li>
      </ol>

      <div className={styles.revisionCard}>
        <span className={styles.revisionSpark} aria-hidden="true">
          <NookIcon name="sparkles" size={17} />
        </span>
        <span>
          <small>Scene committed</small>
          <strong>Agent result · rev {state.revision}</strong>
        </span>
      </div>
      <p className={styles.activityDisclosure}>
        This activity is deterministic UI. No Agent or provider was called.
      </p>
    </section>
  );
}

export function ContextPanel({ dispatch, state }: ContextPanelProps) {
  return (
    <aside className={styles.contextPanel} aria-label="Room context">
      {state.mode === "inspector" ? (
        <InspectorPanel dispatch={dispatch} state={state} />
      ) : null}
      {state.mode === "products" ? (
        <ProductsPanel dispatch={dispatch} state={state} />
      ) : null}
      {state.mode === "activity" ? (
        <ActivityPanel dispatch={dispatch} state={state} />
      ) : null}
    </aside>
  );
}
