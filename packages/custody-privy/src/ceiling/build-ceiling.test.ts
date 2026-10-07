import { chainRefSchema } from "@binference/chain";
import type { JsonValue } from "@binference/core";
import { describe, expect, it } from "vitest";
import {
  oneBnbWei,
  testAddresses,
  testCeilingRequest,
  testChain,
} from "../testing/custody-fixtures.js";
import { fakePolicyBodySchema } from "../testing/fake-privy-request.schema.js";
import { buildCeiling } from "./build-ceiling.js";
import type { Ceiling, CeilingRequest } from "./ceiling.js";
import { policyRuleJson } from "./policy-rule.js";

const { router, permit2, rescue, saved } = testAddresses;

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
const approvalForAll = {
  type: "function",
  name: "setApprovalForAll",
  inputs: [
    { name: "operator", type: "address" },
    { name: "approved", type: "bool" },
  ],
  outputs: [],
  stateMutability: "nonpayable",
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

// Written out by hand from spec 5, section 4: a change to the ceiling changes this test.
const expectedRules = [
  {
    name: "Contract calls, chain 56",
    method: "eth_signTransaction",
    action: "ALLOW",
    conditions: [
      onChain,
      {
        field_source: "ethereum_transaction",
        field: "to",
        operator: "in",
        value: [router, permit2],
      },
      {
        field_source: "ethereum_transaction",
        field: "value",
        operator: "lte",
        value: "0xde0b6b3a7640000",
      },
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
        value: [router, permit2],
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
  {
    name: "No setApprovalForAll",
    method: "eth_signTransaction",
    action: "DENY",
    conditions: [
      {
        field_source: "ethereum_calldata",
        field: "function_name",
        abi: [approvalForAll],
        operator: "eq",
        value: "setApprovalForAll",
      },
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

interface Lists {
  readonly contracts?: readonly string[];
  readonly spenders?: readonly string[];
  readonly perTxNativeCapBase?: bigint;
}

// The test request with other lists on its one chain.
function withLists(lists: Lists): CeilingRequest {
  return {
    ...testCeilingRequest(),
    chains: [
      {
        chain: testChain,
        contracts: lists.contracts ?? [router, permit2],
        spenders: lists.spenders ?? [router, permit2],
        perTxNativeCapBase: lists.perTxNativeCapBase ?? oneBnbWei,
      },
    ],
  };
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

  it("checksums every address and lists each once", () => {
    const rules = rulesOf({
      ...withLists({ contracts: [lower(router), router, permit2] }),
      saved: [lower(saved), saved, lower(rescue)],
    });
    expect(rules).toStrictEqual(expectedRules);
  });

  it("leaves out the call and approval rules of a chain with no listed contract or spender", () => {
    const ceiling = ceilingOf(withLists({ contracts: [], spenders: [] }));
    expect(ceiling.rules.map((rule) => rule.name)).toStrictEqual(
      expectedRules.slice(2).map((rule) => rule.name),
    );
  });

  it("writes one set of rules per chain, each bound to its own chain id", () => {
    const request = testCeilingRequest();
    const other = { ...testChain, ref: chainRefSchema.parse("eip155:204"), chainId: 204 };
    const second = {
      chain: other,
      contracts: [router],
      spenders: [router],
      perTxNativeCapBase: 5n,
    };
    const ceiling = ceilingOf({ ...request, chains: [...request.chains, second] });
    const names = ceiling.rules.map((rule) => rule.name);
    expect(names.filter((name) => name.endsWith("chain 204"))).toHaveLength(5);
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
  ] as const)("refuses a request with %s", (problem, request) => {
    expect(built(request)).toStrictEqual({ ok: false, error: problem });
  });

  it("refuses a malformed contract or spender", () => {
    expect(built(withLists({ contracts: ["router"] }))).toStrictEqual({
      ok: false,
      error: "malformed_address",
    });
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
