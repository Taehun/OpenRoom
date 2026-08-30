import { DEMO_PRODUCTS } from "./demo-data";
import type {
  DemoAction,
  DemoHistorySnapshot,
  DemoState,
} from "./demo-types";

export type { DemoAction, DemoProduct, DemoState } from "./demo-types";
export { CART_ITEMS, DEMO_PRODUCTS } from "./demo-data";

const INITIAL_SCENE: DemoHistorySnapshot = {
  mode: "inspector",
  revision: 1,
  selectedObjectId: "table_01",
  previewProductId: null,
  isCartOpen: false,
  provider: "Demo fallback",
  roomTotalMinor: 0,
  toast: null,
  announcement: null,
};

function snapshot(state: DemoState): DemoHistorySnapshot {
  return {
    mode: state.mode,
    revision: state.revision,
    selectedObjectId: state.selectedObjectId,
    previewProductId: state.previewProductId,
    isCartOpen: state.isCartOpen,
    provider: state.provider,
    roomTotalMinor: state.roomTotalMinor,
    toast: state.toast ? { ...state.toast } : null,
    announcement: state.announcement,
  };
}

export function createInitialDemoState(): DemoState {
  return {
    ...INITIAL_SCENE,
    toast: null,
    history: null,
  };
}

export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "show-products":
      return { ...state, mode: "products", toast: null };
    case "show-inspector":
      return { ...state, mode: "inspector", toast: null };
    case "show-activity":
      return { ...state, mode: "activity", toast: null };
    case "select-object":
      return { ...state, selectedObjectId: action.objectId };
    case "preview-product": {
      const product = DEMO_PRODUCTS.find(({ id }) => id === action.productId);

      if (!product) return state;

      return {
        ...state,
        mode: "products",
        previewProductId: product.id,
        provider: "Cached",
        revision: state.revision + 1,
        roomTotalMinor: product.priceMinor,
        toast: null,
        history: snapshot(state),
      };
    }
    case "run-agent-move":
      return {
        ...state,
        mode: "activity",
        revision: state.revision + 1,
        toast: { message: "Lamp moved to match your layout" },
        history: snapshot(state),
      };
    case "open-cart":
      return { ...state, isCartOpen: true };
    case "close-cart":
      return { ...state, isCartOpen: false };
    case "confirm-demo-cart":
      return {
        ...state,
        isCartOpen: false,
        announcement: "Demo only — no external cart was created.",
      };
    case "undo":
      return state.history
        ? { ...state.history, history: null, toast: null }
        : state;
    case "reset":
      return createInitialDemoState();
  }
}
