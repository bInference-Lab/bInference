import type { JsonValue } from "@binference/core";
import { describe, expect, it } from "vitest";
import { type DepositArgs, depositV3Data } from "../testing/bridge-fixtures.js";
import {
  bridgeAddresses,
  testBridgeCall,
  testBridgeCeilingRequest,
  testRouteCaps,
  testTargets,
} from "../testing/bridge-target-fixtures.js";
import { testAddresses, testCaps } from "../testing/custody-fixtures.js";
import { evaluatePolicy } from "../testing/fake-policy-engine.js";
import { fakePolicyBodySchema } from "../testing/fake-privy-request.schema.js";
import { buildCeiling } from "./build-ceiling.js";
import type { BridgeTarget, CeilingRequest } from "./ceiling.js";
import { policyRuleJson } from "./policy-rule.js";
import { isBuiltCeiling, readCeiling } from "./read-ceiling.js";

const wallet = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
const { spokePool, bscUsdc, bscEth, baseUsdc, baseSaved, robinhoodSaved, robinhoodWeth } =
  bridgeAddresses;

function rulesOf(request: CeilingRequest): readonly JsonValue[] {
  const built = buildCeiling(request);
  if (!built.ok) {
    throw new Error(built.error);
  }
  return built.value.rules.map(policyRuleJson);
}

const rules = rulesOf(testBridgeCeilingRequest());
const fakeRules = fakePolicyBodySchema.parse({
  version: "1.0",
  name: "binference ceiling",
  chain_type: "ethereum",
  rules,
}).rules;

function deposit(args: Partial<DepositArgs>): `0x${string}` {
  return depositV3Data({
    depositor: wallet,
    recipient: baseSaved,
    inputToken: bscUsdc,
    outputToken: baseUsdc,
    destinationChainId: 8453n,
    ...args,
  });
}

function verdict(call: {
  readonly to?: string;
  readonly value?: bigint;
  readonly data: `0x${string}`;
}) {
  return evaluatePolicy(
    fakeRules,
    {
      method: "eth_signTransaction",
      to: call.to ?? spokePool,
      valueWei: call.value ?? 0n,
      chainId: 56n,
      data: call.data,
      walletAddress: wallet,
    },
    (aggregation) => (aggregation === testCaps.native.aggregation ? 0n : 0n),
  );
}

function withTargets(targets: readonly BridgeTarget[]): CeilingRequest {
  const request = testBridgeCeilingRequest();
  const chains = request.chains.map((chain) => Object.assign({}, chain, { bridges: targets }));
  return { ...request, chains };
}

const [firstTarget] = testTargets;
const baseTarget: BridgeTarget = firstTarget ?? {
  call: testBridgeCall,
  destinationChainId: "8453",
  recipients: [],
  routes: [],
};

// The ceiling's rules with the Base target's conditions edited.
function tampered(edit: (conditions: readonly JsonValue[]) => readonly JsonValue[]) {
  return rules.map((rule) => {
    const named = rule as { readonly name: string; readonly conditions: readonly JsonValue[] };
    return named.name === "Bridge depositV3, chain 56 to 8453, 1"
      ? Object.assign({}, named, { conditions: edit(named.conditions) })
      : rule;
  });
}

function field(condition: JsonValue): string {
  return (condition as { readonly field: string }).field;
}

function ruleNamed(name: string): JsonValue {
  const found = rules.find((rule) => (rule as { readonly name: string }).name === name);
  if (found === undefined) {
    throw new Error(`no rule ${name}`);
  }
  return found;
}

describe("a bridge deposit's rule", () => {
  it("binds the depositor, the recipient and the chain together, and the tokens", () => {
    expect(ruleNamed("Bridge depositV3, chain 56 to 8453, 1")).toStrictEqual({
      name: "Bridge depositV3, chain 56 to 8453, 1",
      method: "eth_signTransaction",
      action: "ALLOW",
      conditions: [
        { field_source: "ethereum_transaction", field: "chain_id", operator: "eq", value: "56" },
        { field_source: "ethereum_transaction", field: "to", operator: "in", value: [spokePool] },
        { field_source: "ethereum_transaction", field: "value", operator: "lte", value: "0x0" },
        expect.objectContaining({ field: "function_name", operator: "eq", value: "depositV3" }),
        expect.objectContaining({
          field: "depositV3.depositor",
          operator: "eq",
          value: "{{wallet.address}}",
        }),
        expect.objectContaining({
          field: "depositV3.recipient",
          operator: "in",
          value: [baseSaved],
        }),
        expect.objectContaining({
          field: "depositV3.destinationChainId",
          operator: "eq",
          value: "8453",
        }),
        expect.objectContaining({
          field: "depositV3.inputToken",
          operator: "eq",
          value: bscUsdc,
        }),
        expect.objectContaining({
          field: "depositV3.outputToken",
          operator: "eq",
          value: baseUsdc,
        }),
      ],
    });
  });

  it("allows a deposit to an address saved for its chain, and to the rescue address on Ethereum", () => {
    expect(verdict({ data: deposit({}) })).toBe("ALLOW");
    expect(
      verdict({
        data: deposit({
          recipient: robinhoodSaved,
          inputToken: bscEth,
          outputToken: robinhoodWeth,
          destinationChainId: 4663n,
        }),
      }),
    ).toBe("ALLOW");
    expect(
      verdict({
        data: deposit({
          recipient: testAddresses.rescue,
          outputToken: bridgeAddresses.ethereumUsdc,
          destinationChainId: 1n,
        }),
      }),
    ).toBe("ALLOW");
  });

  it.each([
    ["an unsaved recipient", { recipient: testAddresses.unsaved }],
    ["an address saved for Base, on Ethereum", { destinationChainId: 1n }],
    ["an address saved for Base, on Robinhood Chain", { destinationChainId: 4663n }],
    ["a chain the owner named none of", { destinationChainId: 10n }],
    ["another depositor, who would get the refund", { depositor: testAddresses.unsaved }],
    ["a token no route to Base takes", { inputToken: bscEth }],
    ["a token no route to Base delivers", { outputToken: robinhoodWeth }],
  ])("refuses a deposit with %s", (_case, args: Partial<DepositArgs>) => {
    expect(verdict({ data: deposit(args) })).toBe("DENY");
  });

  it("refuses a deposit that carries coin, or goes to another contract", () => {
    expect(verdict({ data: deposit({}), value: 1n })).toBe("DENY");
    expect(verdict({ data: deposit({}), to: testAddresses.unlisted })).toBe("DENY");
  });
});

