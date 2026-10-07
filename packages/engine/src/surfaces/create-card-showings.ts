import type { AssetRef, ChainRegistry } from "@binference/chain";
import { BinferenceError, type Id } from "@binference/core";
import type { AssetInfos } from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import type { CardClosing } from "../confirmations/card-closing.js";
import type { CardLine, CardValue } from "../confirmations/card-line.js";
import { type Card, drawCard } from "../confirmations/draw-card.js";
import { isFirstLiveCard } from "../confirmations/first-live-card.js";
import type { CardCloseReason, CardRecord } from "../intents/card-record.js";
import { closingOf } from "../intents/intent-history.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { assetInfosOf } from "../money-path/asset-infos.js";
import type { AgentStore, IntentStore } from "../ports.js";
import { cardFactsOf } from "./card-facts-of.js";
import { type PaperReceipt, paperReceiptOf } from "./paper-receipt.js";

/** One card version, named by its intent and its id, as `card/opened` names it. */
export interface CardVersionRef {
  readonly intent: Id<"int">;
  readonly card: Id<"crd">;
}

/** An open card version as a button surface shows it. */
export interface CardShowing {
  readonly intent: Id<"int">;
  /** The card version as the engine draws it. */
  readonly card: Card;
  /** The random reference its buttons carry (spec 4, section 2). */
  readonly callbackRef: string;
  /** Every asset the card names, with its symbol, decimals and verdict. */
  readonly assets: AssetInfos;
}

/** A card version that closed with a receipt, and what its copies become. */
export interface CardSettling {
  /** The card version's callback reference. */
  readonly ref: string;
  readonly closing: CardClosing;
  /** The fill of a confirmed paper intent, which its receipt shows. */
  readonly paper?: PaperReceipt;
}

/** Reads card versions as button surfaces show them, from open card to receipt. */
export interface CardShowings {
  /**
   * The card version drawn from the stored intent while it is open. `undefined` once it closed,
   * for a version without a callback reference, or for an intent the engine draws no card for.
   */
  opened(
    ref: CardVersionRef,
    options: { readonly signal: AbortSignal },
  ): Promise<CardShowing | undefined>;
  /**
   * The receipt of the intent's newest card version that an answer or the timer closed. A
   * confirmed paper intent settles once it recorded its fill, with the fill. `undefined` before
   * then, for an intent with no such version, and for a version without a callback reference.
   */
  settled(
    intent: Id<"int">,
    options: { readonly signal: AbortSignal },
  ): Promise<CardSettling | undefined>;
}

/** What {@link createCardShowings} reads. */
export interface CardShowingsOptions {
  readonly intents: IntentStore;
  readonly agents: AgentStore;
  readonly chains: ChainRegistry;
}

interface Call {
  readonly signal: AbortSignal;
}

const withReceipt: ReadonlySet<CardCloseReason> = new Set(["confirmed", "denied", "expired"]);

function assetsOfValue(value: CardValue): readonly AssetRef[] {
  if (value.type === "amount") {
    return [value.amount.asset];
  }
  if (value.type === "asset") {
    return [value.asset];
  }
  return value.type === "line" ? assetsOfLine(value.line) : [];
}

function assetsOfLine(line: CardLine): readonly AssetRef[] {
  return Object.values(line.values).flatMap(assetsOfValue);
}

async function versionOf(
  options: CardShowingsOptions,
  ref: CardVersionRef,
  call: Call,
): Promise<CardRecord | undefined> {
  const cards = await options.intents.cards(ref.intent, call);
  return cards.find((card) => card.id === ref.card);
}

async function settingsOf(
  options: CardShowingsOptions,
  record: IntentRecord,
  call: Call,
): Promise<AgentSettings> {
  const settings = await options.agents.get(record.agentId, call);
  if (settings === undefined) {
    throw new BinferenceError({
      code: "engine.agent_missing",
      message: `The agent of intent ${record.id} is not stored.`,
      details: { intent: record.id },
    });
  }
  return settings;
}

async function opened(
  options: CardShowingsOptions,
  ref: CardVersionRef,
  call: Call,
): Promise<CardShowing | undefined> {
  const { intents, chains } = options;
  const record = await intents.get(ref.intent, call);
  const card = await versionOf(options, ref, call);
  if (record === undefined || card?.callbackRef === undefined || card.closedAtMs !== undefined) {
    return undefined;
  }
  const settings = await settingsOf(options, record, call);
  const isFirstLive = await isFirstLiveCard(intents, record, call);
  const facts = cardFactsOf({ record, card, settings, isFirstLive, chains });
  if (facts === undefined) {
    return undefined;
  }
  const drawn = drawCard(facts);
  const assets = assetInfosOf(chains, [...new Set(drawn.lines.flatMap(assetsOfLine))]);
  return { intent: ref.intent, card: drawn, callbackRef: card.callbackRef, assets };
}

async function settled(
  options: CardShowingsOptions,
  intent: Id<"int">,
  call: Call,
): Promise<CardSettling | undefined> {
  const { intents, chains } = options;
  const [record, events, cards] = await Promise.all([
    intents.get(intent, call),
    intents.events(intent, call),
    intents.cards(intent, call),
  ]);
  const card = cards.findLast(
    (stored) => stored.closeReason !== undefined && withReceipt.has(stored.closeReason),
  );
  const closing = closingOf({ events, cards });
  if (record === undefined || card?.callbackRef === undefined || closing === undefined) {
    return undefined;
  }
  const paper = paperReceiptOf({ events, cards }, chains);
  if (paper !== undefined) {
    return { ref: card.callbackRef, closing, paper };
  }
  // A confirmed paper intent fills right after; its receipt waits to show the fill.
  const isFilling = record.isPaper && closing.outcome === "confirmed";
  return isFilling ? undefined : { ref: card.callbackRef, closing };
}

/**
 * Creates the {@link CardShowings} over the intent and agent stores: each card version is drawn
 * from the stored intent with the registry's info for the assets it names, and a closed version
 * settles with the intent's closing and its paper fill.
 */
export function createCardShowings(options: CardShowingsOptions): CardShowings {
  return {
    opened: async (ref, call) => opened(options, ref, call),
    settled: async (intent, call) => settled(options, intent, call),
  };
}
