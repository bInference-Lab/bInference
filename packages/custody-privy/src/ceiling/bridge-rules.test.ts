import type { JsonValue } from "@binference/core";
import { describe, expect, it } from "vitest";
import { type DepositArgs, depositToData, depositV3Data } from "../testing/bridge-fixtures.js";
import {
  bridgeAddresses,
  solanaBridgeId,
  testBridgeCall,
  testBridgeCeilingRequest,
  testBridged,
  testDeposits,
  testRouteCaps,
} from "../testing/bridge-target-fixtures.js";
import { testAddresses, testCaps } from "../testing/custody-fixtures.js";
import { evaluatePolicy } from "../testing/fake-policy-engine.js";
import { fakePolicyBodySchema } from "../testing/fake-privy-request.schema.js";
import { buildCeiling } from "./build-ceiling.js";
import type { BridgeDeposit, CeilingRequest, ChainAddresses } from "./ceiling.js";
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

// The test request with these deposits, and with these addresses saved per destination.
function withDeposits(
  deposits: readonly BridgeDeposit[],
  bridged: readonly ChainAddresses[] = testBridged,
): CeilingRequest {
  const request = testBridgeCeilingRequest();
  const chains = request.chains.map((chain) => Object.assign({}, chain, { bridges: deposits }));
  return { ...request, chains, bridged };
}

const [firstDeposit] = testDeposits;
const baseDeposit: BridgeDeposit = firstDeposit ?? {
  call: testBridgeCall,
  destinationChainId: "8453",
  routes: [],
};

const manyAddresses = (count: number): readonly string[] =>
  Array.from({ length: count }, (_, index) => `0x${(index + 1).toString(16).padStart(40, "0")}`);

// The test request saving these addresses and the rescue address for Base, each named there.
function withSaved(saved: readonly string[]): CeilingRequest {
  const bridged = [{ chainId: "8453", addresses: [testAddresses.rescue, ...saved] }];
  return { ...withDeposits([baseDeposit], bridged), saved: bridged };
}

// The names of the rules a request builds.
function names(request: CeilingRequest): readonly string[] {
  return rulesOf(request).map((rule) => (rule as { readonly name: string }).name);
}

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

describe("a deposit that pays 32 bytes", () => {
  const { solanaSaved, solanaUnsaved, solanaUsdc } = bridgeAddresses;
  const toSolana = (args: Partial<DepositArgs>) =>
    depositToData({
      depositor: wallet,
      recipient: solanaSaved,
      inputToken: bscUsdc,
      outputToken: solanaUsdc,
      destinationChainId: BigInt(solanaBridgeId),
      ...args,
    });

  it("lists the addresses saved for Solana and its token that arrives as lowercase hex", () => {
    const rule = rules.find((item) => JSON.stringify(item).includes(`to ${solanaBridgeId}, 1`));
    expect(JSON.stringify(rule)).toContain(`"value":["${solanaSaved}"]`);
    expect(JSON.stringify(rule)).toContain(`"value":"${solanaUsdc}"`);
  });

  it("allows a deposit to a saved Solana address, in any case, and refuses any other", () => {
    expect(verdict({ data: toSolana({}) })).toBe("ALLOW");
    expect(
      verdict({
        data: toSolana({
          recipient: solanaSaved.toUpperCase().replace("0X", "0x") as `0x${string}`,
        }),
      }),
    ).toBe("ALLOW");
    expect(verdict({ data: toSolana({ recipient: solanaUnsaved }) })).toBe("DENY");
    expect(verdict({ data: toSolana({ destinationChainId: 8453n }) })).toBe("DENY");
  });

  it("refuses an address of the wrong length for its recipient input, never padding it", () => {
    const refused = { ok: false, error: "malformed_address" };
    const request = testBridgeCeilingRequest();
    const twentyForSolana = [{ chainId: solanaBridgeId, addresses: [baseSaved] }];
    const thirtyTwoForBase = [{ chainId: "8453", addresses: [solanaSaved] }];
    expect(
      buildCeiling({ ...request, saved: twentyForSolana, bridged: twentyForSolana }),
    ).toStrictEqual(refused);
    expect(
      buildCeiling({ ...request, saved: thirtyTwoForBase, bridged: thirtyTwoForBase }),
    ).toStrictEqual(refused);
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
    const changed = [{ ...baseDeposit, call: { ...baseDeposit.call, bridge } }];
    expect(buildCeiling(withDeposits(changed))).toStrictEqual({ ok: false, error: "bad_bridge" });
  });

  it("refuses a repeated destination, or a bad chain id", () => {
    const refused = { ok: false, error: "bad_bridge" };
    expect(buildCeiling(withDeposits([baseDeposit, baseDeposit]))).toStrictEqual(refused);
    const badChain = [{ chainId: "08453", addresses: [baseSaved] }];
    const request = withDeposits([{ ...baseDeposit, destinationChainId: "08453" }], badChain);
    expect(buildCeiling({ ...request, saved: badChain })).toStrictEqual(refused);
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

  it("lists the rescue address and 99 saved ones for one destination, and refuses one more", () => {
    const rule = rulesOf(withSaved(manyAddresses(99))).find((item) =>
      JSON.stringify(item).includes("chain 56 to 8453, 1"),
    );
    expect(JSON.stringify(rule)).toContain(testAddresses.rescue);
    expect(buildCeiling(withSaved(manyAddresses(100)))).toStrictEqual({
      ok: false,
      error: "too_many_addresses",
    });
  });
});

describe("who a bridge deposit pays", () => {
  it("pays only addresses still saved for the destination", () => {
    const request = testBridgeCeilingRequest();
    const unsavedRobinhood = {
      ...request,
      saved: request.saved.filter((item) => item.chainId !== "4663"),
    };
    expect(names(request)).toContain("Bridge depositV3, chain 56 to 4663, 1");
    expect(names(unsavedRobinhood)).not.toContain("Bridge depositV3, chain 56 to 4663, 1");
    expect(names(unsavedRobinhood)).toContain("Bridge depositV3, chain 56 to 8453, 1");
  });

  it("takes an old rescue address out of a destination once it is listed there no more", () => {
    const request = testBridgeCeilingRequest();
    const replaced = {
      ...request,
      rescue: testAddresses.unsaved,
      saved: request.saved.filter((item) => item.chainId !== "1"),
    };
    const ethereum = names(replaced).filter((name) => name.includes(" to 1, "));
    expect(ethereum).toStrictEqual([]);
  });

  it("never pays an address saved for a destination by a send on the chain it leaves", () => {
    const sends = rulesOf(testBridgeCeilingRequest()).find((rule) =>
      JSON.stringify(rule).includes("Native sends, chain 56"),
    );
    expect(JSON.stringify(sends)).not.toContain(robinhoodSaved);
    expect(JSON.stringify(sends)).toContain(testAddresses.rescue);
  });

  it("pays no destination the ceiling names no address for", () => {
    expect(names(withDeposits(testDeposits, []))).not.toContain(
      "Bridge depositV3, chain 56 to 8453, 1",
    );
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
      {
        chainId: "56",
        destinationChainId: solanaBridgeId,
        function: "depositTo",
        recipients: [bridgeAddresses.solanaSaved],
      },
    ]);
    expect(isBuiltCeiling(rules)).toBe(true);
  });

  it("counts the spoke pool among the contracts and the deposit among the functions", () => {
    expect(readCeiling(rules)).toMatchObject({
      contracts: [testAddresses.router, spokePool],
      functions: ["swap", "swapTo", "depositV3", "depositTo"],
    });
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
