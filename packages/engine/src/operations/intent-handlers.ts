import { err, type Id, ok, type Result } from "@binference/core";
import type { CardLinesView, IntentView, ProtocolErrorCode } from "@binference/protocol";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import type { MoneyPath } from "../money-path/create-money-path.js";
import type { CardShowings } from "../surfaces/create-card-showings.js";
import { type AnswerCard, answerError } from "./answer-card.js";
import { answererOf, type EngineCall, type EngineHandler, proposerOf } from "./engine-call.js";
import { type IntentListOptions, listIntents } from "./intent-list.js";
import { intentViewOf } from "./intent-view-of.js";

/** The handlers of the intent operations the engine serves (protocol spec, section 7.4). */
export interface IntentHandlers {
  readonly "intent/propose": EngineHandler<"intent/propose">;
  readonly "intent/get": EngineHandler<"intent/get">;
  readonly "intent/card": EngineHandler<"intent/card">;
  readonly "intent/list": EngineHandler<"intent/list">;
  readonly "intent/confirm": EngineHandler<"intent/confirm">;
  readonly "intent/deny": EngineHandler<"intent/deny">;
}

/** What the intent handlers read, propose and answer through. */
export interface IntentHandlersOptions extends IntentListOptions {
  readonly stored: StoredIntents;
  readonly moneyPath: MoneyPath;
  readonly answer: AnswerCard;
  /** Draws an intent's open card version, as a surface without buttons shows it. */
  readonly showings: Pick<CardShowings, "newest">;
}

interface Answering {
  readonly intent: Id<"int">;
  /** The card id the caller named, and the version a Confirm names. */
  readonly card: Id<"crd">;
  readonly cardVersion?: number;
}

// The named card must be one of the intent's versions; a Confirm names that version's number too.
async function cardVersionOf(
  options: IntentHandlersOptions,
  answering: Answering,
  signal: AbortSignal,
): Promise<Result<number, ProtocolErrorCode>> {
  const snapshot = await options.stored.snapshot(answering.intent, { signal });
  if (snapshot === undefined) {
    return err("intent.not_found");
  }
  const card = snapshot.history.cards.find((stored) => stored.id === answering.card);
  const isNamed = answering.cardVersion === undefined || answering.cardVersion === card?.version;
  return card === undefined || !isNamed ? err("intent.card_changed") : ok(card.version);
}

async function answered(
  options: IntentHandlersOptions,
  call: EngineCall<"intent/confirm"> | EngineCall<"intent/deny">,
  decision: "confirm" | "deny",
): Promise<Result<IntentView, ProtocolErrorCode>> {
  const { args, caller, signal } = call;
  const cardVersion = await cardVersionOf(options, args, signal);
  if (!cardVersion.ok) {
    return cardVersion;
  }
  const answer = { intent: args.intent, decision, cardVersion: cardVersion.value };
  const result = await options.answer({ ...answer, answeredBy: answererOf(caller) }, { signal });
  if (!result.ok) {
    return err("intent.not_found");
  }
  const refusal = answerError(result.value.outcome);
  return refusal === undefined
    ? ok(intentViewOf(result.value.intent, options.chains))
    : err(refusal);
}

function viewOf(
  options: IntentHandlersOptions,
  snapshot: IntentSnapshot | undefined,
): Result<IntentView, ProtocolErrorCode> {
  return snapshot === undefined
    ? err("intent.not_found")
    : ok(intentViewOf(snapshot, options.chains));
}

// The intent's open card version as the engine draws it; an intent with none is in the wrong
// state for a card.
async function drawnCard(
  options: IntentHandlersOptions,
  call: EngineCall<"intent/card">,
): Promise<Result<CardLinesView, ProtocolErrorCode>> {
  const { args, signal } = call;
  const drawn = await options.showings.newest(args.intent, { signal });
  if (drawn === undefined) {
    const snapshot = await options.stored.snapshot(args.intent, { signal });
    return err(snapshot === undefined ? "intent.not_found" : "intent.wrong_state");
  }
  const { card, assets } = drawn;
  const { version, expiresAtMs: expiresAt, lines } = card;
  return ok({ card: drawn.cardId, version, expiresAt, lines, assets });
}

/**
 * Creates the intent handlers. `intent/propose` answers with the intent once it waits for the
 * owner or ends; `intent/list` pages through the intents (`listIntents`); `intent/card` answers its open card version as the engine draws it, line by
 * line; `intent/confirm` and `intent/deny` answer a card version the caller names and answer with
 * the intent after it, filled on paper when confirmed.
 */
export function createIntentHandlers(options: IntentHandlersOptions): IntentHandlers {
  return {
    async "intent/propose"({ args, caller, signal }) {
      const proposer = proposerOf(caller);
      if (proposer === undefined) {
        return err("auth.scope");
      }
      const proposing = { signal, credential: caller.credential };
      const proposed = await options.moneyPath.propose(args, proposer, proposing);
      return proposed.ok ? viewOf(options, proposed.value) : proposed;
    },
    "intent/get": async ({ args, signal }) =>
      viewOf(options, await options.stored.snapshot(args.intent, { signal })),
    "intent/card": async (call) => drawnCard(options, call),
    "intent/list": async (call) => listIntents(options, call),
    "intent/confirm": async (call) => answered(options, call, "confirm"),
    "intent/deny": async (call) => answered(options, call, "deny"),
  };
}
