import { useId, useRef, useState } from "react";

import type {
  LocalMcpStatus,
  PageRelayErrorCode,
} from "../../local-mcp/page-relay-client";
import type { LocalMcpRelay } from "../../local-mcp/use-local-mcp-relay";
import styles from "./demo-workspace.module.css";

/**
 * Manual pairing controls for the localhost MCP companion. Pairing is always a
 * deliberate human act: the operator copies the code the relay prints and types
 * it here. The session token lives inside the relay client and is never shown,
 * stored, or placed in the URL.
 *
 * The composer shares its column with the 16:9 photo stage, which is vertically
 * centred in the space left over, so every row this block adds pushes the stage
 * up by half its height and eats into the reserved status band above the photo.
 * The composer therefore shows only a status chip and one button; the code
 * field, the relay port, the start-up hint, and any failure note live in the
 * modal dialog that button opens.
 */

const STATUS_LABELS: Record<LocalMcpStatus, string> = {
  "not-connected": "Desktop AI app: Not connected",
  pairing: "Desktop AI app: Pairing…",
  connected: "Desktop AI app: Connected",
  "connection-lost": "Desktop AI app: Connection lost",
};

const PAIR_CODE_PATTERN = /^[0-9]{6}$/;

/**
 * What went wrong, and what to do next. Only `PAIR_REJECTED` is about the
 * code: nothing listening on the port is a companion that was never started,
 * and saying "check the code" there sends the operator to a log that has
 * nothing new in it.
 */
function pairErrorNote(code: PageRelayErrorCode, port: number): string {
  switch (code) {
    case "COMPANION_UNREACHABLE":
      return `Nothing answered on port ${port}. Start a chat in your AI app so it launches the companion, then try again.`;
    case "PAIR_REJECTED":
      return "That code didn't match. Copy the newest six digits from ~/openroom-mcp.log and try again.";
    case "INSECURE_CONTEXT":
      return "Pairing needs HTTPS or localhost.";
  }
}

/*
 * The MCP client launches the companion and keeps its stderr, so the code is
 * read from the log the registered `sh -c … 2>>` command appends to, not from
 * a companion started by hand. The guide at `/` carries the full recipe, and
 * `docs/local-mcp.md` is its source.
 */
const PAIRING_HINT =
  "Type the six-digit code the companion wrote to ~/openroom-mcp.log.";

export function LocalAgentStatus({ relay }: { relay: LocalMcpRelay }) {
  const [code, setCode] = useState("");
  /*
   * `relay.pairError` records the last attempt and is cleared only by the next
   * one, which is right for the relay but wrong for a dialog the operator can
   * walk away from: reopening it would show a note about an attempt they have
   * already abandoned. Closing the dialog dismisses the note here rather than
   * reaching into the relay client, whose state stays the record of what the
   * companion actually said.
   */
  const [noteDismissed, setNoteDismissed] = useState(false);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hintId = useId();
  const noteId = useId();
  const titleId = useId();
  const pairing = relay.status === "pairing";
  const canConnect = PAIR_CODE_PATTERN.test(code) && !pairing;
  const note =
    relay.pairError && !noteDismissed
      ? pairErrorNote(relay.pairError, relay.relayPort)
      : null;

  async function connect() {
    if (!canConnect) return;
    setNoteDismissed(false);
    try {
      await relay.pair(code);
      setCode("");
      dialogRef.current?.close();
    } catch {
      // The reason is already reflected in `relay.pairError`, which the dialog
      // shows; it stays open so the operator can retype the code, and the
      // field takes the keyboard back with the wrong code selected.
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }

  return (
    <div className={styles.localAgent}>
      <span
        aria-label="Desktop AI app status"
        className={`md-chip md-chip--dense${
          relay.status === "connected" ? " md-chip--selected" : ""
        }`}
        role="status"
      >
        {STATUS_LABELS[relay.status]}
      </span>

      <button
        className="md-button md-button--tonal md-button--dense"
        onClick={() => dialogRef.current?.showModal()}
        type="button"
      >
        Connect an AI app
      </button>

      {relay.status === "connected" ? (
        <button
          className="md-button md-button--text md-button--dense"
          onClick={() => void relay.disconnect()}
          type="button"
        >
          Disconnect
        </button>
      ) : null}

      {/*
        `close` covers every way out — the Cancel button, Escape, and the
        successful pair that closes it from `connect` — so the next open always
        starts from an empty field and no note.
      */}
      <dialog
        aria-labelledby={titleId}
        className={`md-dialog ${styles.pairDialog}`}
        onClose={() => {
          setCode("");
          setNoteDismissed(true);
        }}
        ref={dialogRef}
      >
        <h2 className="md-dialog-title" id={titleId}>
          Connect an AI app
        </h2>

        <p id={hintId}>{PAIRING_HINT}</p>

        <label className={styles.localAgentField}>
          <span>Pairing code</span>
          <input
            aria-describedby={note ? `${hintId} ${noteId}` : hintId}
            aria-invalid={note !== null}
            autoComplete="off"
            inputMode="numeric"
            maxLength={6}
            onChange={(event) =>
              setCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))
            }
            // Six digits and a Connect button one Tab away: Enter is what
            // anyone typing a code presses, so it submits.
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void connect();
              }
            }}
            pattern="[0-9]{6}"
            ref={inputRef}
            type="text"
            value={code}
          />
        </label>

        <details className={styles.pairAdvanced}>
          <summary>Advanced</summary>
          <label className={`${styles.localAgentField} ${styles.localAgentPort}`}>
            <span>Relay port</span>
            <input
              autoComplete="off"
              inputMode="numeric"
              max={65535}
              min={1}
              onChange={(event) => relay.setRelayPort(Number(event.target.value))}
              type="number"
              value={relay.relayPort}
            />
          </label>
        </details>

        {note ? (
          <p className={styles.pairNote} id={noteId} role="alert">
            {note}
          </p>
        ) : null}

        <div className="md-dialog-actions">
          <button
            className="md-button md-button--text"
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            Cancel
          </button>
          {/*
            Only the code shape disables this: going disabled mid-attempt
            would take the button out from under the pointer and drop focus on
            <body>. While the relay is pairing it says so and `connect` returns
            early instead.
          */}
          <button
            aria-busy={pairing}
            className="md-button md-button--filled"
            disabled={!PAIR_CODE_PATTERN.test(code)}
            onClick={() => void connect()}
            type="button"
          >
            Connect
          </button>
        </div>
      </dialog>
    </div>
  );
}
