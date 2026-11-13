import type { Id } from "@binference/core";
import { BinferenceError } from "@binference/core";
import { z } from "zod";
import type { CapGate } from "../confirmations/cap-gate.js";
import type { InboxEntry } from "../ingress/inbox-entry.js";
import type { InboxStore } from "../ingress/ports.js";
import type { StoredIntents } from "../intents/create-stored-intents.js";
import type { MoneyPath } from "../money-path/create-money-path.js";
import type { FillCheckParts } from "../orders/fill-check.js";
import type { FillSizeParts } from "../orders/fill-request.js";
import type { AgentStore, IntentStore } from "../ports.js";
import { isLeaseLost } from "../records/lease-lost.js";
import type { AlertFillRecord } from "./alert-fill-record.js";
import { type AlertEndParts, announceAlerts, endAlertSkipped } from "./end-alert.js";
import { fillAlert, isLeftToItsFill } from "./fill-alert.js";
import { webhookInboxPrefix } from "./webhook-alert.js";
import type { WebhookRuleRecord } from "./webhook-rule-record.js";

/** The accepted alerts the webhook rules fill: the listener stores them, a timer runs this. */
export interface WebhookFills {
  /**
   * Tells the notices a stop left untold, then fills or skips each accepted alert the inbox
   * holds, oldest first, and marks each handled once its end is written.
   */
  run(call: { readonly signal: AbortSignal }): Promise<void>;
}

/** What the rule fills read, run and write through. */
export interface WebhookFillParts extends FillSizeParts, FillCheckParts, AlertEndParts {
  readonly inbox: Pick<InboxStore, "unhandled" | "markHandled">;
  readonly agents: Pick<AgentStore, "get">;
  /**
   * Each rule card's confirmation, which a fill's terms hash binds, and the live fills that hold
   * an agent's line (decision 0342).
   */
  readonly intents: Pick<IntentStore, "confirmation" | "fillsInFlight" | "get">;
  readonly stored: StoredIntents;
  readonly moneyPath: MoneyPath;
  /** The rolling cap, whose use a skip for it tells. */
  readonly gate: Pick<CapGate, "spent">;
  /** Whether the engine is locked: a locked engine fills no alert (decision 0336). */
  readonly isLocked: () => boolean;
  /** Whether a live rule's alert may fill; off, each is skipped `live_fills_off` (decision 0342). */
  readonly liveFills: boolean;
  /** Runs one fill in its agent's one line of fills, which the auto orders' fills share. */
  readonly inLine: <T>(agent: Id<"agt">, run: () => Promise<T>) => Promise<T>;
}

// The inbox entry of an accepted alert, as the listener stored it: its rule and its row.
const payloadSchema = z.looseObject({ rule: z.string(), event: z.int().positive() });

// The alerts one run takes from the inbox; the next second's run takes the rest.
const pageSize = 20;

/** An inbox entry of an accepted alert, with its alert and rule, or whether its read failed. */
interface TakenEntry {
  readonly entry: InboxEntry;
  readonly alert?: AlertFillRecord;
  readonly rule?: WebhookRuleRecord;
  readonly isUnread?: true;
}

// The entry's alert and its rule; an entry pruned, unreadable or ended has neither.
async function readEntry(
  parts: WebhookFillParts,
  entry: InboxEntry,
  signal: AbortSignal,
): Promise<TakenEntry> {
  const payload = payloadSchema.safeParse(entry.payload);
  const alert = payload.success
    ? await parts.rules.alert(payload.data.event, { signal })
    : undefined;
  if (alert === undefined || alert.outcome !== undefined) {
    return { entry };
  }
  const rule = await parts.rules.get(alert.ruleId, { signal });
  return rule === undefined ? { entry, alert } : { entry, alert, rule };
}

// The alerts of a run, each agent's apart in the order they arrived; those with no rule apart.
function byAgent(taken: readonly TakenEntry[]): readonly (readonly TakenEntry[])[] {
  const lines = new Map<string, readonly TakenEntry[]>();
  taken.forEach((item) => {
    const key = item.rule?.agentId ?? "";
    lines.set(key, [...(lines.get(key) ?? []), item]);
  });
  return [...lines.values()];
}

// How many runs an entry may fail before its alert ends `fill_failed` and the queue moves on.
const entryTries = 3;

// How many agents' alerts fill at once: one slow agent holds only its own line (decision 0338).
const agentsAtOnce = 4;

// Ends `fill_failed` the alert of an entry whose reads failed, by the row its payload names, in one
// write that reads nothing: the store keeps an alert that ended, or that its own live fill holds,
// as it stands. Only an entry whose payload parsed reaches a read that can fail.
async function endUnread(
  parts: WebhookFillParts,
  entry: InboxEntry,
  signal: AbortSignal,
): Promise<void> {
  const { event } = payloadSchema.parse(entry.payload);
  await parts.rules.endAlert({ event, outcome: "skipped", reason: "fill_failed" }, { signal });
}

/** What a run keeps of the entries that failed, and how it ends them. */
interface EntryFailures {
  /** Marks an entry handled, and forgets its failures. */
  handled(entry: InboxEntry, signal: AbortSignal): Promise<void>;
  /**
   * Counts a failed run of an entry; its last ends its alert `fill_failed`, unless its own live
   * fill holds it, and handles it.
   */
  failed(taken: TakenEntry, signal: AbortSignal): Promise<void>;
}

