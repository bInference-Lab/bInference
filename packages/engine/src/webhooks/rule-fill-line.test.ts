import type { Id, JsonValue } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { testAgent, testNowMs, testToken } from "../intents/test-intents.js";
import { testChains } from "../operations/test-engine.js";
import type { OrderFillReason } from "../orders/order-fill.js";
import { type AlertFillRecord, isFillEnd } from "./alert-fill-record.js";
import { isHeldByOwnFill, type RuleLineParts, ruleLineOf } from "./rule-fill-line.js";
import type { WebhookRuleRecord } from "./webhook-rule-record.js";

const live = { signal: new AbortController().signal };

const rule = {
  id: fixtureId("whr", 1),
  agentId: testAgent,
  isPaper: false,
  request: { token: testToken, name: "BNB breakout" },
  version: 3,
} as unknown as WebhookRuleRecord;

// The alert at the head of the line, row 9, with no end yet.
const alert: AlertFillRecord = {
  event: 9,
  ruleId: rule.id,
  receivedAtMs: testNowMs,
  wasEngineLocked: false,
};

// Alert `event`'s skip, which intent `n` ended with `reason`.
function skipped(event: number, n: number, reason: OrderFillReason): AlertFillRecord {
  return { ...alert, event, outcome: "skipped", reason, intentId: fixtureId("int", n) };
}

// A live fill of the agent the executor holds, for alert `event`.
function inFlight(event: number): IntentRecord {
  const authorizedBy: JsonValue = { webhookRule: rule.id, event };
  return { id: fixtureId("int", 99), authorizedBy } as unknown as IntentRecord;
}

// The line's parts over these fills in flight and these alerts of the rule, newest first, whose
// failed intents ended at `endedAtMs`; asked for the rule's fills, it answers those alone, as the
// stores do.
function partsOf(world: {
  readonly held?: readonly IntentRecord[];
  readonly alerts?: readonly AlertFillRecord[];
  readonly endedAtMs?: number;
}): RuleLineParts {
  const endedAtMs = world.endedAtMs ?? testNowMs;
  return {
    intents: {
      fillsInFlight: async () => Promise.resolve(world.held ?? []),
      get: async (id: Id<"int">) =>
        Promise.resolve({ id, changedAtMs: endedAtMs } as unknown as IntentRecord),
    },
    rules: {
      alerts: async ({ onlyFills }) =>
        Promise.resolve((world.alerts ?? []).filter((row) => onlyFills !== true || isFillEnd(row))),
    },
    chains: testChains(),
    clock: createManualClock(testNowMs),
  };
}

// Where the live rule's line stands over these alerts, its failed fills ended at `endedAtMs`.
async function lineOf(alerts: readonly AlertFillRecord[], endedAtMs: number) {
  return (await ruleLineOf(partsOf({ alerts, endedAtMs }), { rule, ...live })).kind;
}

describe("a live rule's line of fills", () => {
  it("knows an alert its own fill in flight holds, and skips one behind another live fill", async () => {
    const isHeld = async (held: readonly IntentRecord[], of = rule) =>
      isHeldByOwnFill(partsOf({ held }), { rule: of, alert, ...live });
    const other = await ruleLineOf(partsOf({ held: [inFlight(8)] }), { rule, ...live });
    const free = await ruleLineOf(partsOf({}), { rule, ...live });
    const paper = { ...rule, isPaper: true };
    const onPaper = await ruleLineOf(partsOf({ held: [inFlight(8)] }), { rule: paper, ...live });

    expect([await isHeld([inFlight(9)]), await isHeld([inFlight(8)])]).toStrictEqual([true, false]);
    expect(await isHeld([inFlight(9)], paper)).toBe(false);
    expect([other, free, onPaper]).toStrictEqual([
      { kind: "skip", skip: { reason: "fill_waiting", tells: true } },
      { kind: "free" },
      { kind: "free" },
    ]);
  });

  it("backs off from its second failure on chain, by when the failed fill ended", async () => {
    const one = [skipped(8, 2, "reverted")];
    const two = [skipped(8, 2, "reverted"), skipped(7, 1, "stuck_dropped")];
    // More alerts skipped behind the fills than a page holds never push the failures out.
    const waits = Array.from({ length: 20 }, (_, n) => skipped(100 - n, 50 + n, "fill_waiting"));

    expect(await lineOf(one, testNowMs)).toBe("free");
    expect(await lineOf(two, testNowMs - 14_999)).toBe("skip");
    expect(await lineOf(two, testNowMs - 15_000)).toBe("free");
    expect(await lineOf([...waits, ...two], testNowMs - 14_999)).toBe("skip");
    expect(await lineOf([{ ...alert, event: 6, outcome: "filled" }, ...two], testNowMs)).toBe(
      "free",
    );
  });
});
