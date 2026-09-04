import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
} from "react";
import type { DemoAction } from "./demo-types";
import { OpenRoomIcon } from "./open-room-icon";
import styles from "./demo-workspace.module.css";
import type { CartApprovalDraft } from "../../webmcp/tool-context";
import type { CommerceContext, CommerceDraft } from "../commerce/commerce-types";
import { PHOTO_ASSETS } from "../photo/photo-assets";

interface CartApprovalSheetProps {
  commerce: CommerceContext;
  dispatch: Dispatch<DemoAction>;
  /** The room, as a cart. Every opener builds it with `cartDraftForScene`. */
  draft: CartApprovalDraft;
  openWindow?: (url: string) => Window | null;
}

/**
 * The `noopener` window feature is deliberately not used: per spec it makes
 * `window.open` return null, which the caller cannot tell apart from a blocked
 * popup, so the fallback anchor would appear on every successful checkout.
 * Nulling `opener` is best-effort instead — WebKit has no cross-origin
 * `opener` setter and throws, which used to abort the click handler before
 * `open-external-checkout` was ever dispatched.
 */
export function openInNewTab(url: string): Window | null {
  const opened = window.open(url, "_blank");
  if (opened) {
    try {
      opened.opener = null;
    } catch {
      // Cross-origin target in WebKit: the tab is open, just keep going.
    }
  }
  return opened;
}

function formatPrice(priceMinor: number) {
  return `$${Math.round(priceMinor / 100).toLocaleString("en-US")}`;
}

function configurationNotice(config: CommerceContext["config"]): string | null {
  if (config.provider !== "demo") return null;
  if (config.reason === "not-configured") {
    return "Shopify checkout is not configured. Set NEXT_PUBLIC_COMMERCE_PROVIDER=shopify and NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN, then rebuild.";
  }
  if (config.reason === "invalid-domain") {
    return "Shopify checkout is disabled: NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN must be a bare host such as your-store.myshopify.com. Rebuild after fixing it.";
  }
  return null;
}

interface SheetLine {
  key: string;
  productId: string;
  title: string;
  detail: string;
  priceMinor: number;
}

