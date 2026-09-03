import { useId, useState } from "react";

import type { LocalMcpStatus } from "../../local-mcp/page-relay-client";
import type { LocalMcpRelay } from "../../local-mcp/use-local-mcp-relay";
import styles from "./demo-workspace.module.css";

/**
 * Manual pairing controls for the localhost MCP companion. Pairing is always a
 * deliberate human act: the operator copies the code the relay prints and types
 * it here. The session token lives inside the relay client and is never shown,
 * stored, or placed in the URL.
 *
 * The controls stay on a single composer row. The composer shares its column
 * with the 16:9 photo stage, which is vertically centred in the space left
 * over, so every row this block adds pushes the stage up by half its height
 * and eats into the reserved status band above the photo. The start-up hint is
 * therefore attached to the code field as its description rather than set as a
 * line of its own.
 */

const STATUS_LABELS: Record<LocalMcpStatus, string> = {
  "not-connected": "Claude: Not connected",
  pairing: "Claude: Pairing…",
  connected: "Claude: Connected",
  "connection-lost": "Claude: Connection lost",
};

const PAIR_CODE_PATTERN = /^[0-9]{6}$/;

const PAIR_ERROR_NOTES = {
  INSECURE_CONTEXT: "Pairing needs HTTPS or localhost.",
  PAIR_REJECTED: "Pairing was rejected. Check the code and try again.",
} as const;

export function LocalAgentStatus({ relay }: { relay: LocalMcpRelay }) {
  const [code, setCode] = useState("");
  const hintId = useId();
  const canConnect =
    PAIR_CODE_PATTERN.test(code) && relay.status !== "pairing";
  const note = relay.pairError ? PAIR_ERROR_NOTES[relay.pairError] : null;

  async function connect() {
    if (!canConnect) return;
    try {
      await relay.pair(code);
      setCode("");
    } catch {
      // The reason is already reflected in `relay.pairError`.
    }
  }

  return (
    <div className={styles.localAgent}>
      <div
        aria-label="Claude connection status"
        className={styles.webMcpStatus}
        role="status"
      >
        {STATUS_LABELS[relay.status]}
      </div>

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
      <button
        className={styles.pairButton}
        disabled={!canConnect}
        onClick={() => void connect()}
        type="button"
      >
        Connect Claude
      </button>
      {relay.status === "connected" ? (
        <button
          className={styles.pairSecondaryButton}
          onClick={() => void relay.disconnect()}
          type="button"
        >
          Disconnect Claude
        </button>
      ) : null}
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

      {note ? <small className={styles.pairNote}>{note}</small> : null}

      <small className={styles.visuallyHidden} id={hintId}>
        Start pnpm mcp:openinterior, then enter the code printed in that
        terminal.
      </small>
    </div>
  );
}
