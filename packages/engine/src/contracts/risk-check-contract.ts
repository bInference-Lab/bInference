import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import { riskViewSchema } from "@binference/protocol";
import { z } from "zod";
import { riskReasons } from "../intents/intent-reason.js";
import type { RiskCheck } from "../ports.js";
import type { RiskSubject } from "../risk/risk-assessment.js";

/** A risk check under test, a trade it passes and one it refuses. */
export interface RiskCheckSubject {
  readonly check: RiskCheck;
  /** A trade that buys a token the chain registry lists. */
  readonly verified: RiskSubject;
  /** A trade it refuses. */
  readonly refused: RiskSubject;
}

/** Makes a fresh {@link RiskCheckSubject} for each check. */
export interface RiskCheckHarness {
  create(): RiskCheckSubject;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

/** The contract every `RiskCheck` adapter passes. */
export function riskCheckContract(harness: RiskCheckHarness): readonly ContractCheck[] {
  return [
    {
      name: "passes a trade that buys a token the registry lists, with a passing view",
      run: async () => {
        const { check, verified } = harness.create();
        const assessment = await check.assess(verified, live());
        assert.equal(assessment.refusal, undefined);
        assert.doesNotThrow(() => z.encode(riskViewSchema, assessment.view));
        assert.equal(assessment.view.verdict, "pass");
      },
    },
    {
      name: "refuses with one of spec 6's risk reasons and a blocking view",
      run: async () => {
        const { check, refused } = harness.create();
        const assessment = await check.assess(refused, live());
        assert.ok(riskReasons.some((reason) => reason === assessment.refusal));
        assert.doesNotThrow(() => z.encode(riskViewSchema, assessment.view));
        assert.equal(assessment.view.verdict, "block");
      },
    },
    {
      name: "rejects with the signal's reason once the signal aborts",
      run: async () => {
        const { check, refused } = harness.create();
        const reason = new Error("stopped");
        await assert.rejects(check.assess(refused, { signal: AbortSignal.abort(reason) }), reason);
      },
    },
  ];
}