// How many runs each entry failed, by its id; an entry is forgotten once it is handled, and the
// counts stay within a few pages: an entry no later page holds is counted no more.
function createEntryFailures(parts: WebhookFillParts): EntryFailures {
  const counts = new Map<number, number>();
  const handled = async (entry: InboxEntry, signal: AbortSignal): Promise<void> => {
    counts.delete(entry.id);
    await parts.inbox.markHandled({ id: entry.id, atMs: parts.clock.now() }, { signal });
  };
  return {
    handled,
    async failed({ entry, alert, rule }, signal) {
      if (counts.size > pageSize * entryTries) {
        counts.clear();
      }
      const count = (counts.get(entry.id) ?? 0) + 1;
      if (count < entryTries) {
        counts.set(entry.id, count);
        return;
      }
      if (alert === undefined) {
        await endUnread(parts, entry, signal);
      } else if (!(await isLeftToItsFill(parts, { rule, alert, signal }))) {
        // An alert its own live fill holds is the executor's to end (decision 0342).
        const skip = { event: alert.event, reason: "fill_failed" as const, tells: true };
        await endAlertSkipped(parts, { ruleId: alert.ruleId, skip, signal });
      }
      await handled(entry, signal);
    },
  };
}

// Runs each agent's alerts one after another, oldest first, up to four agents at once.
async function eachLine(
  lines: readonly (readonly TakenEntry[])[],
  settle: (taken: TakenEntry) => Promise<void>,
): Promise<void> {
  const waiting = [...lines];
  const worker = async (): Promise<void> => {
    const line = waiting.shift();
    if (line === undefined) {
      return;
    }
    await line.reduce<Promise<void>>(async (done, item) => {
      await done;
      await settle(item);
    }, Promise.resolve());
    await worker();
  };
  await Promise.all(Array.from({ length: Math.min(agentsAtOnce, waiting.length) }, worker));
}

/** What a run's lines came to: how many entries threw, and the lost lease when one was. */
interface LinesOutcome {
  readonly faults: number;
  readonly lost?: BinferenceError;
}

// Fills each agent's line of the taken entries. A lost lease is no failure of an entry: it counts
// nothing, no entry starts after it, and the lines under way settle before the run throws it
// (decision 0436).
async function fillLines(
  run: {
    readonly parts: WebhookFillParts;
    readonly failures: EntryFailures;
    readonly signal: AbortSignal;
  },
  taken: readonly TakenEntry[],
): Promise<LinesOutcome> {
  const { parts, failures, signal } = run;
  const outcome: { faults: number; lost?: BinferenceError } = { faults: 0 };
  await eachLine(byAgent(taken), async (item) => {
    if (outcome.lost !== undefined) {
      return;
    }
    try {
      if (item.isUnread !== true) {
        await fillAlert(parts, item, signal);
        await failures.handled(item.entry, signal);
        return;
      }
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      if (isLeaseLost(error)) {
        outcome.lost = error;
        return;
      }
      outcome.faults += 1;
    }
    await failures.failed(item, signal);
  });
  return outcome;
}

/**
 * Creates the {@link WebhookFills} (decisions 0336 to 0338): each accepted alert of an active
 * rule is a fill authorized by the rule, `{ webhookRule, event }`, sized from the rule's bounds and
 * held to them on the money path in the agent's line of fills, with the rolling cap, on paper. One
 * that cannot start within a minute of its arrival is skipped as `late`, and an alert its rule's old
 * URL took as `url_rotated`; each alert ends once, filled or skipped, and its inbox entry is then
 * handled. A run tells first the notices a stop left untold, then fills each agent's alerts in the
 * order they arrived, up to four agents at once. An entry that throws is left for the next run;
 * after its third failure its alert ends `fill_failed` and it is handled, so it never holds the
 * alerts behind it. A run whose entries threw rejects with the first fault once the rest settled;
 * one that met a lost lease starts no entry after it and rejects with it (decision 0436).
 */
export function createWebhookFills(parts: WebhookFillParts): WebhookFills {
  const failures = createEntryFailures(parts);
  return {
    async run({ signal }) {
      await announceAlerts(parts, await parts.rules.unannounced(pageSize, { signal }), signal);
      const page = { keyPrefix: webhookInboxPrefix, limit: pageSize };
      const entries = await parts.inbox.unhandled(page, { signal });
      // How many entries threw: the run rejects once the rest settled. A stop's abort ends it at once.
      let faults = 0;
      const taken = await Promise.all(
        entries.map(async (entry): Promise<TakenEntry> => {
          try {
            return await readEntry(parts, entry, signal);
          } catch (error) {
            if (signal.aborted) {
              throw error;
            }
            faults += 1;
            return { entry, isUnread: true };
          }
        }),
      );
      const lines = await fillLines({ parts, failures, signal }, taken);
      if (lines.lost !== undefined) {
        throw lines.lost;
      }
      faults += lines.faults;
      if (faults > 0) {
        throw new BinferenceError({
          code: "engine.webhook_alert_failed",
          message: `${String(faults)} webhook alerts failed to fill and wait for the next run.`,
          details: { count: String(faults) },
        });
      }
    },
  };
}
