import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { alertFillWriteSchema } from "./alert-fill-record.js";
import { proposedRuleTermsHash, ruleFillTermsHash } from "./rule-fill-terms-hash.js";

const live = { signal: new AbortController().signal };
const intent = fixtureId("int", 1);
const binding = {
  rule: fixtureId("whr", 1),
  ruleTermsHash: "ab".repeat(32),
  fillsBefore: 2,
  event: 9,
};
const request = { kind: "sell" };

describe("the terms hash of a webhook rule's fill (decision 0342)", () => {
  it("binds a fill with no quote or plan yet, and changes once one is written", () => {
    const bare = ruleFillTermsHash({ id: intent, request }, binding);
    const quoted = ruleFillTermsHash({ id: intent, request, quote: { at: 1 } }, binding);
    const planned = ruleFillTermsHash({ id: intent, request, plan: [] }, binding);

    expect(bare).toMatch(/^[0-9a-f]{64}$/u);
    expect(new Set([bare, quoted, planned]).size).toBe(3);
  });

  it("changes with the rule's fills before it, so a fill binds the count it was sized at", () => {
    const record = { id: intent, request };

    expect(ruleFillTermsHash(record, binding)).not.toBe(
      ruleFillTermsHash(record, { ...binding, fillsBefore: 3 }),
    );
  });

  it("is none for a fill whose rule's card holds no confirmation", async () => {
    const rule = { id: binding.rule, intentId: fixtureId("int", 2), fills: 0 } as never;
    const simulated = { record: { id: intent, request } } as never;
    const intents = { confirmation: async () => Promise.resolve(undefined) };

    await expect(
      proposedRuleTermsHash(intents, { rule, event: 9, simulated, signal: live.signal }),
    ).resolves.toBeUndefined();
  });
});

describe("an alert's end as stored", () => {
  it.each<readonly [string, Readonly<Record<string, unknown>>]>([
    ["a skip with no reason", { event: 1, outcome: "skipped" }],
    ["a fill with a reason", { event: 1, outcome: "filled", reason: "late", intentId: intent }],
    ["a fill with no intent", { event: 1, outcome: "filled" }],
  ])("refuses %s", (_case, write) => {
    expect(alertFillWriteSchema.safeParse(write).success).toBe(false);
  });

  it("takes a skip with its reason and a fill with its intent", () => {
    const skip = { event: 1, outcome: "skipped", reason: "late" };
    const fill = { event: 1, outcome: "filled", intentId: intent };

    expect(alertFillWriteSchema.safeParse(skip).success).toBe(true);
    expect(alertFillWriteSchema.safeParse(fill).success).toBe(true);
  });
});
