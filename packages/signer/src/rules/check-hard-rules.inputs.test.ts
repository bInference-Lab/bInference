import type { AuthorizeInput } from "@binference/chain";
import { describe, expect, it } from "vitest";
import {
  authorizeFixture,
  bridgeDepositAbi,
  bridgeDepositCalldata,
  type FixtureDeposit,
  fixtureAddresses,
  fixtureDeposit,
  fixtureNowMs,
  fixtureSettings,
  withTransaction,
} from "../testing/sign-fixtures.js";
import { brokenHardRules, checkHardRules, type HardRuleContext } from "./check-hard-rules.js";
import type { HardRule } from "./hard-rule.js";

const { saved, stranger } = fixtureAddresses;
const context: HardRuleContext = { settings: fixtureSettings, nowMs: fixtureNowMs };
const call = authorizeFixture();

// A bridge deposit with the checks the engine passes for it (decision 0302): the depositor the
// wallet, the confirmed recipient and chain, no message, and at least the quote's output.
const depositCheck = {
  abi: bridgeDepositAbi,
  wallet: ["depositor"],
  equal: { recipient: saved, destinationChainId: "8453" },
  empty: ["message"],
  atLeast: { outputAmount: "19900000" },
};
const depositWith = (change: Partial<FixtureDeposit>): AuthorizeInput => ({
  ...withTransaction(call, { data: bridgeDepositCalldata({ ...fixtureDeposit, ...change }) }),
  allowed: { ...call.allowed, callInputs: [depositCheck] },
});
const deposit = depositWith({});

describe("a call's inputs under the checks the engine passes", () => {
  it.each([
    ["a bridge deposit whose inputs the checks name", deposit],
    [
      "a venue call that no check of another function reads",
      { ...call, allowed: { ...call.allowed, callInputs: [depositCheck] } },
    ],
  ])("signs %s", (_case, input) => {
    expect(checkHardRules(input, context)).toBeUndefined();
  });

  it.each<readonly [HardRule, string, AuthorizeInput]>([
    [2, "a deposit whose depositor is another account", depositWith({ depositor: stranger })],
    [2, "a deposit to another recipient", depositWith({ recipient: stranger })],
    [2, "a deposit to another chain", depositWith({ destinationChainId: 1n })],
    [2, "a deposit whose message runs actions on arrival", depositWith({ message: "01" })],
    [
      2,
      "a deposit whose check cannot be read",
      { ...deposit, allowed: { ...call.allowed, callInputs: [{ ...depositCheck, abi: {} }] } },
    ],
    [
      2,
      "a deposit cut short of its inputs",
      withTransaction(deposit, { data: bridgeDepositCalldata(fixtureDeposit).slice(0, 200) }),
    ],
    [
      3,
      "a deposit that pays out less than the quote's least",
      depositWith({ outputAmount: 19_899_999n }),
    ],
  ])("breaks rule %i, and that rule only, for %s", (rule, _case, input) => {
    expect(brokenHardRules(input, context)).toStrictEqual([rule]);
  });
});
