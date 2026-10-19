import type { IntentView, ProtocolId } from "@binference/protocol";
import { callOptions, type ChatContext } from "./chat-context.js";
import { cardLines, failureText } from "./chat-lines.js";
import { type OpenCard, secondsLeft } from "./chat-state.js";

/** The agent's cards that wait for the owner, and the keys' answers to the first. */
export interface ChatCards {
  /** Reads the waiting cards again: prints each new card version, and how each card left closed. */
  reload(): Promise<void>;
  /** Answers the first waiting card: Confirm names the version it shows, Cancel denies it. */
  answer(verb: "confirm" | "cancel"): Promise<void>;
}

type Listed = IntentView & { readonly card: NonNullable<IntentView["card"]> };

function hasCard(intent: IntentView): intent is Listed {
  return intent.card !== undefined;
}

// The answer's line: confirmed, or a worse re-quote that opened the next version, or cancelled.
function answeredText(context: ChatContext, shown: OpenCard, view: IntentView): string {
  const { words } = context;
  if (view.state === "awaiting_confirmation" && (view.card?.version ?? 0) > shown.shown.version) {
    return words("tui.card.requoted");
  }
  if (view.state === "denied" || view.state === "cancelled") {
    return words("tui.card.cancelled");
  }
  return words("tui.card.confirmed", { paper: view.paper ? "yes" : "no" });
}

async function opened(context: ChatContext, intent: Listed): Promise<OpenCard> {
  const { client, formatter, print, clock } = context;
  const shown = await client.call("intent/card", { intent: intent.intent }, callOptions(context));
  print([{ text: "" }, ...cardLines(formatter, shown)]);
  const lifetimeMs = intent.card.expiresAt - intent.card.opensAt;
  return { intent: intent.intent, paper: intent.paper, shown, seenAt: clock.now(), lifetimeMs };
}

// How a card the owner did not answer here left: expired, cancelled or confirmed elsewhere.
async function closedElsewhere(context: ChatContext, intent: ProtocolId<"intent">): Promise<void> {
  const view = await context.client.call("intent/get", { intent }, callOptions(context));
  context.print([{ text: context.words("tui.card.closed", { state: view.state }), tone: "dim" }]);
}

// Reads what waits again: keeps each version shown, prints each new one, and says how each card
// that left without an answer here ended.
async function reloadCards(context: ChatContext, answered: ReadonlySet<string>): Promise<void> {
  const { client, agent, store } = context;
  const args = { state: "awaiting_confirmation", limit: 50 } as const;
  const page = await client.call("intent/list", args, callOptions(context));
  const waiting = page.items.filter((intent) => intent.agent === agent).filter(hasCard);
  const shown = store.get().cards;
  const kept = shown.filter((card) =>
    waiting.some(
      (intent) => intent.intent === card.intent && intent.card.version === card.shown.version,
    ),
  );
  const cards = [...kept];
  for (const intent of waiting.filter(
    (each) => !kept.some((card) => card.intent === each.intent),
  )) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each card prints in the order it opened
    cards.push(await opened(context, intent));
  }
  store.update((state) => ({ ...state, cards }));
  const gone = shown.filter((card) => !waiting.some((intent) => intent.intent === card.intent));
  for (const card of gone.filter((left) => !answered.has(left.intent))) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each line prints in order
    await closedElsewhere(context, card.intent);
  }
}

// Confirms the version the card shows, or denies it, and prints what came of it.
async function answerCard(
  context: ChatContext,
  card: OpenCard,
  verb: "confirm" | "cancel",
): Promise<IntentView> {
  const { intent, shown } = card;
  const view =
    verb === "confirm"
      ? await context.client.call(
          "intent/confirm",
          { intent, card: shown.card, cardVersion: shown.version },
          callOptions(context),
        )
      : await context.client.call(
          "intent/deny",
          { intent, card: shown.card },
          callOptions(context),
        );
  context.print([{ text: answeredText(context, card, view), tone: "dim" }]);
  return view;
}

/**
 * The agent's cards inline in the chat (`intent/list` of what waits for the owner, then
 * `intent/card` for each new version, drawn as the engine draws it): a card prints when it opens,
 * the live area shows the first with its time left and keys, and the line that says how it ended
 * prints when it leaves. A key on a card already answered, or Ctrl+Y on an expired one, does
 * nothing; the engine expires a card.
 */
export function createChatCards(context: ChatContext): ChatCards {
  const answered = new Set<string>();
  return {
    reload: async () => reloadCards(context, answered),
    answer: async (verb) => {
      const [first] = context.store.get().cards;
      if (first === undefined || answered.has(first.intent)) {
        return;
      }
      if (verb === "confirm" && secondsLeft(first, context.clock.now()) === 0) {
        return;
      }
      answered.add(first.intent);
      try {
        const view = await answerCard(context, first, verb);
        // A re-quote opened the next version: that one waits for its own answer.
        if (view.state === "awaiting_confirmation") {
          answered.delete(first.intent);
        }
      } catch (error) {
        answered.delete(first.intent);
        const reason = failureText(context.words, error);
        context.print([{ text: context.words("tui.card.failed", { reason }), tone: "dim" }]);
      }
    },
  };
}
