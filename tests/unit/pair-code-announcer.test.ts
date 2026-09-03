// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import {
  LOCKOUT_REISSUE_BASE_DELAY_MS,
  LOCKOUT_REISSUE_MAX_DELAY_MS,
  MAX_LOCKOUT_REISSUES,
  createPairCodeAnnouncer,
  lockoutReissueDelayMs,
  type PairCodeAnnouncer,
} from "../../scripts/openroom-mcp/pair-code-announcer";
import {
  SESSION_CLOSED_BY_PAGE,
  SESSION_CLOSED_HEARTBEAT_EXPIRED,
} from "../../scripts/openroom-mcp/session-registry";

/**
 * The announcer is the whole reissue policy: it decides when a fresh pair code
 * is minted after a lockout, how long the operator waits for it, and when the
 * process stops minting altogether. Timers are injected so the schedule is
 * driven exactly rather than approximately, and nothing here waits on real time.
 */

interface Scheduled {
  handler: () => void;
  ms: number;
  cancelled: boolean;
  unrefs: number;
}

class FakeTimers {
  readonly scheduled: Scheduled[] = [];

  setTimer = (handler: () => void, ms: number): unknown => {
    const entry: Scheduled = { handler, ms, cancelled: false, unrefs: 0 };
    this.scheduled.push(entry);
    return { unref: () => (entry.unrefs += 1), entry };
  };

  clearTimer = (handle: unknown): void => {
    const entry = (handle as { entry?: Scheduled } | null)?.entry;
    if (entry) entry.cancelled = true;
  };

  /** Fires every timer scheduled so far that is still live, oldest first. */
  runPending(): void {
    for (const entry of [...this.scheduled]) {
      if (entry.cancelled) continue;
      entry.cancelled = true;
      entry.handler();
    }
  }

  get pendingDelays(): number[] {
    return this.scheduled.filter((entry) => !entry.cancelled).map((entry) => entry.ms);
  }
}

let timers: FakeTimers;
let log: string[];
let issued: number;
let announcer: PairCodeAnnouncer;

function codes(): string[] {
  return [...log.join("\n").matchAll(/pairing code (\d{6})\b/g)].map((match) => match[1]);
}

function createAnnouncer(issue?: () => { code: string; expiresAt: number } | null): PairCodeAnnouncer {
  return createPairCodeAnnouncer({
    issue:
      issue ??
      (() => {
        issued += 1;
        return { code: String(issued).padStart(6, "0"), expiresAt: 1_700_000_000_000 };
      }),
    log: (message) => log.push(message),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
}

/** Burns one lockout and lets its scheduled reissue fire. */
function lockoutAndReissue(): void {
  announcer.onPairLockout();
  timers.runPending();
}

beforeEach(() => {
  timers = new FakeTimers();
  log = [];
  issued = 0;
  announcer = createAnnouncer();
});

describe("lockout reissue delay", () => {
  it("doubles from one second and caps at sixty", () => {
    expect(LOCKOUT_REISSUE_BASE_DELAY_MS).toBe(1_000);
    expect(LOCKOUT_REISSUE_MAX_DELAY_MS).toBe(60_000);
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => lockoutReissueDelayMs(n))).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000, 60_000,
    ]);
  });

  it("never overflows or dips below the base delay", () => {
    expect(lockoutReissueDelayMs(0)).toBe(LOCKOUT_REISSUE_BASE_DELAY_MS);
    expect(lockoutReissueDelayMs(1_000)).toBe(LOCKOUT_REISSUE_MAX_DELAY_MS);
    expect(Number.isFinite(lockoutReissueDelayMs(1_000))).toBe(true);
  });
});

describe("pair code announcer", () => {
  it("prints a code and how to use it", () => {
    announcer.announce();

    expect(codes()).toEqual(["000001"]);
    expect(log.some((line) => line.includes('"Pairing code" field'))).toBe(true);
    expect(timers.pendingDelays).toEqual([]);
  });

  it("reports a failed mint without throwing", () => {
    announcer = createAnnouncer(() => {
      throw new Error("relay is closed");
    });

    expect(() => announcer.announce()).not.toThrow();
    expect(log.join("\n")).toContain("could not issue a pair code: relay is closed");
    expect(codes()).toEqual([]);
  });

  it("says nothing when there is no relay to mint through", () => {
    announcer = createAnnouncer(() => null);
    announcer.announce();
    expect(log).toEqual([]);
  });
});

