import type { Dispatch } from "react";
import { PHOTO_ASSETS } from "../photo/photo-assets";
import { facingOf, rotationYOf } from "../photo/photo-facing";
import type { Scene, SceneObject } from "../scene/scene-schema";
import { supportOf } from "../scene/support";
import { DEMO_PRODUCTS } from "./demo-data";
import type { DemoAction, DemoState } from "./demo-types";
import { humanizeSlug, objectDisplayName } from "./object-labels";
import { OpenRoomIcon } from "./open-room-icon";
import styles from "./demo-workspace.module.css";

interface ContextPanelProps {
  dispatch: Dispatch<DemoAction>;
  scene: Scene;
  state: DemoState;
}

function formatPrice(priceMinor: number) {
  return `$${Math.round(priceMinor / 100).toLocaleString("en-US")}`;
}

function formatDimensions(object: SceneObject) {
  const { width, height, depth } = object.dimensionsM;
  const cm = (metres: number) => Math.round(metres * 100);
  return `W ${cm(width)} · D ${cm(depth)} · H ${cm(height)} cm`;
}

/**
 * Where the piece faces, in words. Yaw 0 faces the camera; a positive yaw
 * turns the front toward the viewer's left (`forward = {-sin, cos}`).
 */
export function describeFacing(rotationY: number): string {
  const yaw = rotationYOf(facingOf(rotationY));
  const degrees = Math.round((yaw * 180) / Math.PI);
  const magnitude = Math.abs(degrees);
  if (magnitude <= 5) return "Toward the camera";
  if (magnitude >= 175) return "Away from the camera";
  return `Turned ${magnitude}° to the ${degrees > 0 ? "left" : "right"}`;
}

/** What people read in the Style row: humanised catalog data or the seed tags. */
function describeStyle(object: SceneObject): string {
  if (object.product) {
    return [object.product.material, object.product.color]
      .filter((value): value is string => Boolean(value))
      .map(humanizeSlug)
      .join(" · ");
  }
  if (object.styleTags.length > 0) {
    return object.styleTags.map(humanizeSlug).join(" · ");
  }
  return "Original piece";
}

const CATEGORY_HEADINGS: Readonly<Record<SceneObject["type"], string>> = {
  sofa: "Sofas for your room",
  coffee_table: "Coffee tables for your room",
  rug: "Rugs for your room",
  floor_lamp: "Lamps for your room",
  chair: "Chairs for your room",
  plant: "Plants for your room",
  side_table: "Side tables for your room",
  bookshelf: "Bookshelves and storage for your room",
  unknown: "Products for your room",
};

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
        <h2>Nothing selected</h2>
        <p>Click any piece in the photo, or pick one from the list on the left.</p>
      </div>
    );
  }

  // Spec §5: a lamp standing on a table reads as such rather than as a lamp with a
  // surprising Y; unsupported objects keep the panel exactly as it was.
  const supporter = supportOf(scene, selectedObject);

  return (
    <section className={styles.inspectorPanel} aria-labelledby="inspector-title">
      <div className={styles.panelHeading}>
        <span className={styles.panelEyebrow}>Selected</span>
        <h2 id="inspector-title">{objectDisplayName(selectedObject)}</h2>
        {selectedObject.product ? (
          <p>{formatPrice(selectedObject.product.price.amountMinor)}</p>
        ) : null}
      </div>

      <dl className={styles.objectSummary}>
        <div>
          <dt>Size</dt>
          <dd>{formatDimensions(selectedObject)}</dd>
        </div>
        <div>
          <dt>Faces</dt>
          <dd>{describeFacing(selectedObject.rotation[1])}</dd>
        </div>
        {supporter ? (
          <div>
            <dt>On</dt>
            <dd>{objectDisplayName(supporter)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Style</dt>
          <dd>{describeStyle(selectedObject)}</dd>
        </div>
      </dl>

      <div className={`md-card md-card--outlined ${styles.lockRow}`}>
        <span className={styles.lockMark} aria-hidden="true">
          〼
        </span>
        <span>
          <strong>{selectedObject.locked ? "Position locked" : "Stays in place"}</strong>
          <small>Swapping keeps this spot and angle.</small>
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
    ? CATEGORY_HEADINGS[selectedObject.type]
    : "Products for your room";

  return (
    <section
      aria-labelledby="products-title"
      aria-label={categoryHeading}
      className={styles.productsPanel}
    >
      <div className={styles.panelHeadingWithAction}>
        <div>
          <span className={styles.panelEyebrow}>Alternatives</span>
          <h2 id="products-title">{categoryHeading}</h2>
        </div>
        <button
          className={styles.textButton}
          onClick={() => dispatch({ type: "show-inspector" })}
          type="button"
        >
          Back
        </button>
      </div>
      <p className={styles.panelIntro}>
        Every option is sized to fit the selected piece&apos;s spot.
      </p>

      <div className={styles.productList}>
        {alternatives.map((product, index) => {
          const isPlaced = product.id === selectedObject?.product?.id;

          return (
            <article
              className={isPlaced ? styles.productActive : styles.product}
              key={product.id}
            >
              {PHOTO_ASSETS[product.id] ? (
                <div aria-hidden="true" className={styles.productThumb}>
                  {/* Registered local cutout; the native box keeps the aspect exact. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt=""
                    decoding="async"
                    loading="lazy"
                    src={PHOTO_ASSETS[product.id]!.src}
                  />
                </div>
              ) : (
                <div
                  aria-hidden="true"
                  className={styles.productMaterial}
                  data-material={index + 1}
                >
                  <span />
                </div>
              )}
              <div className={styles.productCopy}>
                <div className={styles.productTitleRow}>
                  <h3>{product.title}</h3>
                  <strong>{formatPrice(product.price.amountMinor)}</strong>
                </div>
                <p>{product.description}</p>
                <button
                  aria-label={
                    isPlaced
                      ? `${product.title} is in your room`
                      : `Place ${product.title} in room`
                  }
                  aria-pressed={isPlaced}
                  className={
                    isPlaced ? styles.previewButtonActive : styles.previewButton
                  }
                  onClick={() =>
                    dispatch({
                      type: "preview-product",
                      productId: product.id,
                    })
                  }
                  type="button"
                >
                  {isPlaced ? "In your room" : "Place in room"}
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
          <span className={styles.panelEyebrow}>Human + AI app co-edit</span>
          <h2 id="activity-title">AI app activity</h2>
        </div>
        <button
          className={styles.textButton}
          onClick={() => dispatch({ type: "show-inspector" })}
          type="button"
        >
          Back
        </button>
      </div>

      <p className={`md-card md-card--outlined ${styles.agentPrompt}`}>
        Changes made by your AI app appear here as they happen.
      </p>

      <div className={`md-card md-card--outlined ${styles.revisionCard}`}>
        <span className={styles.revisionSpark} aria-hidden="true">
          <OpenRoomIcon name="sparkles" size={17} />
        </span>
        <span>
          <small>Room version</small>
          <strong>Revision {scene.revision}</strong>
        </span>
      </div>
      <p className={styles.activityDisclosure}>
        Ask your AI app to read the room again after each change, then use the
        revision above to confirm it saw the latest one.
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
