import { describe, expect, it } from "vitest";
import { maxCeilingBytes } from "../ceiling/ceiling-size.js";
import { type PolicyRule, policyRuleJson } from "../ceiling/policy-rule.js";
import { isPrivyId, type PrivyId } from "../privy/privy-records.js";
import { editsFit } from "./rule-plans.js";

function idOf(text: string): PrivyId {
  if (!isPrivyId(text)) {
    throw new Error(`Expected a Privy id, got ${text}.`);
  }
  return text;
}

// A send rule listing this many characters of addresses.
function ruleOf(name: string, size: number): PolicyRule {
  return {
    name,
    method: "eth_signTransaction",
    action: "ALLOW",
    conditions: [
      {
        field_source: "ethereum_transaction",
        field: "to",
        operator: "in",
        value: ["0".repeat(size)],
      },
    ],
  };
}

const held = ruleOf("Native sends, chain 56", 1_000);
const ref = { id: idOf("rule000000000000000000001"), name: held.name, json: policyRuleJson(held) };
const refs = [ref];
const none = { writes: [], adds: [], removes: [] };

describe("whether a policy fits Privy once edited", () => {
  it("counts the rules kept, written over and added, and none taken out", () => {
    const half = ruleOf("Bridge depositV3, chain 56 to 1, 1", maxCeilingBytes / 2);
    expect(editsFit(refs, none)).toBe(true);
    expect(editsFit(refs, { ...none, adds: [half] })).toBe(true);
    expect(editsFit(refs, { ...none, adds: [half, half] })).toBe(false);
    const big = ruleOf(held.name, maxCeilingBytes);
    expect(editsFit(refs, { ...none, writes: [{ ref, body: big }] })).toBe(false);
    expect(editsFit(refs, { adds: [half], writes: [], removes: refs })).toBe(true);
  });
});
