import { describe, expect, it } from "vitest";
import { intentStates, isTerminalState, terminalStates } from "./intent-state.js";

describe("intent states", () => {
  it("lists the 20 states of spec 6, each once", () => {
    expect(intentStates).toHaveLength(20);
    expect(new Set(intentStates).size).toBe(20);
  });

  it("marks the nine terminal states and nothing else as terminal", () => {
    expect(intentStates.filter(isTerminalState)).toStrictEqual([...terminalStates]);
    expect(terminalStates).toStrictEqual([
      "reconciled",
      "paper_filled",
      "rejected_policy",
      "risk_blocked",
      "failed_check",
      "denied",
      "expired",
      "cancelled",
      "failed_onchain",
    ]);
  });

  it("keeps unknown_after_send open until reconciliation ends it", () => {
    expect(isTerminalState("unknown_after_send")).toBe(false);
  });
});
