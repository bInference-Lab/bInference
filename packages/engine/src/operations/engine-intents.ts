import { createCapGate } from "../confirmations/cap-gate.js";
import type { CardTimerParts } from "../confirmations/card-timer.js";
import { createConfirmations } from "../confirmations/create-confirmations.js";
import { type DowntimeCheck } from "../downtime/downtime-check.js";
import { createLowGasAlerts, type LowGasAlerts } from "../gas/low-gas-alerts.js";
import type { StoredIntents } from "../intents/create-stored-intents.js";
import type { LaunchingMoneyPath } from "../money-path/launching-money-path.js";
import { createVenueQuoteSource } from "../money-path/venue-quote-source.js";
import type { CopyOrders } from "../orders/copy-orders.js";
import type { OrderParts } from "../orders/create-order.js";
import { createDcaOrders, type DcaOrders } from "../orders/dca-orders.js";
import type { OrderFills } from "../orders/fill-orders.js";
import { createOrderHandlers, type OrderHandlers } from "../orders/order-handlers.js";
import { createOrderTriggers, type OrderTriggers } from "../orders/order-triggers.js";
import { type PaperParts } from "../paper/paper-parts.js";
import { createCardShowings } from "../surfaces/create-card-showings.js";
import type { WebhookFills } from "../webhooks/webhook-fills.js";
import type { WebhookRuleHandlers } from "../webhooks/webhook-rule-handlers.js";
import type { WebhookRuleParts } from "../webhooks/webhook-rule-parts.js";
import { type AnswerCard, createAnswerCard } from "./answer-card.js";
import type { Engine, EngineOptions } from "./create-engine.js";
import {
  executeOf,
  launchRoutingOf,
  requoteOptions,
  storedIntentsOf,
} from "./engine-intent-parts.js";
import { moneyPathOf } from "./engine-money-path.js";
import { cardTimerOf, copyOrdersOf, orderFillsOf, orderPartsOf } from "./engine-orders.js";
import { webhookFillsOf, webhookRulesOf } from "./engine-webhook-rules.js";
import { createIntentHandlers, type IntentHandlers } from "./intent-handlers.js";

/** The intent and order parts of the engine. */
export interface IntentParts {
  readonly handlers: IntentHandlers & OrderHandlers & WebhookRuleHandlers;
  readonly answer: AnswerCard;
  readonly stored: StoredIntents;
  readonly orders: OrderParts;
  readonly rules: WebhookRuleParts;
  readonly fills: OrderFills;
  readonly triggers: OrderTriggers;
  /** The DCA orders' periods, which the schedule queue's timer runs (decision 0246). */
  readonly dca: DcaOrders;
  /** The copy orders' leader trades, which the copy timer runs (decision 0260). */
  readonly copies: CopyOrders;
  /** The webhook rules' fills, which their timer runs (decision 0338). */
  readonly ruleFills: WebhookFills;
  /** One alert for the money path and the gas check, so each drop is announced once. */
  readonly lowGas: LowGasAlerts;
  readonly cardTimer: CardTimerParts;
  readonly moneyPath: LaunchingMoneyPath;
}

/**
 * Wires the engine's intents and orders: the one writer of intents, the confirmations, the money
 * path, the execute step, the orders, the webhook rules and their fills, and the handlers they
 * answer.
 */
export function intentParts(
  options: EngineOptions,
  paper: PaperParts,
  parts: { readonly settled: Engine["pushSettled"]; readonly check: DowntimeCheck },
): IntentParts {
  const { settled, check } = parts;
  const { stores, host, chains, clock, isLocked, destinations } = options;
  const gate = createCapGate({ intents: stores.intents, clock });
  const stored = storedIntentsOf(options, { settled, gate });
  const confirmations = createConfirmations({
    clock,
    store: stored,
    quotes: createVenueQuoteSource(requoteOptions(options, { stored, paper })),
    simulator: paper.simulator,
  });
  const launches = launchRoutingOf(options, paper);
  const orders = orderPartsOf(options, { stored, confirmations, wallets: paper.wallets, launches });
  const { parts: rules, handlers: ruleHandlers } = webhookRulesOf(options, orders);
  const execute = executeOf(options, { stored, paper, orders, rules });
  const lowGas = createLowGasAlerts({ publish: options.publish });
  const answer = createAnswerCard({ confirmations, stored, execute, isLocked, gate });
  const showings = createCardShowings({ ...stores, chains, destinations, venues: host, isLocked });
  const moneyPath = moneyPathOf(options, { stored, paper, launches, execute, lowGas, gate });
  const handlers = {
    ...createIntentHandlers({ ...options, ...stores, stored, moneyPath, answer, showings }),
    ...createOrderHandlers(orders),
    ...ruleHandlers,
  };
  const cardTimer = cardTimerOf(options, { confirmations, orders, rules });
  const fillParts = { stored, moneyPath, gate, holdings: paper.holdings, fence: check };
  const fills = orderFillsOf(options, fillParts);
  const triggers = createOrderTriggers({ orders: stores.orders, fills, clock, fence: check });
  const dca = createDcaOrders({
    orders: stores.orders,
    fills,
    chains,
    intents: stores.intents,
    clock,
    publish: options.publish,
  });
  const copies = copyOrdersOf(options, fills);
  const ruleFills = webhookFillsOf(options, { ...fillParts, fills });
  const timed = { triggers, dca, copies, ruleFills };
  return { answer, stored, orders, rules, fills, ...timed, handlers, lowGas, cardTimer, moneyPath };
}
