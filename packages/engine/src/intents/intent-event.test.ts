import { describe, expect, it } from "vitest";
import { needsLedgerEntry } from "./intent-event.js";
import { intentStates, terminalStates } from "./intent-state.js";

describe("ledger entries", () => {
  it("writes one for the transitions spec 6, section 8 lists", () => {
    expect(intentStates.filter(needsLedgerEntry)).toStrictEqual([
      "proposed",
      "awaiting_confirmation",
      "confirmed",
      "executing",
      "reconciled",
      "paper_filled",
      "rejected_policy",
      "risk_blocked",
      "failed_check",
      "denied",
      "expired",
      "cancelled",
      "failed_onchain",
      "unknown_after_send",
    ]);
  });

  it("writes one for every terminal state", () => {
    expect(terminalStates.every(needsLedgerEntry)).toBe(true);
  });

  it("only pushes a change for the checks and for inclusion and finality", () => {
    const quiet = ["checked", "quoted", "assessed", "simulated", "included", "finalized"] as const;
    expect(quiet.map(needsLedgerEntry)).toStrictEqual([false, false, false, false, false, false]);
  });
});
