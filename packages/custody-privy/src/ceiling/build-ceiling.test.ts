import { chainRefSchema } from "@binference/chain";
import type { JsonValue } from "@binference/core";
import { describe, expect, it } from "vitest";
import {
  oneBnbWei,
  testAddresses,
  testCalls,
  testCaps,
  testCeilingRequest,
  testChain,
  testCurveAbi,
  testLaunch,
  testLaunchCeilingRequest,
  testRouterAbi,
} from "../testing/custody-fixtures.js";
import { evaluatePolicy } from "../testing/fake-policy-engine.js";
import { fakePolicyBodySchema } from "../testing/fake-privy-request.schema.js";
import { buildCeiling } from "./build-ceiling.js";
import type { Ceiling, CeilingChain, CeilingRequest, LaunchCeiling } from "./ceiling.js";
import { abiFunctionJson, policyRuleJson } from "./policy-rule.js";

const { router, rescue, saved } = testAddresses;

const approve = {
  type: "function",
  name: "approve",
  inputs: [
    { name: "spender", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  outputs: [{ name: "", type: "bool" }],
  stateMutability: "nonpayable",
};
const transfer = {
  ...approve,
  name: "transfer",
  inputs: [{ name: "to", type: "address" }, approve.inputs[1]],
};
const onChain = {
  field_source: "ethereum_transaction",
  field: "chain_id",
  operator: "eq",
  value: "56",
};
const noCoin = {
  field_source: "ethereum_transaction",
  field: "value",
  operator: "lte",
  value: "0x0",
};
const toRouter = {
  field_source: "ethereum_transaction",
  field: "to",
  operator: "in",
  value: [router],
};
const oneBnbCap = {
  field_source: "ethereum_transaction",
  field: "value",
  operator: "lte",
  value: "0xde0b6b3a7640000",
};
const nativeDayCap = {
  field_source: "reference",
  field: "aggregation.testcapnative000000000000",
  operator: "lte",
  value: "0x29a2241af62c0000",
};
const swapAbi = abiFunctionJson(testRouterAbi.swap);
const swapToAbi = abiFunctionJson(testRouterAbi.swapTo);

// Written out by hand from spec 5, section 4: a change to the ceiling changes this test.
const expectedRules = [
  {
    name: "Call swap, chain 56",
    method: "eth_signTransaction",
    action: "ALLOW",
    conditions: [
      onChain,
      toRouter,
      oneBnbCap,
      {
        field_source: "ethereum_calldata",
        field: "function_name",
        abi: [swapAbi],
        operator: "eq",
        value: "swap",
      },
      nativeDayCap,
    ],
  },
  {
    name: "Call swapTo, chain 56",
    method: "eth_signTransaction",
    action: "ALLOW",
    conditions: [
      onChain,
      toRouter,
      oneBnbCap,
      {
        field_source: "ethereum_calldata",
        field: "function_name",
        abi: [swapToAbi],
        operator: "eq",
        value: "swapTo",
      },
      {
        field_source: "ethereum_calldata",
        field: "swapTo.receiver",
        abi: [swapToAbi],
        operator: "eq",
        value: "{{wallet.address}}",
      },
      nativeDayCap,
    ],
  },
  {
    name: "Approvals, chain 56",
    method: "eth_signTransaction",
    action: "ALLOW",
    conditions: [
      onChain,
      noCoin,
      {
        field_source: "ethereum_calldata",
        field: "approve.spender",
        abi: [approve],
        operator: "in",
        value: [router],
      },
      {
        field_source: "reference",
        field: "aggregation.testcaptoken0000000000000",
        operator: "lte",
        value: "0x3e8",
      },
    ],
  },
  {
    name: "Native sends, chain 56",
    method: "eth_signTransaction",
    action: "ALLOW",
    conditions: [
      onChain,
      { field_source: "ethereum_transaction", field: "to", operator: "in", value: [rescue, saved] },
    ],
  },
  {
    name: "Token sends, chain 56",
    method: "eth_signTransaction",
    action: "ALLOW",
    conditions: [
      onChain,
      noCoin,
      {
        field_source: "ethereum_calldata",
        field: "transfer.to",
        abi: [transfer],
        operator: "in",
        value: [rescue, saved],
      },
    ],
  },
  {
    name: "Self cancel, chain 56",
    method: "eth_signTransaction",
    action: "ALLOW",
    conditions: [
      onChain,
      {
        field_source: "ethereum_transaction",
        field: "to",
        operator: "eq",
        value: "{{wallet.address}}",
      },
      noCoin,
    ],
  },
  { name: "Owner export", method: "exportPrivateKey", action: "ALLOW", conditions: [] },
];

function built(request: CeilingRequest): ReturnType<typeof buildCeiling> {
  return buildCeiling(request);
}

function ceilingOf(request: CeilingRequest): Ceiling {
  const ceiling = buildCeiling(request);
  if (!ceiling.ok) {
    throw new Error(`No ceiling: ${ceiling.error}`);
  }
  return ceiling.value;
}

function rulesOf(request: CeilingRequest): readonly JsonValue[] {
  return ceilingOf(request).rules.map(policyRuleJson);
}

// The test request with other lists on its one chain.
function withLists(lists: Partial<Omit<CeilingChain, "chain">>): CeilingRequest {
  const [chain] = testCeilingRequest().chains;
  if (chain === undefined) {
    throw new Error("The test request has a chain.");
  }
  return { ...testCeilingRequest(), chains: [{ ...chain, ...lists }] };
}

function lower(text: string): string {
  return text.toLowerCase();
}

describe("buildCeiling", () => {
  it("builds the ceiling of spec 5 section 4 as Privy rules for one chain", () => {
    const ceiling = ceilingOf(testCeilingRequest());
    expect(ceiling.rules.map(policyRuleJson)).toStrictEqual(expectedRules);
    expect(ceiling.chains).toStrictEqual([testChain.ref]);
  });

  it("writes rules Privy's policy schema accepts, every name within 50 characters", () => {
    const body = {
      version: "1.0",
      name: "binference ceiling",
      chain_type: "ethereum",
      rules: rulesOf(testCeilingRequest()),
    };
    expect(fakePolicyBodySchema.safeParse(body).success).toBe(true);
  });

  it("allows no EIP-7702 authorization", () => {
    const rules = fakePolicyBodySchema.parse({
      version: "1.0",
      name: "binference ceiling",
      chain_type: "ethereum",
      rules: rulesOf(testCeilingRequest()),
    }).rules;
    const request = {
      to: router,
      valueWei: 0n,
      chainId: 56n,
      data: "0x" as const,
      walletAddress: rescue,
    };

    expect(evaluatePolicy(rules, { ...request, method: "eth_sign7702Authorization" })).toBe("DENY");
  });

  it("checksums every address and lists each once", () => {
    const calls = [
      ...testCalls,
      { contract: lower(router), abi: testRouterAbi.swap, walletInputs: [] },
    ];
    const rules = rulesOf({
      ...withLists({ calls, spenders: [lower(router), router] }),
      saved: [lower(saved), saved, lower(rescue)],
    });
    expect(rules).toStrictEqual(expectedRules);
  });

  it("lists every contract a function is declared on in its one rule", () => {
    const other = { contract: testAddresses.unlisted, abi: testRouterAbi.swap, walletInputs: [] };
    const ceiling = ceilingOf(withLists({ calls: [...testCalls, other] }));
    const swap = ceiling.rules.find((rule) => rule.name === "Call swap, chain 56");
    expect(swap?.conditions[1]).toStrictEqual({
      ...toRouter,
      value: [router, testAddresses.unlisted],
    });
  });

  it("leaves out the call and approval rules of a chain with no listed call or spender", () => {
    const ceiling = ceilingOf(withLists({ calls: [], spenders: [] }));
    expect(ceiling.rules.map((rule) => rule.name)).toStrictEqual(
      expectedRules.slice(3).map((rule) => rule.name),
    );
  });

  it("writes one set of rules per chain, each bound to its own chain id", () => {
    const request = testCeilingRequest();
    const other = { ...testChain, ref: chainRefSchema.parse("eip155:204"), chainId: 204 };
    const caps = {
      native: { aggregation: "othernative", limitBase: 5n },
      approvals: [{ aggregation: "othertoken", limitBase: 5n }],
    };
    const second = {
      chain: other,
      calls: testCalls,
      spenders: [router],
      perTxNativeCapBase: 5n,
      caps,
    };
    const ceiling = ceilingOf({ ...request, chains: [...request.chains, second] });
    const names = ceiling.rules.map((rule) => rule.name);
    expect(names.filter((name) => name.endsWith("chain 204"))).toHaveLength(6);
    expect(ceiling.chains).toStrictEqual([testChain.ref, other.ref]);
  });

  it.each([
    ["no_chain", { ...testCeilingRequest(), chains: [] }],
    [
      "repeated_chain",
      {
        ...testCeilingRequest(),
        chains: [...testCeilingRequest().chains, ...testCeilingRequest().chains],
      },
    ],
    ["malformed_address", { ...testCeilingRequest(), rescue: "0x123" }],
    [
      "malformed_address",
      { ...testCeilingRequest(), saved: ["0xeA6F82DbD6C87DE5E542eFbd1f9964879828e4E7"] },
    ],
    [
      "too_many_addresses",
      {
        ...testCeilingRequest(),
        saved: Array.from({ length: 100 }, (_, n) => `0x${n.toString(16).padStart(40, "0")}`),
      },
    ],
    ["negative_cap", withLists({ perTxNativeCapBase: -1n })],
    [
      "negative_cap",
      withLists({ caps: { ...testCaps, native: { ...testCaps.native, limitBase: -1n } } }),
    ],
    [
      "bad_cap",
      withLists({ caps: { ...testCaps, approvals: [{ aggregation: "a b", limitBase: 1n }] } }),
    ],
    [
      "bad_call",
      withLists({
        calls: [{ contract: router, abi: testRouterAbi.swap, walletInputs: ["amountIn"] }],
      }),
    ],
    [
      "bad_call",
      withLists({
        calls: [
          {
            contract: router,
            abi: { ...testRouterAbi.swap, name: "s".repeat(40) },
            walletInputs: [],
          },
        ],
      }),
    ],
    [
      "clashing_calls",
      withLists({
        calls: [
          { contract: router, abi: testRouterAbi.swapTo, walletInputs: ["receiver"] },
          { contract: testAddresses.unlisted, abi: testRouterAbi.swapTo, walletInputs: [] },
        ],
      }),
    ],
    [
      "too_many_caps",
      withLists({
        caps: {
          ...testCaps,
          approvals: Array.from({ length: 10 }, (_, n) => ({
            aggregation: `cap${String(n)}`,
            limitBase: 1n,
          })),
        },
      }),
    ],
  ] as const)("refuses a request with %s", (problem, request) => {
    expect(built(request)).toStrictEqual({ ok: false, error: problem });
  });

  it("refuses a malformed contract or spender", () => {
    const calls = [{ contract: "router", abi: testRouterAbi.swap, walletInputs: [] }];
    expect(built(withLists({ calls }))).toStrictEqual({ ok: false, error: "malformed_address" });
    expect(built(withLists({ spenders: ["router"] }))).toStrictEqual({
      ok: false,
      error: "malformed_address",
    });
  });

  it("takes 99 saved addresses beside the rescue address, Privy's limit of 100", () => {
    const saved99 = Array.from(
      { length: 99 },
      (_, n) => `0x${(n + 1).toString(16).padStart(40, "0")}`,
    );
    expect(built({ ...testCeilingRequest(), saved: saved99 }).ok).toBe(true);
    expect(oneBnbWei).toBe(1_000_000_000_000_000_000n);
  });
});

// A launch call rule as written out by hand from decision 0217: the function on any contract, at
// most the cap in native coin, paying the wallet itself, under the native 24-hour cap.
function launchCallRule(side: "buy" | "sell") {
  const abi = [abiFunctionJson(testCurveAbi[side])];
  return {
    name: `Launch call ${side}, chain 56`,
    method: "eth_signTransaction",
    action: "ALLOW",
    conditions: [
      onChain,
      oneBnbCap,
      {
        field_source: "ethereum_calldata",
        field: "function_name",
        abi,
        operator: "eq",
        value: side,
      },
      {
        field_source: "ethereum_calldata",
        field: `${side}.recipient`,
        abi,
        operator: "eq",
        value: "{{wallet.address}}",
      },
      nativeDayCap,
    ],
  };
}

const launchApprovals = {
  name: "Launch approvals, chain 56",
  method: "eth_signTransaction",
  action: "ALLOW",
  conditions: [
    onChain,
    noCoin,
    {
      field_source: "ethereum_calldata",
      field: "function_name",
      abi: [approve],
      operator: "eq",
      value: "approve",
    },
    {
      field_source: "reference",
      field: "aggregation.testcaptoken0000000000000",
      operator: "lte",
      value: "0x3e8",
    },
  ],
};

// The test request's one chain with other launch rules.
function withLaunch(launch: LaunchCeiling): CeilingRequest {
  const [chain] = testLaunchCeilingRequest().chains;
  if (chain === undefined) {
    throw new Error("The test request has a chain.");
  }
  return { ...testLaunchCeilingRequest(), chains: [{ ...chain, launch }] };
}

describe("a launch wallet's ceiling", () => {
  it("adds to the agent's rules a rule per launch call on any contract and any approval", () => {
    const rules = rulesOf(testLaunchCeilingRequest());
    expect(rules).toStrictEqual([
      ...expectedRules.slice(0, 3),
      launchCallRule("buy"),
      launchCallRule("sell"),
      launchApprovals,
      ...expectedRules.slice(3),
    ]);
    const body = { version: "1.0", name: "binference ceiling", chain_type: "ethereum", rules };
    expect(fakePolicyBodySchema.safeParse(body).success).toBe(true);
  });

  it("names no contract in a launch rule, and approves any spender only when one is declared", () => {
    const named = rulesOf(withLaunch({ ...testLaunch, approvesAnySpender: false }));
    expect(named).toStrictEqual(rulesOf(testLaunchCeilingRequest()).toSpliced(5, 1));
    expect(JSON.stringify(named.slice(3, 5))).not.toContain('"field":"to"');
  });

  it("takes a launch call declared twice once", () => {
    const twice = { ...testLaunch, calls: [...testLaunch.calls, ...testLaunch.calls] };
    expect(rulesOf(withLaunch(twice))).toStrictEqual(rulesOf(testLaunchCeilingRequest()));
  });

  it.each([
    ["bad_call", { calls: [{ abi: testCurveAbi.buy, walletInputs: [] }] }],
    ["bad_call", { calls: [{ abi: testCurveAbi.buy, walletInputs: ["amountIn"] }] }],
    [
      "bad_call",
      {
        calls: [
          { abi: { ...testCurveAbi.buy, name: "b".repeat(32) }, walletInputs: ["recipient"] },
        ],
      },
    ],
    [
      "clashing_calls",
      {
        calls: [
          { abi: testCurveAbi.buy, walletInputs: ["recipient"] },
          { abi: { ...testCurveAbi.sell, name: "buy" }, walletInputs: ["recipient"] },
        ],
      },
    ],
  ] as const)("refuses launch calls with %s", (problem, launch) => {
    const request = withLaunch({ ...launch, approvesAnySpender: true });
    expect(built(request)).toStrictEqual({ ok: false, error: problem });
  });
});
