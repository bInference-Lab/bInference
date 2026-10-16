import type { AuthorizeInput, SignStep } from "@binference/chain";
import { describe, expect, it } from "vitest";
import {
  accountOn,
  approveCalldata,
  authorizeFixture,
  fixtureAddresses,
  fixtureNowMs,
  fixtureSettings,
  withTransaction,
} from "../testing/sign-fixtures.js";
import { brokenHardRules, checkHardRules, type HardRuleContext } from "./check-hard-rules.js";

const { router, token, saved } = fixtureAddresses;
const context: HardRuleContext = { settings: fixtureSettings, nowMs: fixtureNowMs };
const call = authorizeFixture();

const withStep = (input: AuthorizeInput, step: Partial<SignStep>): AuthorizeInput => ({
  ...input,
  step: { ...input.step, ...step },
});
const approve = withStep(
  withTransaction(call, { to: token, value: "0x0", data: approveCalldata(router, 1000n) }),
  {
    action: { kind: "approve", token: accountOn(token), spender: accountOn(router), amount: 1000n },
  },
);

// A step on a launch's own curve: a call to it, and an approval naming it, with the launch's
// contracts read for the step (decision 0217), from the launch wallet or from another.
const curve = fixtureAddresses.stranger;
const launchAllowed = { ...call.allowed, contracts: [], launch: [accountOn(curve)] };
const curveCall = { ...withTransaction(call, { to: curve }), allowed: launchAllowed };
const curveApproval = {
  ...withStep(
    withTransaction(approve, { to: token, value: "0x0", data: approveCalldata(curve, 1000n) }),
    {
      action: {
        kind: "approve",
        token: accountOn(token),
        spender: accountOn(curve),
        amount: 1000n,
      },
    },
  ),
  allowed: { ...approve.allowed, spenders: [], launch: [accountOn(curve)] },
};
const fromLaunchWallet = (input: AuthorizeInput): AuthorizeInput => ({
  ...input,
  wallet: { ...input.wallet, role: "launch" },
});

describe("a launch wallet's steps on a launch's own contracts", () => {
  it("signs a call to the launch's curve and an approval naming it, from a launch wallet", () => {
    expect(checkHardRules(fromLaunchWallet(curveCall), context)).toBeUndefined();
    expect(checkHardRules(fromLaunchWallet(curveApproval), context)).toBeUndefined();
  });

  it("refuses the same call and approval from any other wallet, as rule 2", () => {
    expect(brokenHardRules(curveCall, context)).toStrictEqual([2]);
    expect(brokenHardRules(curveApproval, context)).toStrictEqual([2]);
  });

  it("refuses a launch wallet's call to a contract of no launch the step names", () => {
    const elsewhere = { ...curveCall, allowed: { ...launchAllowed, launch: [accountOn(saved)] } };
    expect(brokenHardRules(fromLaunchWallet(elsewhere), context)).toStrictEqual([2]);
    const unnamed = { ...curveCall, allowed: { ...call.allowed, contracts: [] } };
    expect(brokenHardRules(fromLaunchWallet(unnamed), context)).toStrictEqual([2]);
  });

  it("refuses a launch wallet's approval naming a spender no launch of the step holds", () => {
    const other = {
      ...withStep(
        withTransaction(approve, { to: token, value: "0x0", data: approveCalldata(saved, 1000n) }),
        {
          action: {
            kind: "approve",
            token: accountOn(token),
            spender: accountOn(saved),
            amount: 1000n,
          },
        },
      ),
      allowed: curveApproval.allowed,
    };
    expect(brokenHardRules(fromLaunchWallet(other), context)).toStrictEqual([2]);
    const unlaunched = { ...curveApproval, allowed: { ...curveApproval.allowed, launch: [] } };
    expect(brokenHardRules(fromLaunchWallet(unlaunched), context)).toStrictEqual([2]);
  });
});
