import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
} from "react";
import { CART_ITEMS } from "./demo-data";
import type { DemoAction } from "./demo-types";
import { OpenInteriorIcon } from "./open-interior-icon";
import styles from "./demo-workspace.module.css";
import type { CartApprovalDraft } from "../../webmcp/tool-context";
import type { CommerceContext, CommerceDraft } from "../commerce/commerce-types";
import { buildCommerceDraft } from "../commerce/shopify-cart";

interface CartApprovalSheetProps {
  commerce: CommerceContext;
  dispatch: Dispatch<DemoAction>;
  draft?: CartApprovalDraft | null;
  openWindow?: (url: string) => Window | null;
}

export function openInNewTab(url: string): Window | null {
  const opened = window.open(url, "_blank");
  if (opened) opened.opener = null;
  return opened;
}

function formatPrice(priceMinor: number) {
  return `$${Math.round(priceMinor / 100).toLocaleString("en-US")}`;
}

const CART_TOTAL_MINOR = CART_ITEMS.reduce(
  (total, item) => total + item.priceMinor,
  0,
);

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
      draft
        ? draft.items.map((item) => ({
            key: item.objectId,
            productId: item.productId,
            title: item.title,
            detail: `Qty ${item.quantity} · Scene product`,
            priceMinor: item.price.amountMinor,
          }))
        : CART_ITEMS.map((item) => ({
            key: item.id,
            productId: item.id,
            title: item.name,
            detail: "Qty 1 · Demo fixture",
            priceMinor: item.priceMinor,
          })),
    [draft],
  );

  const commerceDraft = useMemo<CommerceDraft | null>(() => {
    if (!isShopify) return null;
    if (draft) return draft.commerce ?? null;
    return buildCommerceDraft(
      commerce,
      CART_ITEMS.map(({ id }) => ({ productId: id, quantity: 1 })),
    );
  }, [commerce, draft, isShopify]);

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
    : (draft?.totalMinor ?? CART_TOTAL_MINOR);
  const total = formatPrice(totalMinor);
  const checkoutUrl = commerceDraft?.checkoutPermalink ?? null;
  const canCheckout = isShopify && checkoutUrl !== null;
  const storeDomain =
    commerce.config.provider === "shopify" ? commerce.config.storeDomain : null;
  const buttonLabel =
    draft && !isShopify ? "Approve Scene cart" : "Continue to Shopify";
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
            <OpenInteriorIcon name="close" />
          </button>
        </header>

        <p className={styles.sheetIntro}>
          {isShopify
            ? "Approving opens Shopify checkout in a new tab. OpenInterior sends nothing itself."
            : draft
              ? `OpenInterior has prepared ${draft.items.length} Scene item${draft.items.length === 1 ? "" : "s"} from Scene revision ${draft.sceneRevision} for your approval. Nothing has been sent to Shopify.`
              : "OpenInterior has prepared these four fixtures for your approval. Nothing has been sent to Shopify."}
        </p>

        <ul className={styles.cartItems}>
          {lines.map((line, index) => (
            <li key={line.key}>
              <span className={styles.cartThumbnail} aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
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

        <div className={styles.cartTotal}>
          <span>
            <strong>Estimated total</strong>
            <small>
              {isShopify
                ? "Mapped items only · taxes and delivery calculated by Shopify"
                : "Taxes and delivery calculated later"}
            </small>
          </span>
          <strong>{total} USD</strong>
        </div>

        <div className={styles.sheetDisclosure}>
          <span aria-hidden="true">i</span>
          <p>
            {isShopify && storeDomain
              ? `Checkout opens on ${storeDomain} in a new tab. OpenInterior stores no Shopify credentials and makes no request of its own.`
              : "UI-only approval. Continuing closes this sheet and creates no external cart or network request."}
          </p>
        </div>

        {notice ? <p className={styles.sheetNotice}>{notice}</p> : null}

        {isShopify && !canCheckout ? (
          <p className={styles.sheetNotice} role="status">
            No item in this cart is mapped to a Shopify variant yet.
          </p>
        ) : null}

        {blockedUrl ? (
          <p className={styles.sheetNotice} role="status">
            Your browser blocked the new tab.{" "}
            <a href={blockedUrl} rel="noopener noreferrer" target="_blank">
              Open Shopify checkout
            </a>
          </p>
        ) : null}

        <div className={styles.sheetActions}>
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
