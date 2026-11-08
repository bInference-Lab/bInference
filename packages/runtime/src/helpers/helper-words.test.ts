import { operations } from "@binference/protocol";
import type { HelperRecord } from "@binference/store";
import { describe, expect, it } from "vitest";
import { nthTestId } from "../testing/memory-agent-stores.js";
import { endedText, stoppedByRestartText } from "./helper-words.js";

const helper: HelperRecord = {
  id: nthTestId("ses", 2),
  agentId: nthTestId("agt", 1),
  parentSessionId: nthTestId("ses", 1),
  label: "BNB news",
  state: "done",
  startedAtMs: 1,
  endedAtMs: 2,
  timeoutMs: 600_000,
  runs: 1,
  outside: false,
};

// Whether the engine takes the words as `helper/ended` carries them.
function taken(text: string): boolean {
  const args = {
    agent: helper.agentId,
    helper: helper.id,
    surface: "cli",
    text,
    outsideContent: false,
  };
  return operations["helper/ended"].args.safeParse(args).success;
}

describe("the words of a helper's end", () => {
  it("fit what the engine takes, however long the report, and point to the rest", () => {
    const report = "x".repeat(50_000);
    const states = ["done", "failed", "timed_out"] as const;
    const texts = states.map((state) => endedText({ ...helper, state }, { report }));
    expect(texts.map(taken)).toStrictEqual([true, true, true]);
    expect(texts[0]).toContain("[cut: read the rest with helper_read]");
    const many = Array.from({ length: 400 }, (_, n) => ({
      ...helper,
      label: `helper ${String(n)}`,
    }));
    expect(taken(stoppedByRestartText(many))).toBe(true);
  });

  it("say why a run failed, or that it ran out of its minutes", () => {
    expect(endedText({ ...helper, state: "failed" }, { failure: "budget" })).toContain(
      "budget of the day is spent",
    );
    expect(endedText({ ...helper, state: "timed_out", timeoutMs: 120_000 }, {})).toContain(
      "ran out of its 2 minutes",
    );
    expect(endedText(helper, {})).toContain("finished with no report");
  });
});
