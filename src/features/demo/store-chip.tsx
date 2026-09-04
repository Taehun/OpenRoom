"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

import type { CommerceController } from "../commerce/use-commerce-context";
import {
  domainRejectionMessage,
  parseStoreDomain,
} from "../commerce/store-domain";
import {
  probeStoreCapability,
  type ProbeOutcome,
} from "../commerce/store-probe";
import { OpenRoomIcon } from "./open-room-icon";
import styles from "./demo-workspace.module.css";

export interface StoreChipProps {
  controller: CommerceController;
  /** Injected by the tests; defaults to the real probe. */
  probe?: typeof probeStoreCapability;
  /** Lets another surface, such as the approval sheet, own whether this is open. */
  open?: boolean;
  onOpenChange?: ((open: boolean) => void) | undefined;
}

export function probeMessage(outcome: ProbeOutcome, domain: string): string {
  switch (outcome.status) {
    case "ok":
      return "Connected. This store speaks the cart protocol.";
    case "missing-cart-tools":
      return "This store answers but does not offer cart tools. Checkout links will still work; an agent cannot build the cart.";
    case "unreachable":
      return `Could not reach a Shopify store at ${domain}. Check the address, or that the store is published.`;
    case "not-shopify":
      return "That address answered, but not as a Shopify store.";
  }
}

function trapFocus(event: KeyboardEvent<HTMLElement>) {
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
  } else if (!event.shiftKey && document.activeElement === lastFocusableElement) {
    event.preventDefault();
    firstFocusableElement.focus();
  }
}