describe("building bridge targets", () => {
  it.each([
    ["a recipient that is no input", { ...testBridgeCall.bridge, recipient: "receiver" }],
    [
      "a chain input that is an address",
      { ...testBridgeCall.bridge, destinationChain: "recipient" },
    ],
    ["one input bound twice", { ...testBridgeCall.bridge, tokenOut: "inputToken" }],
  ])("refuses %s", (_case, bridge) => {
    const changed = [{ ...baseTarget, call: { ...baseTarget.call, bridge } }];
    expect(buildCeiling(withTargets(changed))).toStrictEqual({ ok: false, error: "bad_bridge" });
  });

  it("refuses a target with no recipient, a repeated destination, or a bad chain id", () => {
    const refused = { ok: false, error: "bad_bridge" };
    expect(buildCeiling(withTargets([{ ...baseTarget, recipients: [] }]))).toStrictEqual(refused);
    expect(buildCeiling(withTargets([baseTarget, baseTarget]))).toStrictEqual(refused);
    expect(
      buildCeiling(withTargets([{ ...baseTarget, destinationChainId: "08453" }])),
    ).toStrictEqual(refused);
  });

  it("refuses a deposit function that is also a plain call, which would pay anyone", () => {
    const request = testBridgeCeilingRequest();
    const plainCall = { ...testBridgeCall, walletInputs: [] };
    const plain = request.chains.map((chain) =>
      Object.assign({}, chain, { calls: [...chain.calls, plainCall] }),
    );
    expect(buildCeiling({ ...request, chains: plain })).toStrictEqual({
      ok: false,
      error: "bad_bridge",
    });
  });

  it("refuses more than 100 recipients for one destination", () => {
    const many = Array.from(
      { length: 101 },
      (_, index) => `0x${(index + 1).toString(16).padStart(40, "0")}`,
    );
    expect(buildCeiling(withTargets([{ ...baseTarget, recipients: many }]))).toStrictEqual({
      ok: false,
      error: "too_many_addresses",
    });
  });
});

describe("a bridge route's 24-hour cap", () => {
  it("refuses a route whose token that leaves has no approval cap on the chain", () => {
    const refused = { ok: false, error: "uncapped_token" };
    const usdcOnly = testRouteCaps.slice(0, 1);
    expect(buildCeiling(testBridgeCeilingRequest(testCaps, []))).toStrictEqual(refused);
    expect(buildCeiling(testBridgeCeilingRequest(testCaps, usdcOnly))).toStrictEqual(refused);
    expect(buildCeiling(testBridgeCeilingRequest(testCaps, testRouteCaps)).ok).toBe(true);
  });

  it("refuses a cap read back from a policy, which names no token, for a route", () => {
    const named = testRouteCaps.map(({ aggregation, limitBase }) => ({ aggregation, limitBase }));
    expect(buildCeiling(testBridgeCeilingRequest(testCaps, named))).toStrictEqual({
      ok: false,
      error: "uncapped_token",
    });
  });
});

describe("reading bridge rules back", () => {
  it("reads each target's recipients and holds the rules for a built ceiling", () => {
    expect(readCeiling(rules)?.bridges).toStrictEqual([
      { chainId: "56", destinationChainId: "8453", function: "depositV3", recipients: [baseSaved] },
      {
        chainId: "56",
        destinationChainId: "4663",
        function: "depositV3",
        recipients: [robinhoodSaved],
      },
      {
        chainId: "56",
        destinationChainId: "1",
        function: "depositV3",
        recipients: [testAddresses.rescue],
      },
    ]);
    expect(isBuiltCeiling(rules)).toBe(true);
  });

  it.each([
    [
      "the depositor pin dropped",
      (all: readonly JsonValue[]) => all.filter((item) => field(item) !== "depositV3.depositor"),
    ],
    [
      "the chain condition dropped",
      (all: readonly JsonValue[]) =>
        all.filter((item) => field(item) !== "depositV3.destinationChainId"),
    ],
  ])("finds the ceiling changed with %s", (_case, edit) => {
    expect(isBuiltCeiling(tampered(edit))).toBe(false);
  });
});
