import { BinferenceError, type Clock, type IdSource } from "@binference/core";
import type { AgentRecord } from "../agents/agent-record.js";
import type {
  IntentSnapshot,
  StoredFreeze,
  StoredIntents,
} from "../intents/create-stored-intents.js";
import { createIntentStateMachine } from "../intents/state-machine.js";
import { type UnfreezeQuote, unfreezeQuoteDocument } from "../intents/unfreeze-quote.js";
import type { LedgerDraft } from "../ledger/ledger-entry.js";
import type { AgentStore, IntentStore } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";

/** The message key of the notice that announces an unfreeze (spec 4, section 4). */
export const unfrozenNoticeKey = "notice.unfrozen";

/** What a confirmed unfreeze is written through, and where its notice goes. */
export interface UnfreezeWriteParts {
  readonly stored: StoredIntents;
  readonly agents: AgentStore;
  readonly intents: IntentStore;
  readonly clock: Clock;
  readonly ids: IdSource;
  readonly publish: PublishPush;
}

/** Who tapped Confirm: the surface and the caller the confirmation records. */
interface Tapper {
  readonly by: string;
  readonly surface: string;
}

// A write another write beat is read and tried again; five rounds outlast any burst of moves.
const maxRounds = 5;

function quoteOf(snapshot: IntentSnapshot): UnfreezeQuote {
  const { quote, id } = snapshot.record;
  if (quote === undefined) {
    throw new BinferenceError({
      code: "engine.no_quote",
      message: `Confirmed unfreeze ${id} has no quote.`,
      details: { intent: id },
    });
  }
  return unfreezeQuoteDocument.decode(quote);
}

// An `unfreeze` entry about one agent, or about the whole install without one.
function unfreezeEntry(
  parts: UnfreezeWriteParts,
  agent: AgentRecord | undefined,
  stamp: { readonly atMs: number; readonly tapper: Tapper },
): LedgerDraft {
  const { atMs, tapper } = stamp;
  return {
    id: parts.ids.next("led"),
    atMs,
    ...(agent === undefined ? {} : { agentId: agent.id, subject: agent.id }),
    kind: "unfreeze",
    data: { by: tapper.by, surface: tapper.surface },
  };
}

// The write of one round: the agents the card named that are frozen still, the install for a
// whole-install unfreeze, the intent's move to `reconciled`, and an entry for each it unfreezes.
async function writeOf(
  parts: UnfreezeWriteParts,
  snapshot: IntentSnapshot,
  read: { readonly tapper: Tapper; readonly signal: AbortSignal },
): Promise<StoredFreeze> {
  const { tapper, signal } = read;
  const quote = quoteOf(snapshot);
  const named = new Set(quote.agents.map(({ agent }) => agent));
  const records = await parts.agents.list({ signal });
  const unfrozen = records.filter((agent) => named.has(agent.id) && agent.frozenAtMs !== undefined);
  const step = createIntentStateMachine(parts).apply(snapshot.stored.status, {
    type: "unfreeze_written",
  });
  if (!step.ok) {
    throw new BinferenceError({
      code: "engine.step_refused",
      message: `The state machine refused unfreeze_written on intent ${snapshot.record.id}.`,
      details: { intent: snapshot.record.id, problem: step.error },
    });
  }
  const atMs = parts.clock.now();
  const stamp = { atMs, tapper };
  const entries = unfrozen.map((agent) => unfreezeEntry(parts, agent, stamp));
  const move = { intent: snapshot.record.id, version: snapshot.stored.version, step: step.value };
  return {
    atMs,
    isFrozen: false,
    agents: unfrozen.map((agent) => ({ agentId: agent.id, expectedVersion: agent.version })),
    isWholeInstall: quote.isWholeInstall,
    moves: [{ ...move, by: tapper.by }],
    ledger: quote.isWholeInstall ? [...entries, unfreezeEntry(parts, undefined, stamp)] : entries,
  };
}

function announce(
  parts: UnfreezeWriteParts,
  snapshot: IntentSnapshot,
  done: { readonly quote: UnfreezeQuote; readonly tapper: Tapper },
): void {
  const { quote, tapper } = done;
  const [only] = quote.agents;
  const intent = snapshot.record.id;
  const notice =
    quote.isWholeInstall || only === undefined
      ? { key: unfrozenNoticeKey, intent, values: { scope: "install", surface: tapper.surface } }
      : {
          key: unfrozenNoticeKey,
          agent: only.agent,
          intent,
          values: { scope: "agent", agent: only.name, surface: tapper.surface },
        };
  parts.publish(noticePush(notice));
}

async function tapperOf(
  parts: UnfreezeWriteParts,
  snapshot: IntentSnapshot,
  signal: AbortSignal,
): Promise<Tapper> {
  const confirmation = await parts.intents.confirmation(snapshot.record.id, { signal });
  return confirmation === undefined
    ? { by: "engine", surface: "engine" }
    : { by: confirmation.byRef, surface: confirmation.bySurface };
}

async function writeFrom(
  parts: UnfreezeWriteParts,
  snapshot: IntentSnapshot,
  at: { readonly round: number; readonly signal: AbortSignal },
): Promise<IntentSnapshot> {
  const { signal } = at;
  const tapper = await tapperOf(parts, snapshot, signal);
  const write = await writeOf(parts, snapshot, { tapper, signal });
  const commit = await parts.stored.freeze(write, { signal });
  const after = (await parts.stored.snapshot(snapshot.record.id, { signal })) ?? snapshot;
  if (commit.ok) {
    announce(parts, after, { quote: quoteOf(snapshot), tapper });
    return after;
  }
  if (after.record.state !== "confirmed") {
    return after;
  }
  if (at.round >= maxRounds) {
    throw new BinferenceError({
      code: "engine.unfreeze_contended",
      message: `Other writes moved the rows an unfreeze read ${String(maxRounds)} times in a row.`,
      retryable: true,
    });
  }
  return writeFrom(parts, after, { ...at, round: at.round + 1 });
}

/**
 * Writes a confirmed unfreeze (decision 0128) in one write: the agents its card named that are
 * frozen still are unfrozen, the install's freeze is cleared for a whole-install unfreeze, the
 * intent moves to `reconciled`, and an `unfreeze` ledger entry is appended for each agent and for
 * the install. `notice.unfrozen` then goes out on every surface, naming the surface that tapped
 * Confirm. A write another write beat is read and tried again; an unfreeze another write moved
 * out of `confirmed`, such as a freeze that cancelled it, is left as that write left it.
 */
export async function writeUnfreeze(
  parts: UnfreezeWriteParts,
  snapshot: IntentSnapshot,
  signal: AbortSignal,
): Promise<IntentSnapshot> {
  if (snapshot.record.kind !== "unfreeze" || snapshot.record.state !== "confirmed") {
    return snapshot;
  }
  return writeFrom(parts, snapshot, { round: 1, signal });
}