describe("lockout backoff", () => {
  it("delays the first replacement rather than minting immediately", () => {
    // An immediate reissue makes guessing cost five attempts per fresh code
    // forever, so success odds grow linearly with attempts. The delay is what
    // restores a super-linear cost to a caller on an allowed origin.
    announcer.onPairLockout();
    expect(codes()).toEqual([]);
    expect(timers.pendingDelays).toEqual([LOCKOUT_REISSUE_BASE_DELAY_MS]);

    timers.runPending();
    expect(codes()).toEqual(["000001"]);
    expect(timers.pendingDelays).toEqual([]);
  });

  it("doubles the delay for each consecutive lockout", () => {
    const delays: number[] = [];
    for (let lockout = 0; lockout < 4; lockout += 1) {
      announcer.onPairLockout();
      delays.push(timers.pendingDelays[0]);
      timers.runPending();
    }

    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000]);
    expect(codes()).toEqual(["000001", "000002", "000003", "000004"]);
  });

  it("resets to the base delay once a page pairs", () => {
    lockoutAndReissue();
    lockoutAndReissue();
    announcer.onPairLockout();
    expect(timers.pendingDelays).toEqual([4_000]);
    timers.runPending();

    announcer.onPairSuccess();
    announcer.onPairLockout();
    expect(timers.pendingDelays).toEqual([LOCKOUT_REISSUE_BASE_DELAY_MS]);
  });

  it("drops a pending reissue when a page pairs first", () => {
    announcer.onPairLockout();
    announcer.onPairSuccess();
    timers.runPending();

    expect(codes()).toEqual([]);
  });

  it("stops reissuing after ten lockouts and says so once", () => {
    for (let lockout = 0; lockout < MAX_LOCKOUT_REISSUES; lockout += 1) lockoutAndReissue();
    expect(codes()).toHaveLength(MAX_LOCKOUT_REISSUES);

    announcer.onPairLockout();
    announcer.onPairLockout();
    timers.runPending();

    expect(codes()).toHaveLength(MAX_LOCKOUT_REISSUES);
    const exhausted = log.filter((line) => line.includes("restart"));
    expect(exhausted).toHaveLength(1);
    expect(exhausted[0]).toContain(String(MAX_LOCKOUT_REISSUES));
  });

  it("counts the ceiling per process, not per pairing", () => {
    // A successful pair shortens the next wait but must not buy another ten
    // blocks of guesses, or the bound would be liftable at will.
    for (let lockout = 0; lockout < MAX_LOCKOUT_REISSUES; lockout += 1) {
      lockoutAndReissue();
      announcer.onPairSuccess();
    }

    announcer.onPairLockout();
    timers.runPending();
    expect(codes()).toHaveLength(MAX_LOCKOUT_REISSUES);
  });

  it("schedules the reissue on an unref'd timer and cancels it on stop", () => {
    announcer.onPairLockout();
    expect(timers.scheduled.at(-1)?.unrefs).toBe(1);

    announcer.stop();
    timers.runPending();
    expect(codes()).toEqual([]);
  });
});

describe("session closure reissue", () => {
  it("mints straight away for a closure that leaves nobody attached", () => {
    // Not a guessing attempt: the code was spent by the page that just left,
    // and the operator is waiting to type the replacement.
    announcer.onSessionDiagnostic(SESSION_CLOSED_BY_PAGE);
    expect(codes()).toEqual(["000001"]);

    announcer.onSessionDiagnostic(SESSION_CLOSED_HEARTBEAT_EXPIRED);
    expect(codes()).toEqual(["000001", "000002"]);
    expect(timers.pendingDelays).toEqual([]);
  });

  it("ignores every other diagnostic", () => {
    for (const line of [
      "session closed: replaced by a new pairing",
      "session closed: relay shutting down",
      "pair attempt rejected",
      "page paired from http://localhost:3000",
      "relay shut down",
    ]) {
      announcer.onSessionDiagnostic(line);
    }

    expect(codes()).toEqual([]);
  });
});
