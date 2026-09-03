import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// The former product name is assembled at runtime, and never written out in
// full anywhere in this file, so the searches below do not match this file's
// own source or path and report this test as a straggler.
const LEGACY = ["open", "interior"].join("");
const LEGACY_HYPHENATED = ["open", "interior"].join("-");

// Dated records under docs/superpowers/** and .superpowers/** are historical
// design documents and keep the old name on purpose.
const HISTORICAL = [":!docs/superpowers", ":!.superpowers"];

function trackedFilesMentioningLegacyName(): string {
  try {
    return execFileSync(
      "git",
      ["grep", "-il", `${LEGACY}\\|${LEGACY_HYPHENATED}`, "--", ".", ...HISTORICAL],
      { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch (error) {
    // `git grep` exits 1 when nothing matches, which is the passing case.
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    if (failure.status === 1) {
      return (failure.stdout ?? "").trim();
    }
    throw new Error(
      `git grep failed with status ${String(failure.status)}: ${failure.stderr ?? ""}`,
    );
  }
}

// `git grep` reads file contents only, so a directory or file name still
// carrying the old brand would slip past it. Both legacy spellings are already
// lower case, so lowering the path makes the comparison case-insensitive.
function trackedPathsNamedAfterLegacyName(): string {
  const tracked = execFileSync("git", ["ls-files", "--", ".", ...HISTORICAL], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return tracked
    .split("\n")
    .filter((path) => {
      const lowered = path.toLowerCase();
      return lowered.includes(LEGACY) || lowered.includes(LEGACY_HYPHENATED);
    })
    .join("\n");
}

describe("brand name", () => {
  it("leaves no reference to the former product name outside the historical design records", () => {
    expect(trackedFilesMentioningLegacyName()).toBe("");
    expect(trackedPathsNamedAfterLegacyName()).toBe("");
  });
});
