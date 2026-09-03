import { useId, useRef, useState } from "react";

import type { LocalMcpStatus } from "../../local-mcp/page-relay-client";
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
  "not-connected": "Local agent: Not connected",
  pairing: "Local agent: Pairing…",
  connected: "Local agent: Connected",
  "connection-lost": "Local agent: Connection lost",
};

const PAIR_CODE_PATTERN = /^[0-9]{6}$/;

const PAIR_ERROR_NOTES = {
  INSECURE_CONTEXT: "Pairing needs HTTPS or localhost.",
  PAIR_REJECTED: "Pairing was rejected. Check the code and try again.",
} as const;

const PAIRING_HINT =
  "Run pnpm mcp:openroom in the repository and type the six-digit code it prints.";

export function LocalAgentStatus({ relay }: { relay: LocalMcpRelay }) {
  const [code, setCode] = useState("");
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const hintId = useId();
  const titleId = useId();
  const canConnect =
    PAIR_CODE_PATTERN.test(code) && relay.status !== "pairing";
  const note = relay.pairError ? PAIR_ERROR_NOTES[relay.pairError] : null;

  async function connect() {
    if (!canConnect) return;
    try {
      await relay.pair(code);
      setCode("");
      dialogRef.current?.close();
    } catch {
      // The reason is already reflected in `relay.pairError`, which the dialog
      // shows; it stays open so the operator can retype the code.
    }
  }

  return (
    <div className={styles.localAgent}>
      <span
        aria-label="Local agent connection status"
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

      <dialog
        aria-labelledby={titleId}
        className={`md-dialog ${styles.pairDialog}`}
        ref={dialogRef}
      >
        <h2 className="md-dialog-title" id={titleId}>
          Connect an AI app
        </h2>

        <p id={hintId}>{PAIRING_HINT}</p>

        <label className={styles.localAgentField}>
          <span>Pairing code</span>
          <input
            aria-describedby={hintId}
            autoComplete="off"
            inputMode="numeric"
            maxLength={6}
            onChange={(event) =>
              setCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))
            }
            pattern="[0-9]{6}"
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

        {note ? <p className={styles.pairNote}>{note}</p> : null}

        <div className="md-dialog-actions">
          <button
            className="md-button md-button--text"
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            Cancel
          </button>
          <button
            className="md-button md-button--filled"
            disabled={!canConnect}
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
