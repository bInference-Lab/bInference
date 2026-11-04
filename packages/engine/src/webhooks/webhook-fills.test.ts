import { describe, expect, it } from "vitest";
import { requestDocument } from "../intents/intent-documents.schema.js";
import { expectOk, testAgent } from "../intents/test-intents.js";
import { testCall, type TestEngine } from "../operations/test-engine.js";
import { fillIntentsOf, noticesOf, startFillEngine } from "../orders/test-fills.js";
import { freeze, tapCard } from "../orders/test-orders.js";
import { present } from "../surfaces/test-venues.js";
import { ruleFillTermsHash } from "./rule-fill-terms-hash.js";
import { alertTo, createdRule, type CreatedRule, testRuleRequest } from "./test-webhook-rules.js";

const live = { signal: new AbortController().signal };

// A rule made active on its card's Confirm, on a paper engine whose wallet holds a whole token.
async function activeRule(test: TestEngine, request = testRuleRequest()): Promise<CreatedRule> {
  const created = await createdRule(test, request);
  await tapCard(test, created.intent, "confirm");
  return created;
}

async function ruleOf(test: TestEngine, created: CreatedRule) {
  return test.stores.webhookRules.get(created.rule, live);
}

async function alertsOf(test: TestEngine, created: CreatedRule) {
  return test.stores.webhookRules.alerts({ ruleId: created.rule, limit: 50 }, live);
}

// The notice keys and the order parts the rule's notices name, oldest first.
function ruleNotices(test: TestEngine): readonly unknown[] {
  return noticesOf(test).filter(
    (data) =>
      JSON.stringify(data).includes("fill.webhookRule") ||
      JSON.stringify(data).includes("webhookHeld"),
  );
}

