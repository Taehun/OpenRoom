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
import { CartApprovalSheet } from "./cart-approval-sheet";
import { ContextPanel } from "./context-panel";
import { createInitialDemoState, demoReducer } from "./demo-state";
import { DEMO_PRODUCTS } from "./demo-data";
import type { DemoAction } from "./demo-types";
import { RoomCanvas } from "./room-canvas";
import { WorkspaceHeader } from "./workspace-header";
import styles from "./demo-workspace.module.css";
import type { ToolContext } from "../../webmcp/tool-context";
import { useWebMcpTools } from "../../webmcp/use-webmcp-tools";

export function DemoWorkspace() {
  return (
    <SceneStoreProvider>
      <DemoWorkspaceContent />
    </SceneStoreProvider>
  );
}

function DemoWorkspaceContent() {
  const [state, dispatch] = useReducer(
    demoReducer,
    undefined,
    createInitialDemoState,
  );
  const sceneStore = useSceneStoreApi();
  const scene = useSceneStore((store) => store.scene);
  const historyLength = useSceneStore((store) => store.history.length);
  const cartButtonRef = useRef<HTMLButtonElement | null>(null);
  const wasCartOpenRef = useRef(false);
  const roomTotalMinor = scene.objects.reduce(
    (total, object) => total + (object.product?.price.amountMinor ?? 0),
    0,
  );
  const provider = roomTotalMinor > 0 ? "Cached" : "Demo fallback";
  const selectedObject = scene.objects.find(
    ({ id }) => id === scene.selectedObjectId,
  );
  const toolContext = useMemo<ToolContext>(
    () => ({
      getScene: () => sceneStore.getState().scene,
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
    }),
    [sceneStore],
  );

  useWebMcpTools(toolContext);

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

      if (action.type === "run-agent-move") {
        const lamp = store.scene.objects.find(({ id }) => id === "lamp_01");
        if (!lamp) return;

        const result = store.applyCommand({
          expectedRevision: store.scene.revision,
          actor: "agent",
          command: {
            type: "move",
            objectId: lamp.id,
            position: { x: lamp.position[0] - 0.42, z: lamp.position[2] },
          },
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

      dispatch(action);
    },
    [sceneStore],
  );

  useEffect(() => {
    if (wasCartOpenRef.current && !state.isCartOpen) {
      cartButtonRef.current?.focus();
    }

    wasCartOpenRef.current = state.isCartOpen;
  }, [state.isCartOpen]);

  useEffect(() => {
    function handleWorkspaceKeyDown(event: KeyboardEvent) {
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
          provider={provider}
          roomTotalMinor={roomTotalMinor}
          scene={scene}
        />
        <div className={styles.desktopNotice} role="note">
          Nook’s room editor is desktop-first. Use a viewport at least 1280px
          wide for the complete atelier.
        </div>
        <div className={styles.workspaceBody}>
          <RoomCanvas dispatch={routeAction} scene={scene} state={state} />
          <ContextPanel dispatch={routeAction} scene={scene} state={state} />
        </div>

        <div
          aria-atomic="true"
          aria-live="polite"
          className={styles.liveRegion}
          role="status"
        >
          {state.announcement}
        </div>

        <output
          aria-label="Scene diagnostics"
          className={styles.visuallyHidden}
        >
          Revision {scene.revision} · {scene.selectedObjectId ?? "none"} ·{" "}
          {selectedObject?.product?.id ?? "placeholder"}
        </output>
      </div>

      {state.isCartOpen ? (
        <CartApprovalSheet dispatch={routeAction} draft={state.cartDraft} />
      ) : null}
    </div>
  );
}
