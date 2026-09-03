import type { DemoAction, DemoState } from "./demo-types";

export type { DemoAction, DemoProduct, DemoState } from "./demo-types";
export { CART_ITEMS, DEMO_PRODUCTS } from "./demo-data";

const INITIAL_STATE: DemoState = {
  mode: "inspector",
  isCartOpen: false,
  cartDraft: null,
  toast: null,
  announcement: null,
};

export function createInitialDemoState(): DemoState {
  return { ...INITIAL_STATE };
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
      return { ...state, mode: "inspector", toast: null };
    case "preview-product":
      return { ...state, mode: "products", toast: null };
    case "open-cart":
      return { ...state, isCartOpen: true, cartDraft: action.draft ?? null };
    case "close-cart":
      return { ...state, isCartOpen: false, cartDraft: null };
    case "confirm-demo-cart":
      return {
        ...state,
        isCartOpen: false,
        cartDraft: null,
        announcement: "Demo only — no external cart was created.",
      };
    case "undo":
      return { ...state, mode: "inspector", toast: null };
    case "reset":
      return createInitialDemoState();
  }
}
