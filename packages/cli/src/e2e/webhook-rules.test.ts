import { testAgent as agent, testNowMs, testToken as token } from "@binference/engine/testing";
import type { ProtocolId } from "@binference/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { skeletonCompositions } from "../compose/test-skeleton.js";
import { type AlertPoster, listenForAlerts } from "./alert-poster.js";
import { type ServedSkeleton, serveSkeleton } from "./skeleton-machine.js";
import { createTestMachines } from "./test-host.js";

const slow = { timeout: 60_000 };
const machines = createTestMachines();
const served: ServedSkeleton[] = [];
const listeners: AlertPoster[] = [];
const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(10_000) });

afterEach(async () => {
  await Promise.all(listeners.splice(0).map(async (listener) => listener.close()));
  await Promise.all(served.splice(0).map(async (skeleton) => skeleton.close()));
  await machines.removeAll();
});

// A rule that buys the test token with a small amount of the chain's coin on each alert.
const rule = {
  agent,
  name: "BNB breakout",
  token,
  side: "buy",
  size: { base: 10n ** 15n },
  ratePerMinute: 5,
} as const;

// Starts the webhook listener on a free loopback port, over the skeleton's own stores.
async function listenerOn(skeleton: ServedSkeleton) {
  const listener = await listenForAlerts(skeleton);
  listeners.push(listener);
  return async (url: string, body: string): Promise<number> => listener.post(url, body);
}

// Confirms the newest version of an intent's card from the owner's CLI.
async function confirm(skeleton: ServedSkeleton, intent: ProtocolId<"intent">): Promise<void> {
  const card = await skeleton.client.call("intent/card", { intent }, live());
  await skeleton.client.call(
    "intent/confirm",
    { intent, card: card.card, cardVersion: card.version },
    live(),
  );
}

describe.each(skeletonCompositions)("webhook rules on the $name composition", (composition) => {
  it(
    "fills a confirmed rule's alert on paper once, refuses its replay, and 404s once deleted",
    slow,
    async () => {
      const machine = await machines.create(testNowMs);
      const skeleton = await serveSkeleton(machine, composition);
      served.push(skeleton);
      await skeleton.client.call("portfolio/resetPaper", { agent }, live());
      const post = await listenerOn(skeleton);
      const { engine } = skeleton.composed;

      const created = await skeleton.client.call("webhookRule/create", rule, live());
      expect(await post(created.url, "BNB up")).toBe(404);
      const [listed] = (await skeleton.client.call("webhookRule/list", {}, live())).items;
      const stored = await skeleton.parts.stores.webhookRules.get(created.rule, live());
      expect(listed?.state).toBe("awaiting_confirmation");
      await confirm(skeleton, stored?.intentId as ProtocolId<"intent">);

      expect(await post(created.url, "BNB up")).toBe(202);
      expect(await post(created.url, "BNB up")).toBe(409);
      await engine.fillWebhookAlerts(live());
      await engine.fillWebhookAlerts(live());
      const after = await skeleton.parts.stores.webhookRules.get(created.rule, live());
      expect(after?.fills).toBe(1);

      await skeleton.client.call("webhookRule/delete", { rule: created.rule }, live());
      expect(await post(created.url, "BNB down")).toBe(404);
      const [ended] = (await skeleton.client.call("webhookRule/list", {}, live())).items;
      expect(ended).toBeUndefined();
    },
  );
});
