import type { Clock } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { AlertFiring } from "../alerts/fire-alerts.js";
import type { CardTimerParts } from "../confirmations/card-timer.js";
import type { CopyOrders } from "../orders/copy-orders.js";
import type { OrderParts } from "../orders/create-order.js";
import type { DcaOrders } from "../orders/dca-orders.js";
import type { EngineStores } from "../records/engine-stores.js";
import type { ScheduleQueue } from "../schedules/run-schedules.js";
import type { WebhookFills } from "../webhooks/webhook-fills.js";
import type { WebhookRuleParts } from "../webhooks/webhook-rule-parts.js";
import { timedWorkOf } from "./engine-timers.js";

const failingCards: CardTimerParts = {
  intents: {
    list: async () => Promise.reject(new Error("The intent store is down.")),
    cards: async () => Promise.resolve([]),
  },
  now: () => 0,
  expire: async () => Promise.resolve(),
};

describe("the engine's timed work", () => {
  it("expires the launch drafts even when the card timer throws", async () => {
    const expired: number[] = [];
    const work = timedWorkOf({
      intents: {
        orders: {} as OrderParts,
        rules: {} as WebhookRuleParts,
        cardTimer: failingCards,
        dca: {} as DcaOrders,
        copies: {} as CopyOrders,
        ruleFills: {} as WebhookFills,
      },
      chat: { alerts: {} as AlertFiring, schedules: {} as ScheduleQueue },
      drafts: { expire: () => (expired.push(1), undefined) },
      clock: {} as Clock,
      stores: {} as Pick<EngineStores, "webhookAlerts" | "inbox">,
    });
    const signal = new AbortController().signal;
    await expect(work.expireCards({ signal })).rejects.toThrow("The intent store is down.");
    expect(expired).toStrictEqual([1]);
  });
});
