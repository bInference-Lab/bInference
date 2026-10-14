import type { AssetRef, ChainRegistry } from "@binference/chain";
import { BinferenceError, type Id, idSchema } from "@binference/core";
import type { AssetInfos } from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import type { CardClosing } from "../confirmations/card-closing.js";
import type { CardLine, CardValue } from "../confirmations/card-line.js";
import { type Card, drawCard } from "../confirmations/draw-card.js";
import { isFirstLiveCard } from "../confirmations/first-live-card.js";
import type { CardCloseReason, CardRecord } from "../intents/card-record.js";
import { closingOf } from "../intents/intent-history.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { intentAssetInfos } from "../money-path/asset-infos.js";
import type { AccessStore, AgentStore, IntentStore } from "../ports.js";
import type { VenueHost } from "../venues/venue-host.js";
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

/** An intent's open card version as the engine draws it, for a surface without buttons. */
export interface DrawnCard {
  readonly intent: Id<"int">;
  readonly cardId: Id<"crd">;
  readonly card: Card;
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
   * The intent's newest card version drawn from the stored intent while it is open, with or
   * without a callback reference. `undefined` once it closed, for an intent with no card, and for
   * an intent the engine draws no card for.
   */
  newest(
    intent: Id<"int">,
    options: { readonly signal: AbortSignal },
  ): Promise<DrawnCard | undefined>;
  /**
   * The receipt of the intent's newest card version that an answer or the timer closed. A
   * confirmed paper intent settles once it recorded its fill, with the fill. `undefined` before
   * then, for an intent with no such version, and for a version without a callback reference.
   */
  settled(
    intent: Id<"int">,
    options: { readonly signal: AbortSignal },
  ): Promise<CardSettling | undefined>;
  /**
   * Every card that waits for the owner's answer, its open version drawn with its callback
   * reference, oldest first and at most {@link maxWaitingCards}: what the owner may still cancel.
   */
  waiting(options: { readonly signal: AbortSignal }): Promise<readonly CardShowing[]>;
}

/**
 * The most waiting cards {@link CardShowings.waiting} reads at once. A trade card waits a minute
 * and any other ten, so more than this many is an agent that floods the owner; the oldest come
 * first, and the rest stay open on their other copies until they expire.
 */
export const maxWaitingCards = 20;

/** What {@link createCardShowings} reads. */
export interface CardShowingsOptions {
  readonly intents: IntentStore;
  readonly agents: AgentStore;
  /** The client tokens and console devices, whose labels name who proposed an intent. */
  readonly access: Pick<AccessStore, "listTokens" | "findDevice">;
  readonly chains: ChainRegistry;
  /** Which venues declare that their trade calls carry no deadline, for the card's warning. */
  readonly venues: Pick<VenueHost, "hasNoDeadline">;
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

// Who proposed the intent, as an auto mode line names an MCP proposal's client: the label of the
// client token or console device that called, Telegram, or binference for the engine itself.
async function clientOf(
  options: CardShowingsOptions,
  record: IntentRecord,
  call: Call,
): Promise<string> {
  const ref = record.proposer;
  if (ref === "telegram" || ref === "engine") {
    return ref === "telegram" ? "Telegram" : "binference";
  }
  const device = idSchema("dev").safeParse(ref);
  if (device.success) {
    return (await options.access.findDevice(device.data, call))?.label ?? ref;
  }
  const tokens = await options.access.listTokens(call);
  return tokens.find((token) => token.id === ref)?.label ?? ref;
}

// An open card version drawn from its stored intent, with the info of every asset it names.
async function drawOpen(
  options: CardShowingsOptions,
  stored: { readonly record: IntentRecord; readonly card: CardRecord },
  call: Call,
): Promise<Pick<CardShowing, "card" | "assets"> | undefined> {
  const { intents, chains, venues } = options;
  const { record, card } = stored;
  const settings = await settingsOf(options, record, call);
  const isFirstLive = await isFirstLiveCard(intents, record, call);
  const cards = card.version > 1 ? await intents.cards(record.id, call) : [];
  const previous = cards.find((each) => each.version === card.version - 1);
  const client = card.autoAsk === "mcp" ? await clientOf(options, record, call) : "";
  const source = { record, card, settings, isFirstLive, chains, venues, client };
  const facts = cardFactsOf(previous === undefined ? source : { ...source, previous });
  if (facts === undefined) {
    return undefined;
  }
  const drawn = drawCard(facts);
  const assets = intentAssetInfos(chains, record, drawn.lines.flatMap(assetsOfLine));
  return { card: drawn, assets };
}

async function opened(
  options: CardShowingsOptions,
  ref: CardVersionRef,
  call: Call,
): Promise<CardShowing | undefined> {
  const record = await options.intents.get(ref.intent, call);
  const card = await versionOf(options, ref, call);
  if (record === undefined || card?.callbackRef === undefined || card.closedAtMs !== undefined) {
    return undefined;
  }
  const drawn = await drawOpen(options, { record, card }, call);
  return drawn === undefined
    ? undefined
    : { intent: ref.intent, callbackRef: card.callbackRef, ...drawn };
}

async function newest(
  options: CardShowingsOptions,
  intent: Id<"int">,
  call: Call,
): Promise<DrawnCard | undefined> {
  const [record, cards] = await Promise.all([
    options.intents.get(intent, call),
    options.intents.cards(intent, call),
  ]);
  const card = cards.at(-1);
  if (record === undefined || card === undefined || card.closedAtMs !== undefined) {
    return undefined;
  }
  const drawn = await drawOpen(options, { record, card }, call);
  return drawn === undefined ? undefined : { intent, cardId: card.id, ...drawn };
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
  const paper = paperReceiptOf({ record, history: { events, cards } }, chains);
  if (paper !== undefined) {
    return { ref: card.callbackRef, closing, paper };
  }
  // A confirmed paper intent fills right after; its receipt waits to show the fill.
  const isFilling = record.isPaper && closing.outcome === "confirmed";
  return isFilling ? undefined : { ref: card.callbackRef, closing };
}

async function waiting(options: CardShowingsOptions, call: Call): Promise<readonly CardShowing[]> {
  const query = { states: ["awaiting_confirmation"], limit: maxWaitingCards } as const;
  const records = await options.intents.list(query, call);
  const shown = await Promise.all(
    records.map(async (record) => {
      const last = (await options.intents.cards(record.id, call)).slice(-1);
      return Promise.all(
        last.map(async (card) => opened(options, { intent: record.id, card: card.id }, call)),
      );
    }),
  );
  return shown.flat().filter((showing) => showing !== undefined);
}

/**
 * Creates the {@link CardShowings} over the intent and agent stores: each card version is drawn
 * from the stored intent with the info of the assets it names, the registry's or what the intent
 * stored of an unlisted token at its proposal (decision 0199), and a closed version
 * settles with the intent's closing and its paper fill.
 */
export function createCardShowings(options: CardShowingsOptions): CardShowings {
  return {
    opened: async (ref, call) => opened(options, ref, call),
    newest: async (intent, call) => newest(options, intent, call),
    settled: async (intent, call) => settled(options, intent, call),
    waiting: async (call) => waiting(options, call),
  };
}
