import type { JsonValue } from "@binference/core";
import { describe, expect, it } from "vitest";
import { ruleTexts } from "./policy-rules.schema.js";

// A call rule whose function takes one tuple, the tuple's parts as given.
function ruleWith(components: readonly JsonValue[]): JsonValue {
  const abi = [
    { type: "function", name: "swap", inputs: [{ name: "desc", type: "tuple", components }] },
  ];
  return {
    name: "Call swap, chain 56",
    method: "eth_signTransaction",
    action: "ALLOW",
    conditions: [
      {
        field_source: "ethereum_calldata",
        field: "function_name",
        operator: "eq",
        value: "swap",
        abi,
      },
    ],
  };
}

const parts = [
  { name: "token", type: "address" },
  { name: "amount", type: "uint256" },
];

describe("ruleTexts", () => {
  it("tells apart two functions whose tuples differ, and keeps what Privy echoes besides", () => {
    const echoed = parts.map((part) => ({ ...part, internalType: part.type }));
    const other = [
      { name: "token", type: "address" },
      { name: "amount", type: "uint128" },
    ];

    expect(ruleTexts([ruleWith(echoed)])).toStrictEqual(ruleTexts([ruleWith(parts)]));
    expect(ruleTexts([ruleWith(other)])).not.toStrictEqual(ruleTexts([ruleWith(parts)]));
  });
});
