import type { DemoAction, DemoAnnouncement, DemoState } from "./demo-types";

export type {
  DemoAction,
  DemoAnnouncement,
  DemoProduct,
  DemoState,
} from "./demo-types";
export { DEMO_PRODUCTS } from "./demo-data";

/** Seen on screen and read out; used for the outcome of an approval. */
function toast(text: string): DemoAnnouncement {
  return { text, nonce: Date.now(), tone: "toast" };
}

/** Read out only: confirms an edit without putting anything over the room. */
function quiet(text: string): DemoAnnouncement {
  return { text, nonce: Date.now(), tone: "quiet" };
}

const INITIAL_STATE: DemoState = {
  mode: "inspector",
  isCartOpen: false,
  isStoreSettingsOpen: false,
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
      // Deselecting removes the inspector, so nothing on screen says it
      // happened; every other selection speaks for itself.
      return {
        ...state,
        mode: "inspector",
        toast: null,
        ...(action.objectId === null
          ? { announcement: quiet("Selection cleared") }
          : {}),
      };
    case "preview-product":
      return { ...state, mode: "products", toast: null };
    case "open-cart":
      // The sheet is the next thing to read; a leftover toast would sit on top
      // of "Keep editing".
      return {
        ...state,
        isCartOpen: true,
        isStoreSettingsOpen: false,
        cartDraft: action.draft ?? null,
        announcement: null,
      };
    case "close-cart":
      return { ...state, isCartOpen: false, cartDraft: null };
    case "open-store-settings":
      return {
        ...state,
        isCartOpen: false,
        isStoreSettingsOpen: true,
        cartDraft: null,
      };
    case "close-store-settings":
      return { ...state, isStoreSettingsOpen: false };
    case "clear-announcement":
      return state.announcement === null
        ? state
        : { ...state, announcement: null };
    case "open-external-checkout":
      return {
        ...state,
        isCartOpen: false,
        isStoreSettingsOpen: false,
        cartDraft: null,
        announcement: toast(
          `Opened Shopify checkout in a new tab (${action.itemCount} item${action.itemCount === 1 ? "" : "s"})`,
        ),
      };
    case "undo":
      return {
        ...state,
        mode: "inspector",
        toast: null,
        announcement: quiet("Undo: last change reverted"),
      };
    case "reset":
      return {
        ...createInitialDemoState(),
        announcement: quiet("Room reset to the original furniture"),
      };
  }
}
