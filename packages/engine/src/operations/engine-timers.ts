import type { Clock } from "@binference/core";
import type { AlertFiring } from "../alerts/fire-alerts.js";
import { type CardTimerParts, expireDueCards } from "../confirmations/card-timer.js";
import type { LaunchDraftDesk } from "../launches/launch-draft-desk.js";
import type { CopyOrders } from "../orders/copy-orders.js";
import type { OrderParts } from "../orders/create-order.js";
import type { DcaOrders } from "../orders/dca-orders.js";
import { tickOrders } from "../orders/tick-orders.js";
import type { ScheduleQueue } from "../schedules/run-schedules.js";
import type { Engine } from "./create-engine.js";

/**
 * The schedule queue's run: the schedules whose time came, then the DCA orders' periods, all
 * judged at the instant the run began. The DCA orders run even when the schedules failed; the
 * first failure is thrown once both ran.
 */
async function runQueue(
  parts: { readonly schedules: ScheduleQueue; readonly dca: DcaOrders; readonly clock: Clock },
  signal: AbortSignal,
): Promise<void> {
  const atMs = parts.clock.now();
  const [schedules, dca] = await Promise.allSettled([
    parts.schedules.run({ signal }),
    parts.dca.run({ signal, atMs }),
  ]);
  if (schedules.status === "rejected") {
    throw schedules.reason;
  }
  if (dca.status === "rejected") {
    throw dca.reason;
  }
}

/**
 * The work that waits for no price: the orders' tick, then the alerts whose expiry came, then the
 * matches the alerts' ended notice hours held back.
 */
async function tickAll(
  parts: { readonly orders: OrderParts; readonly alerts: AlertFiring },
  signal: AbortSignal,
): Promise<void> {
  await tickOrders(parts.orders, signal);
  await parts.alerts.expire({ signal });
  await parts.alerts.tellHeld({ signal });
}

/** What the timed work runs on: the intents' orders, cards and copies, and the chat's queues. */
interface TimedParts {
  readonly intents: {
    readonly orders: OrderParts;
    readonly cardTimer: CardTimerParts;
    readonly dca: DcaOrders;
    readonly copies: CopyOrders;
  };
  readonly chat: { readonly alerts: AlertFiring; readonly schedules: ScheduleQueue };
  readonly drafts: Pick<LaunchDraftDesk, "expire">;
  readonly clock: Clock;
}

/** The next time of two, either of which may be none. */
const sooner = (one: number | undefined, two: number | undefined): number | undefined =>
  one === undefined || two === undefined ? (one ?? two) : Math.min(one, two);

/**
 * The engine's work a timer of the composition root runs: the orders and alerts that wait for no
 * price, the cards and launch drafts whose time is up, the schedule queue and the copy orders'
 * leader trades.
 */
export function timedWorkOf(
  parts: TimedParts,
): Pick<Engine, "tickOrders" | "expireCards" | "runSchedules" | "runCopies"> {
  const { intents, chat, drafts, clock } = parts;
  return {
    tickOrders: async ({ signal }) =>
      tickAll({ orders: intents.orders, alerts: chat.alerts }, signal),
    // Drafts expire first, so a card timer that throws never keeps an ended draft's message open.
    expireCards: async ({ signal }) => {
      const nextDraft = drafts.expire();
      return sooner(await expireDueCards(intents.cardTimer, signal), nextDraft);
    },
    runSchedules: async ({ signal }) =>
      runQueue({ schedules: chat.schedules, dca: intents.dca, clock }, signal),
    runCopies: async (call) => intents.copies.run(call),
  };
}
