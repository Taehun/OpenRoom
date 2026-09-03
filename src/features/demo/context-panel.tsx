import type { Dispatch } from "react";
import { facingOf, roundFacing } from "../photo/photo-facing";
import { getPhotoAssetSet, selectPhotoView } from "../photo/photo-views";
import type { Scene, SceneObject } from "../scene/scene-schema";
import { DEMO_PRODUCTS } from "./demo-data";
import type { DemoAction, DemoState } from "./demo-types";
import { OpenRoomIcon } from "./open-room-icon";
import styles from "./demo-workspace.module.css";

interface ContextPanelProps {
  dispatch: Dispatch<DemoAction>;
  scene: Scene;
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

function formatCoordinate(value: number) {
  const magnitude = Math.abs(value).toFixed(2);
  return value < 0 ? `−${magnitude}` : magnitude;
}

function formatDimensions(object: SceneObject) {
  const { width, height, depth } = object.dimensionsM;
  return `${Math.round(width * 100)} × ${Math.round(depth * 100)} × ${Math.round(height * 100)} cm`;
}

function formatPosition(object: SceneObject) {
  const [x, y, z] = object.position;
  return `X ${formatCoordinate(x)} · Y ${formatCoordinate(y)} · Z ${formatCoordinate(z)}`;
}

function formatRotation(object: SceneObject) {
  return object.rotation
    .map((radians) => `${Math.round((radians * 180) / Math.PI)}°`)
    .join(" · ");
}

/**
 * The derived facing plus the registered view the compositor actually drew, so
 * a mirrored twin or an only-approximate view is disclosed rather than hidden.
 */
function formatFacing(object: SceneObject) {
  const facing = roundFacing(facingOf(object.rotation[1]));
  const parts = [
    `x ${formatCoordinate(facing.x)}`,
    `z ${formatCoordinate(facing.z)}`,
  ];
  const set = getPhotoAssetSet(object);
  if (set && object.type !== "rug") {
    const view = selectPhotoView(object, set);
    parts.push(view.view.view);
    if (view.mirrored) parts.push("mirrored");
    if (!view.exact) parts.push("approximate");
  }
  return parts.join(" · ");
}

function InspectorPanel({
  dispatch,
  scene,
}: {
  dispatch: Dispatch<DemoAction>;
  scene: Scene;
}) {
  const selectedObject = scene.objects.find(
    ({ id }) => id === scene.selectedObjectId,
  );

  if (!selectedObject) {
    return (
      <div className={styles.emptyInspector}>
        <span className={styles.panelEyebrow}>Selection</span>
        <h2>No object selected</h2>
        <p>Choose an object from the rail to inspect it in the room.</p>
      </div>
    );
  }

  const selectedName = OBJECT_NAMES[selectedObject.id] ?? "Room object";
  const style = selectedObject.product
    ? [selectedObject.product.material, selectedObject.product.color]
        .filter(Boolean)
        .join(" · ")
    : selectedObject.styleTags.length > 0
      ? selectedObject.styleTags.join(" · ")
      : "Placeholder · Natural";

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
          <dd>{formatDimensions(selectedObject)}</dd>
        </div>
        <div>
          <dt>Position</dt>
          <dd>{formatPosition(selectedObject)}</dd>
        </div>
        <div>
          <dt>Rotation</dt>
          <dd>{formatRotation(selectedObject)}</dd>
        </div>
        <div>
          <dt>Facing</dt>
          <dd>{formatFacing(selectedObject)}</dd>
        </div>
        <div>
          <dt>Style</dt>
          <dd>{style}</dd>
        </div>
      </dl>

      <div className={`md-card md-card--outlined ${styles.lockRow}`}>
        <span className={styles.lockMark} aria-hidden="true">
          〼
        </span>
        <span>
          <strong>{selectedObject.locked ? "Placement locked" : "Placement editable"}</strong>
          <small>Preview swaps preserve this transform.</small>
        </span>
      </div>

      <button
        className={`md-button md-button--filled ${styles.primaryPanelButton}`}
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
  scene,
}: {
  dispatch: Dispatch<DemoAction>;
  scene: Scene;
}) {
  const selectedObject = scene.objects.find(
    ({ id }) => id === scene.selectedObjectId,
  );
  const alternatives = selectedObject
    ? DEMO_PRODUCTS.filter(({ category }) => category === selectedObject.type)
    : [];
  const categoryHeading = selectedObject
    ? {
        sofa: "Sofas for your room",
        coffee_table: "Coffee tables for your room",
        rug: "Rugs for your room",
        floor_lamp: "Floor lamps for your room",
        chair: "Chairs for your room",
        plant: "Plants for your room",
        side_table: "Side tables for your room",
        bookshelf: "Bookshelves and storage for your room",
        unknown: "Products for your room",
      }[selectedObject.type]
    : "Products for your room";

  return (
    <section
      aria-labelledby="products-title"
      aria-label={categoryHeading}
      className={styles.productsPanel}
    >
      <div className={styles.panelHeadingWithAction}>
        <div>
          <span className={styles.panelEyebrow}>Product alternatives</span>
          <h2 id="products-title">{categoryHeading}</h2>
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
        Locally cached fixtures, fitted to the selected footprint.
      </p>

      <div className={styles.productList}>
        {alternatives.map((product, index) => {
          const isPreviewing = product.id === selectedObject?.product?.id;

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
                  <h3>{product.title}</h3>
                  <strong>{formatPrice(product.price.amountMinor)}</strong>
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
                  {isPreviewing ? "Active preview" : `Preview ${product.title}`}
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
  scene,
}: {
  dispatch: Dispatch<DemoAction>;
  scene: Scene;
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

      <p className={`md-card md-card--outlined ${styles.agentPrompt}`}>
        Real agent actions appear through the active agent surface.
      </p>

      <div className={`md-card md-card--outlined ${styles.revisionCard}`}>
        <span className={styles.revisionSpark} aria-hidden="true">
          <OpenRoomIcon name="sparkles" size={17} />
        </span>
        <span>
          <small>Scene diagnostics</small>
          <strong>Current Scene · rev {scene.revision}</strong>
        </span>
      </div>
      <p className={styles.activityDisclosure}>
        Ask the agent to read the latest Scene after each change, then use the
        revision above to confirm that the workspace received it.
      </p>
    </section>
  );
}

export function ContextPanel({ dispatch, scene, state }: ContextPanelProps) {
  return (
    <aside className={styles.contextPanel} aria-label="Room context">
      {state.mode === "inspector" ? (
        <InspectorPanel dispatch={dispatch} scene={scene} />
      ) : null}
      {state.mode === "products" ? (
        <ProductsPanel dispatch={dispatch} scene={scene} />
      ) : null}
      {state.mode === "activity" ? (
        <ActivityPanel dispatch={dispatch} scene={scene} />
      ) : null}
    </aside>
  );
}
