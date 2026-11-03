import { BinferenceError, bpsSchema, idSchema, type Result } from "@binference/core";
import { createWebhookIntake } from "@binference/engine/orders";
import { protocolIdSchema } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createSystemClock } from "../runtime/system-clock.js";
import { agent, buyIn, onFork, type Rig } from "./executor-rig.js";
import { balanceOf, reach } from "./rig-actions.js";

const caller = {
  credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000043",
  client: { kind: "cli", version: "fork" },
  scopes: ["read", "propose", "confirm", "admin"],
} as const;

const urlPattern = /\/hook\/(whr_[^/]+)\/([\w-]{43})$/u;

// The value of a handler's answer; one that failed stops the test with its code.
function valueOf<T>(answer: Result<T, string>): T {
  if (!answer.ok) {
    throw new BinferenceError({ code: "fork.refused", message: `Refused: ${answer.error}.` });
  }
  return answer.value;
}

// The rule id and secret a rule's URL ends with.
function routeOf(url: string): { readonly ruleId: string; readonly secret: string } {
  const [, ruleId, secret] = urlPattern.exec(url) ?? [];
  if (ruleId === undefined || secret === undefined) {
    throw new BinferenceError({ code: "fork.no_route", message: `Not a rule URL: ${url}.` });
  }
  return { ruleId, secret };
}

// The owner makes a live rule that buys USDT with 0.01 BNB on each alert, once, at most 1%
// slippage, and confirms its card, as from the CLI; answers its id and URL.
async function confirmedRule(rig: Rig, signal: AbortSignal) {
  const { handlers } = rig.engine;
  const request = {
    agent,
    name: "USDT on each alert",
    token: rig.bought,
    side: "buy",
    spend: rig.native,
    size: { base: buyIn },
    maxSlippageBps: bpsSchema.parse(100),
    maxFills: 1,
    ratePerMinute: 5,
  } as const;
  const created = valueOf(await handlers["webhookRule/create"]({ args: request, caller, signal }));
  const rule = idSchema("whr").parse(created.rule);
  const stored = await rig.stores.webhookRules.get(rule, { signal });
  const intent = protocolIdSchema("intent").parse(stored?.intentId);
  const card = valueOf(await handlers["intent/card"]({ args: { intent }, caller, signal }));
  const args = { intent, card: card.card, cardVersion: card.version };
  valueOf(await handlers["intent/confirm"]({ args, caller, signal }));
  return { rule, url: created.url };
}

describe("a live webhook rule on the BSC fork", () => {
  it("fills an alert inside its bounds, under its rule's grant, and counts it on its rule", async ({
    signal,
  }) => {
    await onFork(signal, { liveOrderFills: true }, async (rig, fork) => {
      const before = await balanceOf(fork);
      const { rule, url } = await confirmedRule(rig, signal);
      const intake = createWebhookIntake({
        store: rig.stores.webhookAlerts,
        clock: createSystemClock(),
        isLocked: () => false,
      });
      const body = new TextEncoder().encode("USDT up");
      expect(await intake.take({ ...routeOf(url), body }, { signal })).toBe("accepted");

      await rig.engine.fillWebhookAlerts({ signal });
      const [alert] = await rig.stores.webhookRules.alerts({ ruleId: rule, limit: 5 }, { signal });
      const states = ["confirmed", "executing", "included", "finalized", "reconciled"] as const;
      const fills = await rig.stores.intents.list({ states: [...states], limit: 5 }, { signal });
      const id = idSchema("int").parse(fills.find(({ kind }) => kind === "buy")?.id);
      await expect(reach(rig, id, "reconciled")).resolves.toBe("reconciled");

      const [ended] = await rig.stores.webhookRules.alerts({ ruleId: rule, limit: 5 }, { signal });
      const record = await rig.stores.intents.get(id, { signal });
      expect(alert?.outcome).toBeUndefined();
      expect(ended).toMatchObject({ outcome: "filled", intentId: id });
      expect(await rig.stores.webhookRules.get(rule, { signal })).toMatchObject({
        fills: 1,
        state: "deleted",
      });
      expect(await balanceOf(fork)).toBeGreaterThan(before);
      expect(rig.custody.signatures()).toBe(1);
      expect(record?.authorizedBy).toMatchObject({
        webhookRule: rule,
        event: alert?.event,
        fillsBefore: 0,
      });
    });
  });
});
