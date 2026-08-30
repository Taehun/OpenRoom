import { useEffect, useRef, type Dispatch, type KeyboardEvent } from "react";
import { CART_ITEMS } from "./demo-data";
import type { DemoAction } from "./demo-types";
import { NookIcon } from "./nook-icon";
import styles from "./demo-workspace.module.css";

interface CartApprovalSheetProps {
  dispatch: Dispatch<DemoAction>;
}

function formatPrice(priceMinor: number) {
  return `$${Math.round(priceMinor / 100).toLocaleString("en-US")}`;
}

const CART_TOTAL_MINOR = CART_ITEMS.reduce(
  (total, item) => total + item.priceMinor,
  0,
);

export function CartApprovalSheet({ dispatch }: CartApprovalSheetProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;

    const focusableElements = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    const firstFocusableElement = focusableElements[0];
    const lastFocusableElement = focusableElements.at(-1);

    if (!firstFocusableElement || !lastFocusableElement) {
      event.preventDefault();
      return;
    }

    if (event.shiftKey && document.activeElement === firstFocusableElement) {
      event.preventDefault();
      lastFocusableElement.focus();
    } else if (
      !event.shiftKey &&
      document.activeElement === lastFocusableElement
    ) {
      event.preventDefault();
      firstFocusableElement.focus();
    }
  }

  return (
    <div className={styles.sheetLayer}>
      <div className={styles.sheetScrim} aria-hidden="true" />
      <aside
        aria-labelledby="cart-sheet-title"
        aria-modal="true"
        className={styles.cartSheet}
        onKeyDown={handleKeyDown}
        role="dialog"
      >
        <header className={styles.sheetHeader}>
          <div>
            <span className={styles.panelEyebrow}>Approval required</span>
            <h2 id="cart-sheet-title">Review your room</h2>
          </div>
          <button
            aria-label="Close cart review"
            className={styles.iconButton}
            onClick={() => dispatch({ type: "close-cart" })}
            ref={closeButtonRef}
            title="Close cart review (Escape)"
            type="button"
          >
            <NookIcon name="close" />
          </button>
        </header>

        <p className={styles.sheetIntro}>
          Nook has prepared these four fixtures for your approval. Nothing has
          been sent to Shopify.
        </p>

        <ul className={styles.cartItems}>
          {CART_ITEMS.map((item, index) => (
            <li key={item.id}>
              <span className={styles.cartThumbnail} aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className={styles.cartItemCopy}>
                <strong>{item.name}</strong>
                <small>Qty 1 · Demo fixture</small>
              </span>
              <strong>{formatPrice(item.priceMinor)}</strong>
            </li>
          ))}
        </ul>

        <div className={styles.cartTotal}>
          <span>
            <strong>Estimated total</strong>
            <small>Taxes and delivery calculated later</small>
          </span>
          <strong>{formatPrice(CART_TOTAL_MINOR)} USD</strong>
        </div>

        <div className={styles.sheetDisclosure}>
          <span aria-hidden="true">i</span>
          <p>
            UI-only approval. Continuing closes this sheet and creates no
            external cart or network request.
          </p>
        </div>

        <div className={styles.sheetActions}>
          <button
            aria-label="Continue to Shopify · $626"
            className={styles.commerceButton}
            onClick={() => dispatch({ type: "confirm-demo-cart" })}
            type="button"
          >
            <span>Continue to Shopify</span>
            <strong>$626</strong>
          </button>
          <button
            className={styles.cancelButton}
            onClick={() => dispatch({ type: "close-cart" })}
            type="button"
          >
            Keep editing
          </button>
        </div>
      </aside>
    </div>
  );
}
