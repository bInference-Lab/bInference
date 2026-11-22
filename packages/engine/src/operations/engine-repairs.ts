import type { ChatRelay } from "../chat/chat-relay.js";
import type { DowntimeCheck } from "../downtime/downtime-check.js";
import type { StoredIntents } from "../intents/create-stored-intents.js";
import { endUnfinishedProposals } from "../money-path/end-unfinished-proposals.js";
import type { OrderParts } from "../orders/create-order.js";
import { repairDcaPeriods } from "../orders/dca-repair.js";
import type { OrderFills } from "../orders/fill-orders.js";
import { repairOrderFills } from "../orders/repair-order-fills.js";
import type { ResumeFence } from "../orders/resume-fence.js";
import type { PaperParts } from "../paper/paper-parts.js";
import { createPaperStart } from "../paper/paper-start.js";
import { repairPaperFills } from "../paper/repair-paper-fills.js";
import type { ShellPart } from "../shell/engine-shell.js";
import { repairRuleFills } from "../webhooks/repair-rule-fills.js";
import type { WebhookRuleParts } from "../webhooks/webhook-rule-parts.js";
import type { Engine, EngineOptions } from "./create-engine.js";
import { breakerWorkOf } from "./engine-breaker.js";
import { downtimeOf } from "./engine-downtime.js";

/** The startup's repair of paper fills a crash left without positions. */
function paperRepairOf(
  options: EngineOptions,
  parts: { readonly stored: StoredIntents; readonly paper: PaperParts },
): Engine["repairPaperFills"] {
  const repair = {
    intents: options.stores.intents,
    stored: parts.stored,
    store: options.positions,
    positions: parts.paper.positions,
    clock: options.clock,
    unbondings: options.stores.unbondings,
  };
  return async (call) => repairPaperFills(repair, call);
}

/**
 * The startup's repair of the order fills a stop left (decision 0197), of the webhook rule fills
 * (decision 0338), then of the DCA periods a stop cut off between keeping them and their buy
 * (decision 0246). A copy order's take a stop cut off is ended by the copy runner, by its rows
 * (decision 0260).
 */
function orderRepairOf(
  options: EngineOptions,
  parts: {
    readonly stored: StoredIntents;
    readonly fills: OrderFills;
    /** The downtime re-check, whose one report tells a resume's skips. */
    readonly fence: ResumeFence;
  },
): Engine["repairOrderFills"] {
  const { stores, clock, ids, publish, chains } = options;
  const { stored, fills, fence } = parts;
  return async (call) => {
    const repaired = await repairOrderFills(
      { stored, orders: stores.orders, clock, ids, publish, fence },
      call,
    );
    const dca = { orders: stores.orders, fills, intents: stores.intents, chains, clock };
    const rules = { stored, rules: stores.webhookRules, clock, publish };
    const ruleFills = await repairRuleFills(rules, call);
    return repaired + ruleFills + (await repairDcaPeriods(dca, call));
  };
}

/**
 * The engine's work the startup runs first, the repairs of what a stop left with the commands it
 * lost and the proposals it left before their cards (decision 0444), the downtime re-check after
 * each stop and sleep (decision 0266), and the paper start of each agent that never had a paper
 * portfolio (decision 0450).
 */
export function startupWorkOf(
  options: EngineOptions,
  parts: {
    readonly stored: StoredIntents;
    readonly fills: OrderFills;
    /** The auto orders and webhook rules whose cards the start's end of proposals ends. */
    readonly orders: OrderParts;
    readonly rules: WebhookRuleParts;
    readonly paper: PaperParts;
    readonly check: DowntimeCheck;
    readonly relay: Pick<ChatRelay, "reportResume" | "stopHeld">;
    /** The agent's shell, which tells each agent of a command the stop lost (decision 0409). */
    readonly shell: Pick<ShellPart, "tellLost">;
  },
): Pick<
  Engine,
  | "repairPaperFills"
  | "repairOrderFills"
  | "endUnfinishedProposals"
  | "tellLostShellJobs"
  | "downtime"
  | "followBreaker"
  | "startPaper"
> {
  const { stored, fills, paper, check, relay, shell, orders, rules } = parts;
  return {
    ...breakerWorkOf(options, { stored, relay }),
    tellLostShellJobs: async (call) => shell.tellLost(call),
    repairPaperFills: paperRepairOf(options, { stored, paper }),
    repairOrderFills: orderRepairOf(options, { stored, fills, fence: check }),
    endUnfinishedProposals: async (call) =>
      endUnfinishedProposals({ stored, clock: options.clock, orders, rules }, call),
    downtime: downtimeOf(options, { check, relay }),
    startPaper: createPaperStart({
      ...options.stores,
      positions: options.positions,
      portfolio: paper.portfolio,
      wallets: options.wallets,
    }),
  };
}
