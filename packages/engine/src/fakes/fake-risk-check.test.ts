import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { riskCheckContract } from "../contracts/risk-check-contract.js";
import { testChains } from "../operations/test-engine.js";
import { listedTokenQuote, riskSubjectOf, unknownTokenQuote } from "../risk/test-round-trip.js";
import { createFakeRiskCheck } from "./fake-risk-check.js";

const nowMs = 1_800_000_000_000;
const live = { signal: new AbortController().signal };

describe("fake risk check", () => {
  it.each(
    riskCheckContract({
      create: () => ({
        check: createFakeRiskCheck({ chains: testChains(), clock: createManualClock(nowMs) }),
        verified: riskSubjectOf(listedTokenQuote(nowMs)),
        refused: riskSubjectOf(unknownTokenQuote(nowMs)),
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("refuses a token the registry does not list with the reason it was given", async () => {
    const check = createFakeRiskCheck({
      chains: testChains(),
      clock: createManualClock(nowMs),
      refusal: "honeypot",
    });
    await expect(
      check.assess(riskSubjectOf(unknownTokenQuote(nowMs)), live),
    ).resolves.toMatchObject({
      refusal: "honeypot",
      view: { verdict: "block", checkedAt: nowMs },
    });
  });
});
