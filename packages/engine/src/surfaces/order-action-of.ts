import type { AgentSettings } from "../agents/agent-record.js";
import type { CardAction } from "../confirmations/card-action.js";
import type { AutoOrderQuote } from "../orders/auto-order-quote.js";
import { firstRunsOf } from "../orders/dca-period.js";

/**
 * An auto order's action line, as its card and its receipt draw it: its terms with every default
 * filled, a DCA order's first two runs (decision 0246), and a copy order's leader's label in the
 * agent's address book (decision 0261). `undefined` for a DCA order whose schedule has no runs
 * left, which no card can draw.
 */
export function orderActionOf(
  quote: AutoOrderQuote,
  settings: Pick<AgentSettings, "addressBook">,
): CardAction<"autoOrder"> | undefined {
  const { request, maxFills, expiresAtMs } = quote;
  const firstRuns = request.kind === "dca" ? firstRunsOf(request, quote.quotedAtMs) : undefined;
  if (request.kind === "dca" && firstRuns === undefined) {
    return undefined;
  }
  const leader = request.kind === "copy" ? request.trigger.leader : undefined;
  const entry = settings.addressBook.find(({ account }) => account === leader);
  return {
    kind: "autoOrder",
    request,
    ...(maxFills === undefined ? {} : { maxFills }),
    expiresAtMs,
    ...(firstRuns === undefined ? {} : { firstRunsAtMs: firstRuns }),
    ...(entry === undefined ? {} : { leaderLabel: entry.label }),
  };
}
