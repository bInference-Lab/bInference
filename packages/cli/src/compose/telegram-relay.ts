import { BinferenceError, type Clock, type Id, idSchema, type Logger } from "@binference/core";
import type { EnginePush } from "@binference/engine";
import type { CardSettling, CardShowings, CardVersionRef } from "@binference/engine/surfaces";
import type { ChatReplies, NoticeOutbox, OutboxPass, TelegramCards } from "@binference/telegram";
import { z } from "zod";

/** The line that carries the engine's pushes to the owner's chat, in the order they came. */
export interface TelegramRelay {
  /**
   * Takes one engine push. A card version that opens is shown in the owner's chat, and one that
   * closes on another surface or by its timer becomes its receipt there, with the paper fill once
   * a paper intent records it, and every copy shows how a confirmed live intent ended on chain. A
   * stored notice sends the outbox's deliveries up to it, oldest first, once the relay started. A
   * push of an agent's chat topic shows the agent's reply. A failure is logged and never reaches
   * the engine; past 1,000 pushes waiting, a push is dropped and logged.
   */
  relay(push: EnginePush): void;
  /**
   * Starts sending notices: the deliveries left from before go out first, oldest first. A refused
   * one is tried again at its time; before the owner pairs, they wait for `paired`.
   */
  start(): void;
  /** Hears that the owner paired: the notices that waited go out. */
  paired(): void;
  /** Resolves once every push relayed so far reached Telegram, or failed and was logged. */
  idle(): Promise<void>;
  /** Stops the relay: aborts the Bot API calls in flight and waits for them to end. */
  close(): Promise<void>;
}