describe("a webhook rule's fills", () => {
  it("fills an accepted alert once, on paper, from the rule's bounds, and tells the owner", async () => {
    const test = await startFillEngine();
    const created = await activeRule(test);

    expect(await alertTo(test, created.url, '{"id":"a-1","side":"buy","size":"9999"}')).toBe(
      "accepted",
    );
    await test.engine.fillWebhookAlerts(live);
    await test.engine.fillWebhookAlerts(live);

    const filled = await fillIntentsOf(test);
    expect(filled.map(({ kind, state, isPaper }) => ({ kind, state, isPaper }))).toStrictEqual([
      { kind: "sell", state: "paper_filled", isPaper: true },
    ]);
    const [first] = filled;
    expect(requestDocument.decode(present(first).request)).toMatchObject({
      kind: "sell",
      amount: { percentBps: 5_000 },
    });
    expect((await ruleOf(test, created))?.fills).toBe(1);
    const [alert] = await alertsOf(test, created);
    expect(alert).toMatchObject({ outcome: "filled", alertId: "a-1", intentId: filled[0]?.id });
    // Its terms bind the rule's card, the rule's fills before it and the alert's row (0342).
    const card = await test.stores.intents.confirmation(created.intent, live);
    const binding = {
      rule: created.rule,
      ruleTermsHash: present(card).termsHash,
      fillsBefore: 0,
      event: present(alert).event,
    };
    expect(present(first).authorizedBy).toStrictEqual({
      webhookRule: created.rule,
      event: present(alert).event,
      alertId: "a-1",
      fillsBefore: 0,
      termsHash: ruleFillTermsHash(present(first), binding),
    });
    expect(ruleNotices(test)).toMatchObject([
      {
        key: "notice.fill",
        agent: testAgent,
        parts: { orderKind: { key: "fill.webhookRule", values: { name: "BNB breakout" } } },
      },
    ]);
  });

  it("handles, filling nothing, an inbox entry that names no alert it can read", async () => {
    const test = await startFillEngine();
    const entry = { source: "webhook", receivedAtMs: test.clock.now() } as const;
    await test.stores.inbox.admit(
      { ...entry, sourceKey: "wh:unread", payload: { body: "no rule here" } },
      live,
    );
    await test.stores.inbox.admit(
      { ...entry, sourceKey: "wh:pruned", payload: { rule: "whr_gone", event: 999 } },
      live,
    );

    await test.engine.fillWebhookAlerts(live);

    const waiting = await test.stores.inbox.unhandled({ keyPrefix: "wh:", limit: 5 }, live);
    expect(waiting).toStrictEqual([]);
    expect(await fillIntentsOf(test)).toStrictEqual([]);
  });

  it("fills nothing for a replayed alert: the same body is a repeat, and a run takes each alert once", async () => {
    const test = await startFillEngine();
    const created = await activeRule(test);

    expect(await alertTo(test, created.url, "BNBUSDT crossed 600")).toBe("accepted");
    expect(await alertTo(test, created.url, "BNBUSDT crossed 600")).toBe("repeat");
    await test.engine.fillWebhookAlerts(live);
    expect(await alertTo(test, created.url, "BNBUSDT crossed 600")).toBe("repeat");
    await test.engine.fillWebhookAlerts(live);

    expect(await fillIntentsOf(test)).toHaveLength(1);
    expect((await ruleOf(test, created))?.fills).toBe(1);
  });

  it("skips an alert whose fill could not start within a minute, and tells it once in a row", async () => {
    const test = await startFillEngine();
    const created = await activeRule(test);

    await alertTo(test, created.url, "first");
    await alertTo(test, created.url, "second");
    await test.clock.advance(60_000);
    await test.engine.fillWebhookAlerts(live);

    expect(await fillIntentsOf(test)).toStrictEqual([]);
    expect(await alertsOf(test, created)).toMatchObject([
      { outcome: "skipped", reason: "late" },
      { outcome: "skipped", reason: "late" },
    ]);
    expect(ruleNotices(test)).toMatchObject([
      { key: "notice.webhookSkipped", parts: { reason: { key: "reason.late" } } },
    ]);
  });

  it("drops, untold, what the old URL took in the rotation's millisecond, and what a deleted rule took", async () => {
    const test = await startFillEngine();
    const rotated = await activeRule(test);
    const deleted = await activeRule(test, testRuleRequest({ name: "Second" }));
    await alertTo(test, rotated.url, "before the rotation");
    await alertTo(test, deleted.url, "before the delete");

    expectOk(await test.engine.handlers["webhookRule/rotateUrl"](testCall({ rule: rotated.rule })));
    expectOk(await test.engine.handlers["webhookRule/delete"](testCall({ rule: deleted.rule })));
    await test.engine.fillWebhookAlerts(live);

    expect(await fillIntentsOf(test)).toStrictEqual([]);
    expect(await alertsOf(test, rotated)).toMatchObject([
      { outcome: "skipped", reason: "url_rotated" },
    ]);
    expect(await alertsOf(test, deleted)).toMatchObject([
      { outcome: "skipped", reason: "order_inactive" },
    ]);
    expect(await alertTo(test, rotated.url)).toBe("not_found");
    expect(await alertTo(test, deleted.url)).toBe("not_found");
    expect(ruleNotices(test)).toStrictEqual([]);
  });

  it("skips an alert of a frozen agent, and ends a rule with its last fill, its URL a 404", async () => {
    const test = await startFillEngine();
    const created = await activeRule(test, testRuleRequest({ maxFills: 1 }));
    await alertTo(test, created.url, "one");
    await test.engine.fillWebhookAlerts(live);
    expect(await alertTo(test, created.url, "two")).toBe("not_found");
    await test.engine.fillWebhookAlerts(live);
    const other = await activeRule(test, testRuleRequest({ name: "Frozen" }));
    await alertTo(test, other.url, "three");
    await freeze(test);
    await test.engine.fillWebhookAlerts(live);

    expect(await fillIntentsOf(test)).toHaveLength(1);
    expect(await alertsOf(test, created)).toMatchObject([{ outcome: "filled" }]);
    expect(await ruleOf(test, created)).toMatchObject({ state: "deleted", fills: 1 });
    expect(await alertsOf(test, other)).toMatchObject([{ outcome: "skipped", reason: "frozen" }]);
  });

  it("tells five fills an hour, then the count it held back with the next hour's first", async () => {
    const test = await startFillEngine();
    const created = await activeRule(
      test,
      testRuleRequest({ size: { base: 1_000n }, ratePerMinute: 60 }),
    );
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one alert, then its fill, in order
      await alertTo(test, created.url, `alert ${String(n)}`);
      // oxlint-disable-next-line eslint/no-await-in-loop -- one alert, then its fill, in order
      await test.engine.fillWebhookAlerts(live);
    }
    await test.clock.advance(3_600_000);
    await alertTo(test, created.url, "next hour");
    await test.engine.fillWebhookAlerts(live);

    expect((await ruleOf(test, created))?.fills).toBe(8);
    const keys = ruleNotices(test).map((data) => (data as { readonly key: string }).key);
    expect(keys).toStrictEqual([
      ...Array.from({ length: 5 }, () => "notice.fill"),
      "notice.webhookHeld",
      "notice.fill",
    ]);
    expect(ruleNotices(test)[5]).toMatchObject({ values: { name: "BNB breakout", count: "2" } });
  });
});