export function StoreChip({
  controller,
  probe = probeStoreCapability,
  open,
  onOpenChange,
}: StoreChipProps) {
  const connectedDomain =
    controller.commerce.config.status === "connected"
      ? controller.commerce.config.storeDomain
      : null;
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const [value, setValue] = useState(connectedDomain ?? "");
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [outcomeMessage, setOutcomeMessage] = useState<string | null>(null);
  const [persistenceWarning, setPersistenceWarning] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(false);
  const pendingRef = useRef(false);
  const activeAttemptRef = useRef(0);
  const wasOpenRef = useRef(false);
  const dialogId = useId();
  const titleId = useId();
  const validationId = useId();
  const outcomeId = useId();
  const persistenceId = useId();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeAttemptRef.current += 1;
      pendingRef.current = false;
    };
  }, []);

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = isOpen;

    if (isOpen && !wasOpen) {
      activeAttemptRef.current += 1;
      pendingRef.current = false;
      setValue(connectedDomain ?? "");
      setTouched(false);
      setPending(false);
      setOutcomeMessage(null);
      setPersistenceWarning(false);
      inputRef.current?.focus({ preventScroll: true });
      return;
    }

    if (!isOpen && wasOpen) {
      activeAttemptRef.current += 1;
      pendingRef.current = false;
      setPending(false);
      triggerRef.current?.focus({ preventScroll: true });
    }
  }, [connectedDomain, isOpen]);

  function requestOpen(nextOpen: boolean) {
    if (open === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }

  function closePopover() {
    activeAttemptRef.current += 1;
    pendingRef.current = false;
    setPending(false);
    requestOpen(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;

    const parsed = parseStoreDomain(value);
    setTouched(true);
    setOutcomeMessage(null);
    setPersistenceWarning(false);
    if (!parsed.ok) return;

    const attempt = activeAttemptRef.current + 1;
    activeAttemptRef.current = attempt;
    pendingRef.current = true;
    setPending(true);

    let outcome: ProbeOutcome;
    try {
      outcome = await probe(parsed.domain);
    } catch {
      // The production probe resolves every failure, but an injected or future
      // implementation must not strand the popover in its checking state.
      outcome = { status: "unreachable" };
    }

    if (
      !mountedRef.current ||
      dialogRef.current === null ||
      activeAttemptRef.current !== attempt
    ) {
      return;
    }

    setOutcomeMessage(probeMessage(outcome, parsed.domain));
    if (outcome.status === "ok" || outcome.status === "missing-cart-tools") {
      setPersistenceWarning(!controller.setStoreDomain(parsed.domain));
    }
    pendingRef.current = false;
    setPending(false);
  }

  function handleSampleStore() {
    activeAttemptRef.current += 1;
    pendingRef.current = false;
    controller.setStoreDomain(null);
    requestOpen(false);
  }

  const parsed = parseStoreDomain(value);
  const validationMessage =
    touched && !parsed.ok ? domainRejectionMessage(parsed.rejection) : null;
  const descriptions = [
    validationMessage ? validationId : null,
    outcomeMessage ? outcomeId : null,
    persistenceWarning ? persistenceId : null,
  ].filter((id): id is string => id !== null);
  const label = !controller.hydrated
    ? "Store"
    : connectedDomain ?? "Connect a store";

  return (
    <div className={styles.storeChipRoot}>
      <button
        aria-controls={dialogId}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className={`md-chip ${styles.storeChip}${
          !controller.hydrated
            ? ""
            : connectedDomain
              ? " md-chip--selected"
              : ` ${styles.storeChipUnconfigured}`
        }`}
        onClick={() => (isOpen ? closePopover() : requestOpen(true))}
        ref={triggerRef}
        title={connectedDomain ?? undefined}
        type="button"
      >
        <span className={styles.storeChipLabel}>{label}</span>
      </button>

      {isOpen && typeof document !== "undefined"
        ? createPortal(
            <div className={styles.storePopoverLayer}>
              <div
                aria-hidden="true"
                className={styles.storePopoverScrim}
                onMouseDown={closePopover}
              />
              <div
                aria-labelledby={titleId}
                aria-modal="true"
                className={styles.storePopover}
                data-store-settings-dialog=""
                id={dialogId}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    // Without both guards the workspace-level Escape handler
                    // would also clear the selected object after closing.
                    event.preventDefault();
                    event.stopPropagation();
                    closePopover();
                    return;
                  }
                  trapFocus(event);
                }}
                ref={dialogRef}
                role="dialog"
              >
                <div className={styles.storePopoverHeader}>
                  <h2 id={titleId}>Store connection</h2>
                  <button
                    aria-label="Close store settings"
                    className={`md-icon-button ${styles.storePopoverClose}`}
                    onClick={closePopover}
                    type="button"
                  >
                    <OpenRoomIcon name="close" />
                  </button>
                </div>

                <form
                  className={styles.storeForm}
                  onSubmit={(event) => void handleSubmit(event)}
                >
                  <label className={styles.storeField}>
                    <span>Store address</span>
                    <input
                      aria-describedby={
                        descriptions.length > 0
                          ? descriptions.join(" ")
                          : undefined
                      }
                      aria-invalid={validationMessage ? true : undefined}
                      autoCapitalize="none"
                      autoComplete="url"
                      disabled={pending}
                      onBlur={() => setTouched(true)}
                      onChange={(event) => {
                        setValue(event.target.value);
                        setOutcomeMessage(null);
                        setPersistenceWarning(false);
                      }}
                      placeholder="your-store.myshopify.com"
                      ref={inputRef}
                      spellCheck={false}
                      type="text"
                      value={value}
                    />
                  </label>

                  {validationMessage ? (
                    <p
                      className={styles.storeError}
                      id={validationId}
                      role="alert"
                    >
                      {validationMessage}
                    </p>
                  ) : null}
                  {outcomeMessage ? (
                    <p
                      className={styles.storeProbeMessage}
                      id={outcomeId}
                      role="status"
                    >
                      {outcomeMessage}
                    </p>
                  ) : null}
                  {persistenceWarning ? (
                    <p
                      className={styles.storeError}
                      id={persistenceId}
                      role="alert"
                    >
                      This browser will not remember the store
                    </p>
                  ) : null}

                  <div className={styles.storeActions}>
                    <button
                      className="md-button md-button--text"
                      disabled={pending}
                      onClick={handleSampleStore}
                      type="button"
                    >
                      Use the sample store
                    </button>
                    <button
                      aria-busy={pending}
                      className="md-button md-button--filled"
                      disabled={pending}
                      type="submit"
                    >
                      {pending ? "Checking…" : "Save"}
                    </button>
                  </div>
                </form>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
