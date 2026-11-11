import { describe, expect, it } from "vitest";
import type { LineJudgment } from "./allowed-match.js";
import { needsJudging, runsUnanswered, type ShellSettings, shellVerdict } from "./shell-policy.js";

const listed: LineJudgment = { listed: true, canAlwaysAllow: true, steps: [] };
const unlisted: LineJudgment = { listed: false, miss: "unlisted", canAlwaysAllow: true, steps: [] };
const unreadable: LineJudgment = {
  listed: false,
  miss: "unreadable",
  canAlwaysAllow: false,
  steps: [],
};

function settings(change: Partial<ShellSettings>): ShellSettings {
  return {
    run: "any",
    ask: "never",
    onNoAnswer: "refuse",
    timeoutSeconds: 0,
    tellOnQuietEnd: false,
    ...change,
  };
}

describe("what a command does under the owner's shell settings", () => {
  it("runs everything with the defaults, and needs no judging then", () => {
    expect(needsJudging(settings({}))).toBe(false);
    expect(shellVerdict(settings({}), unlisted)).toStrictEqual({ kind: "run" });
  });

  it("asks for every command under always, a listed one too", () => {
    const always = settings({ ask: "always" });
    expect(needsJudging(always)).toBe(true);
    expect(shellVerdict(always, listed)).toStrictEqual({ kind: "ask", reason: "always" });
  });

  it("asks only for what is not listed under unlisted, saying why", () => {
    const asks = settings({ ask: "unlisted" });
    expect(shellVerdict(asks, listed)).toStrictEqual({ kind: "run" });
    expect(shellVerdict(asks, unlisted)).toStrictEqual({ kind: "ask", reason: "unlisted" });
    expect(shellVerdict(asks, unreadable)).toStrictEqual({ kind: "ask", reason: "unreadable" });
  });

  it("refuses what is not listed under listed with never, and runs what is", () => {
    const only = settings({ run: "listed" });
    expect(needsJudging(only)).toBe(true);
    expect(shellVerdict(only, unlisted)).toStrictEqual({ kind: "refuse" });
    expect(shellVerdict(only, listed)).toStrictEqual({ kind: "run" });
  });

  it.each([
    { run: "any", onNoAnswer: "refuse", judgment: unlisted, runs: false },
    { run: "any", onNoAnswer: "listed", judgment: unlisted, runs: false },
    { run: "any", onNoAnswer: "listed", judgment: listed, runs: true },
    { run: "any", onNoAnswer: "any", judgment: unlisted, runs: true },
    { run: "listed", onNoAnswer: "any", judgment: unlisted, runs: false },
    { run: "listed", onNoAnswer: "any", judgment: listed, runs: true },
    { run: "off", onNoAnswer: "any", judgment: listed, runs: false },
  ] as const)(
    "runs an unanswered request under run $run and onNoAnswer $onNoAnswer: $runs",
    ({ run, onNoAnswer, judgment, runs }) => {
      expect(runsUnanswered(settings({ run, onNoAnswer }), judgment)).toBe(runs);
    },
  );
});
