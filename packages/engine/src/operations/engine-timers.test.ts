import type { Clock } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { AlertFiring } from "../alerts/fire-alerts.js";
import type { CardTimerParts } from "../confirmations/card-timer.js";
import { fixtureId } from "../contracts/store-fixtures.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { testAgent, testWallet } from "../intents/test-intents.js";
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

// A card timer whose one waiting card's time is up at `expiresAtMs`, or none waits.
function cardsDueAt(expiresAtMs: number | undefined): CardTimerParts {
  const waiting: IntentRecord = {
    id: fixtureId("int", 1),
    agentId: testAgent,
    walletId: testWallet,
    kind: "swap",
    state: "awaiting_confirmation",
    request: {},
    hasOutsideContent: false,
    isPaper: false,
    proposer: "telegram",
    createdAtMs: 0,
    changedAtMs: 0,
    version: 1,
  };
  return {
    intents: {
      list: async () => Promise.resolve(expiresAtMs === undefined ? [] : [waiting]),
      cards: async () => Promise.resolve([{ expiresAtMs }] as never),
    },
    now: () => 0,
    expire: async () => Promise.resolve(),
  };
}

// The timed work over the parts a test names; any other part is never called.
function workOf(parts: {
  readonly cardTimer?: CardTimerParts;
  readonly nextDraft?: number | undefined;
  readonly schedules?: ScheduleQueue;
  readonly dca?: DcaOrders;
}) {
  return timedWorkOf({
    intents: {
      orders: {} as OrderParts,
      rules: {} as WebhookRuleParts,
      cardTimer: parts.cardTimer ?? cardsDueAt(undefined),
      dca: parts.dca ?? ({} as DcaOrders),
      copies: {} as CopyOrders,
      ruleFills: {} as WebhookFills,
    },
    chat: { alerts: {} as AlertFiring, schedules: parts.schedules ?? ({} as ScheduleQueue) },
    drafts: { expire: () => parts.nextDraft },
    clock: { now: () => 0 } as Clock,
    stores: {} as Pick<EngineStores, "webhookAlerts" | "inbox" | "credentials">,
  });
}

const live = { signal: new AbortController().signal };
const ran = async (): Promise<void> => Promise.resolve();
const fails = (message: string) => async (): Promise<void> => Promise.reject(new Error(message));

describe("the engine's timed work", () => {
  it.each<{
    readonly name: string;
    readonly card: number | undefined;
    readonly draft: number | undefined;
    readonly next: number | undefined;
  }>([
    { name: "a draft before the card", card: 500, draft: 300, next: 300 },
    { name: "the card before a draft", card: 200, draft: 300, next: 200 },
    { name: "a card and no draft", card: 500, draft: undefined, next: 500 },
    { name: "a draft and no card", card: undefined, draft: 300, next: 300 },
    { name: "neither", card: undefined, draft: undefined, next: undefined },
  ])("answers when the next card or draft is due: $name", async ({ card, draft, next }) => {
    const work = workOf({ cardTimer: cardsDueAt(card), nextDraft: draft });
    await expect(work.expireCards(live)).resolves.toBe(next);
  });

  it("runs the DCA orders even when the schedules fail, then throws the schedules' fault", async () => {
    const dcaRuns: number[] = [];
    const work = workOf({
      schedules: { run: fails("The schedules failed.") },
      dca: {
        run: async () => {
          dcaRuns.push(1);
          await ran();
        },
      },
    });
    await expect(work.runSchedules(live)).rejects.toThrow("The schedules failed.");
    expect(dcaRuns).toStrictEqual([1]);
  });

  it("throws the DCA orders' fault once the schedules ran", async () => {
    const work = workOf({
      schedules: { run: ran },
      dca: { run: fails("The DCA orders failed.") },
    });
    await expect(work.runSchedules(live)).rejects.toThrow("The DCA orders failed.");
  });

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
      stores: {} as Pick<EngineStores, "webhookAlerts" | "inbox" | "credentials">,
    });
    const signal = new AbortController().signal;
    await expect(work.expireCards({ signal })).rejects.toThrow("The intent store is down.");
    expect(expired).toStrictEqual([1]);
  });
});
