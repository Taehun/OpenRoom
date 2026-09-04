import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
} from "react";
import type { DemoAction } from "./demo-types";
import { OpenRoomIcon } from "./open-room-icon";
import styles from "./demo-workspace.module.css";
import type { CartReviewDraft } from "../../webmcp/tool-context";
import type { CommerceContext, CommerceDraft } from "../commerce/commerce-types";
import { PHOTO_ASSETS } from "../photo/photo-assets";

interface CartApprovalSheetProps {
  commerce: CommerceContext;
  dispatch: Dispatch<DemoAction>;
  /** The room, as a cart. Every opener builds it with `cartDraftForScene`. */
  draft: CartReviewDraft;
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
  if (config.status === "connected") return null;
  if (config.reason === "invalid-domain") {
    return "The configured store address is not a bare host such as your-store.myshopify.com.";
  }
  return "No Shopify store is connected yet.";
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
  const [showProductLinks, setShowProductLinks] = useState(false);
  const productLinksId = useId();
  const isConnected = commerce.config.status === "connected";

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
    () => (isConnected ? (draft.commerce ?? null) : null),
    [draft, isConnected],
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

  const checkoutUrl = commerceDraft?.checkoutPermalink ?? null;
  const totalMinor = checkoutUrl === null
    ? draft.totalMinor
    : lines
        .filter(({ productId }) => mappedProductIds.has(productId))
        .reduce((total, line) => total + line.priceMinor, 0);
  const total = formatPrice(totalMinor);
  const productLinks = commerceDraft?.productLinks ?? [];
  const titleByProductId = useMemo(
    () => new Map(lines.map(({ productId, title }) => [productId, title])),
    [lines],
  );
  const storeDomain =
    commerce.config.status === "connected" ? commerce.config.storeDomain : null;
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
            {isConnected && checkoutUrl
              ? "Approving opens Shopify checkout in a new tab. OpenRoom sends nothing itself."
              : isConnected
                ? "Open product pages one at a time. OpenRoom sends nothing itself."
              : `${draft.items.length} item${draft.items.length === 1 ? "" : "s"} from your room ${draft.items.length === 1 ? "is" : "are"} ready to review.`}
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
                  {isConnected && skippedProductIds.has(line.productId) ? (
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
                <strong>Catalog estimate</strong>
                <small>
                  {isConnected
                    ? "Shopify shows the store's prices at checkout."
                    : "Connect a store to see its prices."}
                </small>
              </span>
              <strong>{total} USD</strong>
            </div>

            {isConnected && storeDomain ? (
              <div className={styles.sheetDisclosure}>
                <span aria-hidden="true">i</span>
                <p>
                  {checkoutUrl
                    ? `Checkout opens on ${storeDomain} in a new tab. OpenRoom stores no Shopify credentials and makes no request of its own.`
                    : `Product pages open on ${storeDomain} in new tabs only when you choose a link. OpenRoom stores no Shopify credentials.`}
                </p>
              </div>
            ) : null}
          </>
        )}

        {notice ? <p className={styles.sheetNotice}>{notice}</p> : null}

        {isConnected && !isEmpty && checkoutUrl === null ? (
          <p className={styles.sheetNotice} role="status">
            No item in this cart is mapped to a Shopify variant yet.
          </p>
        ) : null}

        {showProductLinks ? (
          <ul className={styles.productLinks} id={productLinksId}>
            {productLinks.map(({ productId, url }) => (
              <li key={productId}>
                <a href={url} rel="noreferrer" target="_blank">
                  {titleByProductId.get(productId) ?? productId}
                  <span className={styles.visuallyHidden}> (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
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
          {isEmpty ? null : checkoutUrl !== null ? (
            <button
              aria-label={`Continue to Shopify · ${total}`}
              className={styles.commerceButton}
              onClick={handleContinue}
              type="button"
            >
              <span>Continue to Shopify</span>
              <strong>{total}</strong>
            </button>
          ) : isConnected && storeDomain && productLinks.length > 0 ? (
            <button
              aria-controls={productLinksId}
              aria-expanded={showProductLinks}
              className={styles.commerceButton}
              onClick={() => setShowProductLinks((visible) => !visible)}
              type="button"
            >
              <span>
                Open {productLinks.length} product{productLinks.length === 1 ? "" : "s"} on {storeDomain}
              </span>
            </button>
          ) : !isConnected ? (
            <button
              className={styles.commerceButton}
              onClick={() => dispatch({ type: "open-store-settings" })}
              type="button"
            >
              <span>Connect a store</span>
            </button>
          ) : null}
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
