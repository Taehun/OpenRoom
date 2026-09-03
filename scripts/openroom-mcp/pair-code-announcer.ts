import { REPAIRABLE_SESSION_CLOSURES } from "./session-registry";

/**
 * Owns every decision about when the companion prints a pair code, and is the
 * only place a code is minted outside startup.
 *
 * Two very different events ask for a replacement. A session that ends with
 * nobody attached - the page disconnected, or its heartbeat lapsed - spends the
 * code that was already used, and the operator is sitting in front of the page
 * waiting to type the next one: that reissue is immediate. A lockout is the
 * opposite: five wrong codes just arrived from something on an allowed origin,
 * and an immediate replacement would hand it a fresh code every five guesses,
 * so the odds of success would grow linearly with attempts no matter how large
 * the code space is. That reissue is delayed, the delay doubles with every
 * consecutive lockout, and after `MAX_LOCKOUT_REISSUES` the process stops
 * minting altogether and says so.
 *
 * Timers are injected so the schedule can be tested without waiting on real
 * time, and every timer is unref'd: the announcer must never be the reason the
 * companion process stays alive.
 */

/** Wait before the first replacement after a lockout. */
export const LOCKOUT_REISSUE_BASE_DELAY_MS = 1_000;

/** Ceiling on the doubling, so the operator's worst wait stays a minute. */
export const LOCKOUT_REISSUE_MAX_DELAY_MS = 60_000;

/**
 * Lockouts a single process will replace a code for. Ten blocks is fifty
 * guesses against fifty independent codes - odds under one in twenty thousand -
 * after which pairing needs a restart, which is a human in the loop.
 */
export const MAX_LOCKOUT_REISSUES = 10;

/** Guards `2 ** steps` against a runaway exponent; the cap applies long before. */
const MAX_DOUBLINGS = 30;

/**
 * Delay before the replacement for the nth consecutive lockout: 1 s, 2 s, 4 s,
 * … capped at `LOCKOUT_REISSUE_MAX_DELAY_MS`.
 */
export function lockoutReissueDelayMs(
  consecutiveLockouts: number,
  baseDelayMs: number = LOCKOUT_REISSUE_BASE_DELAY_MS,
  maxDelayMs: number = LOCKOUT_REISSUE_MAX_DELAY_MS,
): number {
  const steps = Math.min(Math.max(consecutiveLockouts - 1, 0), MAX_DOUBLINGS);
  return Math.min(baseDelayMs * 2 ** steps, maxDelayMs);
}

export interface PairCodeAnnouncerOptions {
  /**
   * Mints the next code, which also clears the relay's failed-attempt lockout.
   * Returns `null` before the relay exists, so a diagnostic that arrives during
   * startup announces nothing rather than throwing.
   */
  issue: () => { code: string; expiresAt: number } | null;
  /** Operator-facing log sink; stderr in the companion process. */
  log: (message: string) => void;
  /** Backoff overrides; production uses the exported defaults. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxLockouts?: number;
  /** Injected timer, so the schedule can be driven without real time. */
  setTimer?: (handler: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface PairCodeAnnouncer {
  /** Mints and prints a code now. Used at startup and for session closures. */
  announce(): void;
  /** Reissues immediately for a closure that leaves nobody attached. */
  onSessionDiagnostic(message: string): void;
  /** Schedules the backed-off replacement, or reports that minting has stopped. */
  onPairLockout(): void;
  /** A page paired: the next lockout starts again at the base delay. */
  onPairSuccess(): void;
  /** Cancels any pending reissue. Idempotent; for process teardown. */
  stop(): void;
}

export function createPairCodeAnnouncer(options: PairCodeAnnouncerOptions): PairCodeAnnouncer {
  const baseDelayMs = options.baseDelayMs ?? LOCKOUT_REISSUE_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? LOCKOUT_REISSUE_MAX_DELAY_MS;
  const maxLockouts = options.maxLockouts ?? MAX_LOCKOUT_REISSUES;
  const setTimer =
    options.setTimer ?? ((handler: () => void, ms: number): unknown => setTimeout(handler, ms));
  const clearTimer =
    options.clearTimer ?? ((handle: unknown): void => clearTimeout(handle as NodeJS.Timeout));

  /** Drives the delay; a successful pair puts the operator back at one second. */
  let consecutiveLockouts = 0;
  /** Drives the ceiling; deliberately never reset, so the bound is per process. */
  let totalLockouts = 0;
  let exhaustedReported = false;
  let pending: unknown = null;

  function cancelPending(): void {
    if (pending === null) return;
    clearTimer(pending);
    pending = null;
  }

  function announce(): void {
    try {
      const issued = options.issue();
      if (issued === null) return;
      options.log(`pairing code ${issued.code} expires ${new Date(issued.expiresAt).toISOString()}`);
      options.log(
        'in OpenRoom press "Connect an AI app", type it into the "Pairing code" field, then press "Connect"',
      );
    } catch (error) {
      // A failure here must not break whatever request produced the diagnostic.
      options.log(
        `could not issue a pair code: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    announce,

    onSessionDiagnostic(message: string): void {
      if (!REPAIRABLE_SESSION_CLOSURES.has(message)) return;
      // The page that held the session is gone and its code is spent; this is
      // the operator's only way back in, so it is not delayed or counted.
      cancelPending();
      announce();
    },

    onPairLockout(): void {
      if (totalLockouts >= maxLockouts) {
        if (exhaustedReported) return;
        exhaustedReported = true;
        options.log(
          `no pair code reissued after ${maxLockouts} lockouts; restart the companion to pair again`,
        );
        return;
      }

      totalLockouts += 1;
      consecutiveLockouts += 1;
      const delayMs = lockoutReissueDelayMs(consecutiveLockouts, baseDelayMs, maxDelayMs);
      options.log(
        `next pair code in ${Math.round(delayMs / 1_000)}s (lockout ${totalLockouts} of ${maxLockouts})`,
      );

      cancelPending();
      const handle = setTimer(() => {
        pending = null;
        announce();
      }, delayMs);
      // Guarded because a stubbed or browser timer handle has no `unref`.
      (handle as { unref?: () => void } | null)?.unref?.();
      pending = handle;
    },

    onPairSuccess(): void {
      consecutiveLockouts = 0;
      // A page holds the session now, so a queued replacement would put a live
      // code where none is needed - and burn the one the operator just typed.
      cancelPending();
    },

    stop: cancelPending,
  };
}
