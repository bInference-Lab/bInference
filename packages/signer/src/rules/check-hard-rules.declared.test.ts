import type { AuthorizeInput, CallInputCheck, DeclaredCall, SignStep } from "@binference/chain";
import type { JsonValue } from "@binference/core";
import { describe, expect, it } from "vitest";
import {
  accountOn,
  approveCalldata,
  authorizeFixture,
  bridgeDepositAbi,
  bridgeDepositCalldata,
  fixtureAddresses,
  fixtureDeposit,
  fixtureNowMs,
  fixtureSettings,
  withTransaction,
} from "../testing/sign-fixtures.js";
import { brokenHardRules, checkHardRules, type HardRuleContext } from "./check-hard-rules.js";

const { router, token, saved } = fixtureAddresses;
const context: HardRuleContext = { settings: fixtureSettings, nowMs: fixtureNowMs };
const call = authorizeFixture();

// A function's JSON ABI entry with its input types, enough for its selector.
function abiOf(name: string, types: readonly string[]): JsonValue {
  return {
    type: "function",
    name,
    inputs: types.map((type, index) => ({ name: `a${String(index)}`, type })),
    stateMutability: "nonpayable",
  };
}

// The fixture's router call is `swapExactETHForTokens` (`0x7ff36ab5`).
const swapAbi = abiOf("swapExactETHForTokens", ["uint256", "address[]", "address", "uint256"]);

// The calls declared on the router, as the engine passes them.
const declaring = (calls: readonly DeclaredCall[]): AuthorizeInput => ({
  ...call,
  allowed: { ...call.allowed, calls },
});
const onRouter = (abi: JsonValue): DeclaredCall => ({ contract: accountOn(router), abi });

// A call to the router with this selector and no arguments that matter.
const callWith = (selector: string): AuthorizeInput =>
  withTransaction(declaring([onRouter(swapAbi), onRouter(bridgeDepositAbi)]), {
    data: `0x${selector}${"0".repeat(64 * 4)}`,
  });

describe("a call to a contract whose functions the venues declare", () => {
  it("signs a call to a declared function, and any call to a contract no entry names", () => {
    expect(checkHardRules(declaring([onRouter(swapAbi)]), context)).toBeUndefined();
    const elsewhere = { contract: accountOn(saved), abi: bridgeDepositAbi };
    expect(checkHardRules(declaring([elsewhere]), context)).toBeUndefined();
  });

  it.each([
    ["Across's deposit with 32-byte values", "ad5425c6"],
    ["Across's depositNow", "ea86bd46"],
    ["Across's unsafeDeposit", "8b15788e"],
    ["Across's fillRelay, which pays from the wallet's allowance", "deff4b24"],
    ["Relay's depositErc20 with no amount", "5a1ee3ac"],
    ["StakeHub's redelegate", "59491871"],
    ["Lista's claimWithdrawFor, which pays another user", "9a53d5af"],
  ])("refuses %s on a contract that declares other functions, as rule 2", (_case, selector) => {
    expect(brokenHardRules(callWith(selector), context)).toStrictEqual([2]);
  });

  it("refuses every call to a contract whose declared function cannot be read", () => {
    expect(brokenHardRules(declaring([onRouter({})]), context)).toStrictEqual([2]);
  });

  it("holds a launch's own contract to the launch calls declared", () => {
    const curve = fixtureAddresses.stranger;
    const curveCall: AuthorizeInput = {
      ...withTransaction(call, { to: curve }),
      wallet: { ...call.wallet, role: "launch" },
      allowed: { ...call.allowed, contracts: [], launch: [accountOn(curve)] },
    };
    const launchCalls = (abi: JsonValue) => ({
      ...curveCall,
      allowed: { ...curveCall.allowed, calls: [{ abi }] },
    });
    expect(checkHardRules(launchCalls(swapAbi), context)).toBeUndefined();
    expect(brokenHardRules(launchCalls(bridgeDepositAbi), context)).toStrictEqual([2]);
  });
});

const withStep = (input: AuthorizeInput, step: Partial<SignStep>): AuthorizeInput => ({
  ...input,
  step: { ...input.step, ...step },
});

// An approval naming the router, which only a bridge wallet may approve, as Relay's depository.
const approve: AuthorizeInput = {
  ...withStep(
    withTransaction(call, { to: token, value: "0x0", data: approveCalldata(router, 1000n) }),
    {
      action: {
        kind: "approve",
        token: accountOn(token),
        spender: accountOn(router),
        amount: 1000n,
      },
    },
  ),
  allowed: {
    ...call.allowed,
    walletOnlySpenders: [{ role: "bridge", spender: accountOn(router) }],
  },
};

describe("an approval of a spender only a wallet of one role approves", () => {
  it("signs it from a wallet of that role, and refuses it from any other, as rule 2", () => {
    const fromBridgeWallet = { ...approve, wallet: { ...approve.wallet, role: "bridge" as const } };
    expect(checkHardRules(fromBridgeWallet, context)).toBeUndefined();
    expect(brokenHardRules(approve, context)).toStrictEqual([2]);
    const fromLaunchWallet = { ...approve, wallet: { ...approve.wallet, role: "launch" as const } };
    expect(brokenHardRules(fromLaunchWallet, context)).toStrictEqual([2]);
  });
});

// A bridge deposit under this check alone.
const depositWith = (check: CallInputCheck): AuthorizeInput => ({
  ...withTransaction(call, { data: bridgeDepositCalldata(fixtureDeposit) }),
  allowed: { ...call.allowed, callInputs: [check] },
});

describe("a bridge deposit whose check the engine marks", () => {
  const mark = { recipient: "recipient", destinationChain: "destinationChainId" };
  const depositCheck: CallInputCheck = {
    abi: bridgeDepositAbi,
    wallet: ["depositor"],
    equal: { recipient: saved, destinationChainId: "8453" },
    empty: ["message"],
    atLeast: { outputAmount: "19900000" },
    bridge: mark,
  };

  it("signs it once the confirmed plan names its recipient, chain and least output", () => {
    expect(checkHardRules(depositWith(depositCheck), context)).toBeUndefined();
  });

  it.each([
    ["no recipient", { ...depositCheck, equal: { destinationChainId: "8453" } }],
    ["no destination chain", { ...depositCheck, equal: { recipient: saved } }],
    ["no least output", { ...depositCheck, atLeast: {} }],
    [
      "nothing from a plan, as the engine sends it today",
      { ...depositCheck, equal: {}, atLeast: {} },
    ],
  ])("refuses it with %s, as rule 2", (_case, check) => {
    expect(brokenHardRules(depositWith(check), context)).toStrictEqual([2]);
  });
});
