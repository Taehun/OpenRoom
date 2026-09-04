"use client";

import {
  type Dispatch,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import {
  SceneStoreProvider,
  useSceneStore,
  useSceneStoreApi,
} from "../scene/scene-context";
import type { SceneStore } from "../scene/scene-store";
import { CartApprovalSheet } from "./cart-approval-sheet";
import { ContextPanel } from "./context-panel";
import { createInitialDemoState, demoReducer } from "./demo-state";
import { DEMO_PRODUCTS } from "./demo-data";
import type { DemoAction } from "./demo-types";
import { RoomCanvas } from "./room-canvas";
import Link from "next/link";
import { OpenRoomIcon } from "./open-room-icon";
import { WorkspaceHeader } from "./workspace-header";
import styles from "./demo-workspace.module.css";
import type { ToolContext } from "../../webmcp/tool-context";
import { useWebMcpTools } from "../../webmcp/use-webmcp-tools";
import { useLocalMcpRelay } from "../../local-mcp/use-local-mcp-relay";
import { ACTIVE_COMMERCE } from "../commerce/commerce-runtime";
import { cartDraftForScene } from "../commerce/scene-cart";
import { enrichCartDraft } from "../commerce/shopify-cart";
import type { CommerceContext } from "../commerce/commerce-types";

/** How long an approval announcement stays on screen. */
const ANNOUNCEMENT_MS = 4000;

interface DemoWorkspaceProps {
  store?: SceneStore;
  commerce?: CommerceContext;
  /** Renders a header link back to the WebMCP guide when provided. */
  guideHref?: string;
}

export function DemoWorkspace({
  store,
  commerce = ACTIVE_COMMERCE,
  guideHref,
}: DemoWorkspaceProps = {}) {
  return (
    <SceneStoreProvider store={store}>
      <DemoWorkspaceContent commerce={commerce} guideHref={guideHref} />
    </SceneStoreProvider>
  );
}

function DemoWorkspaceContent({
  commerce,
  guideHref,
}: {
  commerce: CommerceContext;
  guideHref?: string | undefined;
}) {
  const [state, dispatch] = useReducer(
    demoReducer,
    undefined,
    createInitialDemoState,
  );

  // An announcement is a toast, not a banner: it reads once through the live
  // region and leaves before it can cover the next action. Each one carries a
  // nonce, so a second approval is a new object here and restarts the timer
  // rather than expiring on the first one's clock.
  useEffect(() => {
    if (state.announcement === null) return;
    const timer = window.setTimeout(
      () => dispatch({ type: "clear-announcement" }),
      ANNOUNCEMENT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [state.announcement]);
  const sceneStore = useSceneStoreApi();
  const scene = useSceneStore((store) => store.scene);
  const historyLength = useSceneStore((store) => store.history.length);
  const cartButtonRef = useRef<HTMLButtonElement | null>(null);
  const wasCartOpenRef = useRef(false);
  const roomTotalMinor = scene.objects.reduce(
    (total, object) => total + (object.product?.price.amountMinor ?? 0),
    0,
  );
  const selectedObject = scene.objects.find(
    ({ id }) => id === scene.selectedObjectId,
  );
  const toolContext = useMemo<ToolContext>(
    () => ({
      getScene: () => sceneStore.getState().scene,
      getStateVersion: () => sceneStore.getState().stateVersion,
      getSelection: () => {
        const { scene: currentScene } = sceneStore.getState();
        return (
          currentScene.objects.find(
            ({ id }) => id === currentScene.selectedObjectId,
          ) ?? null
        );
      },
      searchProducts: ({ category, query, limit }) => {
        const normalizedQuery = query?.toLowerCase();
        return DEMO_PRODUCTS.filter(
          (product) =>
            category === undefined || product.category === category,
        )
          .filter(
            (product) =>
              normalizedQuery === undefined ||
              [
                product.title,
                product.description,
                ...product.styleTags,
                product.color ?? "",
                product.material ?? "",
              ].some((value) =>
                value.toLowerCase().includes(normalizedQuery),
              ),
          )
          .slice(0, limit);
      },
      resolveProduct: (productId) =>
        DEMO_PRODUCTS.find((product) => product.id === productId),
      applyCommand: (request) =>
        sceneStore.getState().applyCommand(request),
      openCartApproval: (draft) =>
        dispatch({ type: "open-cart", draft }),
      commerce,
    }),
    [sceneStore, commerce],
  );

  useWebMcpTools(toolContext);
  const localMcp = useLocalMcpRelay(toolContext);

  const routeAction = useCallback<Dispatch<DemoAction>>(
    (action) => {
      const store = sceneStore.getState();

      if (action.type === "select-object") {
        store.selectObject(action.objectId);
        dispatch(action);
        return;
      }

      if (action.type === "preview-product") {
        const product = DEMO_PRODUCTS.find(({ id }) => id === action.productId);
        const objectId = store.scene.selectedObjectId;
        if (!product || !objectId) return;
        const sceneProduct = {
          id: product.id,
          variantId: product.variantId,
          title: product.title,
          category: product.category,
          price: product.price,
          dimensionsCm: product.dimensionsCm,
          styleTags: product.styleTags,
          color: product.color,
          material: product.material,
        };

        const result = store.applyCommand({
          expectedRevision: store.scene.revision,
          actor: "human",
          command: { type: "replace", objectId, product: sceneProduct },
        });
        if (result.ok) dispatch(action);
        return;
      }

      if (action.type === "undo") {
        if (store.undo()) dispatch(action);
        return;
      }

      if (action.type === "reset") {
        store.reset();
        dispatch(action);
        return;
      }

      // The header opens the cart without a draft: the cart is the room, so
      // build it here exactly the way `add_scene_to_cart` does.
      if (action.type === "open-cart" && !action.draft) {
        dispatch({
          type: "open-cart",
          draft: enrichCartDraft(
            commerce,
            cartDraftForScene(store.scene, store.scene.objects),
          ),
        });
        return;
      }

      dispatch(action);
    },
    [commerce, sceneStore],
  );

  useEffect(() => {
    if (wasCartOpenRef.current && !state.isCartOpen) {
      cartButtonRef.current?.focus();
    }

    wasCartOpenRef.current = state.isCartOpen;
  }, [state.isCartOpen]);

  useEffect(() => {
    function handleWorkspaceKeyDown(event: KeyboardEvent) {
      // The room shortcuts are the room's. A modal dialog, a text field, or a
      // handler that already acted owns the key first: Escape inside the
      // pairing dialog closes the dialog, not the selection, and ⌘Z there
      // undoes typing, not the last placement.
      if (
        event.defaultPrevented ||
        document.querySelector("dialog[open]") ||
        (event.target instanceof HTMLElement &&
          (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) ||
            event.target.isContentEditable))
      ) {
        return;
      }

      if (event.key === "Escape") {
        routeAction(
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
        routeAction({ type: "undo" });
      }
    }

    window.addEventListener("keydown", handleWorkspaceKeyDown);
    return () => window.removeEventListener("keydown", handleWorkspaceKeyDown);
  }, [routeAction, state.isCartOpen]);

  return (
    <div className={styles.workspace}>
      <div aria-hidden={state.isCartOpen || undefined} inert={state.isCartOpen}>
        <WorkspaceHeader
          cartButtonRef={cartButtonRef}
          canUndo={historyLength > 0}
          dispatch={routeAction}
          guideHref={guideHref}
          roomTotalMinor={roomTotalMinor}
          scene={scene}
        />
        <div className={styles.workspaceBody}>
          <RoomCanvas
            dispatch={routeAction}
            localMcp={localMcp}
            scene={scene}
            state={state}
          />
          <ContextPanel dispatch={routeAction} scene={scene} state={state} />
        </div>

        <div
          aria-atomic="true"
          aria-live="polite"
          className={styles.liveRegion}
          data-testid="announcement-toast"
          role="status"
        >
          {state.announcement?.tone === "toast" ? state.announcement.text : null}
        </div>

        {/* Edits, undo, reset and deselection are obvious on screen and
            invisible to a screen reader; they are said here instead of over
            the room. */}
        <div
          aria-atomic="true"
          aria-live="polite"
          className={styles.visuallyHidden}
          data-testid="announcement-quiet"
          role="status"
        >
          {state.announcement?.tone === "quiet" ? state.announcement.text : null}
        </div>

        {/*
          A test and debugging surface, not a status message: it repeats ids the
          UI already says in words, so it is hidden from assistive technology
          and located by its test id.
        */}
        <output
          aria-hidden="true"
          className={styles.visuallyHidden}
          data-testid="scene-diagnostics"
        >
          Revision {scene.revision} · {scene.selectedObjectId ?? "none"} ·{" "}
          {selectedObject?.product?.id ?? "placeholder"}
        </output>
      </div>

      {/* Under 1000px the editor cannot lay out; a single in-flow surface
          replaces it (CSS swaps the two) instead of a sideways-scrolling
          workspace behind a toast. */}
      <section aria-label="Window too narrow" className={styles.narrowGate}>
        <OpenRoomIcon name="sparkles" size={28} />
        <p>The room editor needs a window at least 1000px wide.</p>
        <Link className="md-button md-button--tonal" href="/?view=guide">
          Read the guide
        </Link>
      </section>

      {state.isCartOpen ? (
        <CartApprovalSheet
          commerce={commerce}
          dispatch={routeAction}
          // `routeAction` always attaches a draft; the fallback only keeps the
          // sheet honest if some future dispatcher forgets to.
          draft={
            state.cartDraft ??
            enrichCartDraft(commerce, cartDraftForScene(scene, scene.objects))
          }
        />
      ) : null}
    </div>
  );
}