export function CartApprovalSheet({
  commerce,
  dispatch,
  draft,
  openWindow = openInNewTab,
}: CartApprovalSheetProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);
  const isShopify = commerce.config.provider === "shopify";

  const lines = useMemo<SheetLine[]>(
    () =>
      draft.items.map((item) => ({
        key: item.objectId,
        productId: item.productId,
        title: item.title,
        detail: `Qty ${item.quantity}`,
        priceMinor: item.price.amountMinor,
      })),
    [draft],
  );
  const isEmpty = lines.length === 0;

  const commerceDraft = useMemo<CommerceDraft | null>(
    () => (isShopify ? (draft.commerce ?? null) : null),
    [draft, isShopify],
  );

  const mappedProductIds = useMemo(
    () => new Set(commerceDraft?.lines.map(({ productId }) => productId) ?? []),
    [commerceDraft],
  );
  const skippedProductIds = useMemo(
    () =>
      new Set(commerceDraft?.skipped.map(({ productId }) => productId) ?? []),
    [commerceDraft],
  );

  const totalMinor = isShopify
    ? lines
        .filter(({ productId }) => mappedProductIds.has(productId))
        .reduce((total, line) => total + line.priceMinor, 0)
    : draft.totalMinor;
  const total = formatPrice(totalMinor);
  const checkoutUrl = commerceDraft?.checkoutPermalink ?? null;
  const canCheckout = isShopify && checkoutUrl !== null;
  const storeDomain =
    commerce.config.provider === "shopify" ? commerce.config.storeDomain : null;
  const buttonLabel = isShopify ? "Continue to Shopify" : "Approve demo cart";
  const notice = configurationNotice(commerce.config);

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

  function handleContinue() {
    if (!isShopify) {
      dispatch({ type: "confirm-demo-cart" });
      return;
    }
    if (!commerceDraft || checkoutUrl === null) return;
    const opened = openWindow(checkoutUrl);
    if (opened === null) {
      setBlockedUrl(checkoutUrl);
      return;
    }
    dispatch({
      type: "open-external-checkout",
      itemCount: commerceDraft.lines.length,
    });
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
            <span className={styles.panelEyebrow}>
              {isEmpty ? "Cart" : "Approval required"}
            </span>
            <h2 id="cart-sheet-title">Review your room</h2>
          </div>
          <button
            aria-label="Close cart"
            className={styles.iconButton}
            onClick={() => dispatch({ type: "close-cart" })}
            ref={closeButtonRef}
            title="Close cart (Escape)"
            type="button"
          >
            <OpenRoomIcon name="close" />
          </button>
        </header>

        {isEmpty ? null : (
          <p className={styles.sheetIntro}>
            {isShopify
              ? "Approving opens Shopify checkout in a new tab. OpenRoom sends nothing itself."
              : `${draft.items.length} item${draft.items.length === 1 ? "" : "s"} from your room ${draft.items.length === 1 ? "is" : "are"} ready for approval. Nothing is ordered until you approve.`}
          </p>
        )}

        {isEmpty ? (
          <p className={styles.cartEmpty}>
            Nothing to order yet. Swap a piece with Find alternatives, or ask
            your AI app.
          </p>
        ) : (
          <ul className={styles.cartItems}>
            {lines.map((line, index) => (
              <li key={line.key}>
                <span className={styles.cartThumbnail} aria-hidden="true">
                  {PHOTO_ASSETS[line.productId] ? (
                    // The product's own cutout; a number only when no image
                    // is registered.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt=""
                      decoding="async"
                      loading="lazy"
                      src={PHOTO_ASSETS[line.productId]!.src}
                    />
                  ) : (
                    String(index + 1).padStart(2, "0")
                  )}
                </span>
                <span className={styles.cartItemCopy}>
                  <strong>{line.title}</strong>
                  <small>{line.detail}</small>
                  {isShopify && skippedProductIds.has(line.productId) ? (
                    <small className={styles.cartSkipped}>
                      Not mapped to a Shopify variant
                    </small>
                  ) : null}
                </span>
                <strong>{formatPrice(line.priceMinor)}</strong>
              </li>
            ))}
          </ul>
        )}

        {isEmpty ? null : (
          <>
            <div className={styles.cartTotal}>
              <span>
                <strong>{isShopify ? "Catalog estimate" : "Room total"}</strong>
                <small>
                  {isShopify
                    ? "Shopify shows the store's prices at checkout."
                    : "Taxes and delivery calculated later"}
                </small>
              </span>
              <strong>{total} USD</strong>
            </div>

            <div className={styles.sheetDisclosure}>
              <span aria-hidden="true">i</span>
              <p>
                {isShopify && storeDomain
                  ? `Checkout opens on ${storeDomain} in a new tab. OpenRoom stores no Shopify credentials and makes no request of its own.`
                  : "Demo only: approving closes this sheet and orders nothing."}
              </p>
            </div>
          </>
        )}

        {notice ? <p className={styles.sheetNotice}>{notice}</p> : null}

        {isShopify && !isEmpty && !canCheckout ? (
          <p className={styles.sheetNotice} role="status">
            No item in this cart is mapped to a Shopify variant yet.
          </p>
        ) : null}

        {blockedUrl ? (
          <p className={styles.sheetNotice} role="status">
            Your browser blocked the new tab.{" "}
            <a href={blockedUrl} rel="noopener noreferrer" target="_blank">
              Open Shopify checkout
            <span className={styles.visuallyHidden}> (opens in a new tab)</span></a>
          </p>
        ) : null}

        <div className={styles.sheetActions}>
          {isEmpty ? null : (
            <button
              aria-label={`${buttonLabel} · ${total}`}
              className={styles.commerceButton}
              disabled={isShopify && !canCheckout}
              onClick={handleContinue}
              type="button"
            >
              <span>{buttonLabel}</span>
              <strong>{total}</strong>
            </button>
          )}
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