/** What the relay sends through. */
export interface TelegramRelayContext {
  readonly showings: CardShowings;
  readonly cards: TelegramCards;
  readonly outbox: NoticeOutbox;
  /** The agent's replies: its status messages, answers and status lines. */
  readonly chat: ChatReplies;
  /** Resolves once every notice published so far is stored. */
  readonly stored: () => Promise<void>;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * What the relay does for one push: show a card version, settle an intent's card, or send the
 * notices stored so far, up to one when it names it.
 */
type RelayWork =
  | { readonly kind: "show"; readonly ref: CardVersionRef }
  | { readonly kind: "settle"; readonly intent: Id<"int"> }
  | { readonly kind: "deliver"; readonly through?: Id<"ntc"> }
  | { readonly kind: "chat"; readonly push: EnginePush };

interface Call {
  readonly signal: AbortSignal;
}

/** The relay's context with the signal that stops it. */
interface RunContext extends TelegramRelayContext {
  readonly stop: AbortSignal;
}

const openedSchema: z.ZodType<CardVersionRef> = z.object({
  intent: idSchema("int"),
  card: idSchema("crd"),
});
const movedSchema = z.object({ intent: idSchema("int"), state: z.string().optional() });
const storedNoticeSchema = z.object({ id: idSchema("ntc") });
const deliverAll: RelayWork = { kind: "deliver" };
// The moves after which a confirmed card's receipt shows more: a paper fill, a live intent's end
// on chain or before it sent anything, and a send whose fate is not known yet (spec 4, 3.5).
const settlingStates: ReadonlySet<string> = new Set([
  "paper_filled",
  "reconciled",
  "failed_onchain",
  "unknown_after_send",
  "failed_check",
  "rejected_policy",
  "risk_blocked",
  "cancelled",
  "expired",
]);

// Pushes wait in one line, in order; past this many waiting, a push is dropped and logged, and
// the card stays on the other surfaces and the notice in the outbox.
const maxWaiting = 1_000;

// A push of an agent's chat topic shows the agent's reply; any other is a card's or a notice's.
function workOf(push: EnginePush): RelayWork | undefined {
  return push.topic.startsWith("chat:") ? { kind: "chat", push } : cardWorkOf(push);
}

// A closed card settles, and so does a confirmed one whose intent moved to a state its receipt
// shows.
function settles(kind: string, state: string | undefined): boolean {
  return kind === "card/closed" || (kind === "intent/changed" && settlingStates.has(state ?? ""));
}

// A card version that opens is shown. One that closes is settled, and so is a confirmed intent's
// card once the intent records its paper fill or ends on chain, which the receipt shows. A stored
// notice is delivered.
function cardWorkOf(push: EnginePush): RelayWork | undefined {
  if (push.kind === "notice/new") {
    const notice = storedNoticeSchema.safeParse(push.data);
    return notice.success ? { kind: "deliver", through: notice.data.id } : undefined;
  }
  if (push.kind === "card/opened") {
    const opened = openedSchema.safeParse(push.data);
    return opened.success ? { kind: "show", ref: opened.data } : undefined;
  }
  const moved = movedSchema.safeParse(push.data);
  return moved.success && settles(push.kind, moved.data.state)
    ? { kind: "settle", intent: moved.data.intent }
    : undefined;
}

// A Confirm or Cancel pressed in Telegram turns the pressed card into its receipt itself; how a
// live intent ended on chain comes later, so every copy shows it.
function isTelegramAnswer(settling: CardSettling): boolean {
  const { closing } = settling;
  const isAnswered = closing.outcome !== "expired" && closing.answeredBy.surface === "telegram";
  return isAnswered && settling.live === undefined;
}

async function show(context: TelegramRelayContext, ref: CardVersionRef, call: Call) {
  const showing = await context.showings.opened(ref, call);
  if (showing === undefined) {
    return;
  }
  const shown = await context.cards.show(showing, call);
  if (!shown.ok) {
    context.logger.info("telegram.card_not_shown", {
      intentId: ref.intent,
      errorCode: shown.error,
    });
  }
}

async function settle(context: TelegramRelayContext, intent: Id<"int">, call: Call) {
  const settling = await context.showings.settled(intent, call);
  if (settling !== undefined && !isTelegramAnswer(settling)) {
    await context.cards.settle(settling, call);
  }
}

// The ids a work's log lines name, never the text of a notice.
function errorEvent(work: RelayWork) {
  if (work.kind === "deliver") {
    return { event: "telegram.notice_relay_failed", fields: {} };
  }
  if (work.kind === "chat") {
    return { event: "telegram.chat_relay_failed", fields: {} };
  }
  const intentId = work.kind === "show" ? work.ref.intent : work.intent;
  return { event: "telegram.card_relay_failed", fields: { intentId } };
}

/** One line of work, in order, at most {@link maxWaiting} waiting. */
interface WorkLine {
  enqueue(work: RelayWork): void;
  idle(): Promise<void>;
}

function createWorkLine(run: (work: RelayWork) => Promise<void>, logger: Logger): WorkLine {
  let relayed: Promise<void> = Promise.resolve();
  let waiting = 0;
  return {
    enqueue(work) {
      if (waiting >= maxWaiting) {
        logger.warn("telegram.card_relay_full", errorEvent(work).fields);
        return;
      }
      waiting += 1;
      const before = relayed;
      relayed = (async () => {
        await before;
        await run(work);
        waiting -= 1;
      })();
    },
    idle: async () => relayed,
  };
}

// Arms one timer for the next pass of the outbox when the pass before left a delivery waiting for
// its time; any other pass, or a new wait, ends the old one.
function createPassTimer(clock: Clock, stop: AbortSignal, due: () => void) {
  let timer = new AbortController();
  return (pass: OutboxPass): void => {
    timer.abort();
    timer = new AbortController();
    if (pass.kind === "waiting") {
      const delayMs = Math.max(0, pass.atMs - clock.now());
      clock.sleep(delayMs, AbortSignal.any([stop, timer.signal])).then(due, () => undefined);
    }
  };
}

async function perform(
  context: RunContext,
  work: RelayWork,
  deliver: (work: Extract<RelayWork, { kind: "deliver" }>) => Promise<void>,
): Promise<void> {
  const call = { signal: context.stop };
  switch (work.kind) {
    case "deliver":
      return deliver(work);
    case "chat":
      return context.chat.show(work.push, call);
    case "show":
      return show(context, work.ref, call);
    case "settle":
      return settle(context, work.intent, call);
  }
}

/**
 * Creates the relay of the owner's chat: cards and notices share one line, so a notice never
 * overtakes the card it follows. Notices go out from the outbox (decision 0133); a refused one
 * waits on a timer of the clock, which a later pass moves or the pairing replaces.
 */
export function createTelegramRelay(given: TelegramRelayContext): TelegramRelay {
  const stop = new AbortController();
  const context: RunContext = { ...given, stop: stop.signal };
  let isStarted = false;
  const deliver = async (work: Extract<RelayWork, { kind: "deliver" }>): Promise<void> => {
    await context.stored();
    if (isStarted) {
      const through = work.through === undefined ? {} : { through: work.through };
      armTimer(await context.outbox.send({ signal: context.stop, ...through }));
    }
  };
  const run = async (work: RelayWork): Promise<void> => {
    try {
      await perform(context, work, deliver);
    } catch (error) {
      // A stopped relay drops what it was sending; nothing failed.
      if (context.stop.aborted) {
        return;
      }
      const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
      const { event, fields } = errorEvent(work);
      context.logger.warn(event, { ...fields, errorCode });
    }
  };
  const line = createWorkLine(run, context.logger);
  const armTimer = createPassTimer(context.clock, context.stop, () => line.enqueue(deliverAll));
  return {
    relay(push) {
      const work = workOf(push);
      if (work !== undefined) {
        line.enqueue(work);
      }
    },
    start() {
      isStarted = true;
      line.enqueue(deliverAll);
    },
    paired: () => line.enqueue(deliverAll),
    async idle() {
      await line.idle();
      await context.chat.idle();
    },
    async close() {
      stop.abort();
      context.chat.close();
      await line.idle();
    },
  };
}
