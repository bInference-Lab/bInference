import type { ChainRegistry } from "@binference/chain";
import {
  BinferenceError,
  type Clock,
  type Id,
  type LogFields,
  type Logger,
} from "@binference/core";
import type { AgentStore } from "@binference/engine";
import type { NoticeDelivery, NoticeStore } from "@binference/engine/notices";
import { noticeText, type OwnerStore } from "@binference/engine/surfaces";
import type { Formatter, MessageLocale } from "@binference/i18n";
import type { Api } from "grammy";
import { createOwnerFormatters } from "../format/owner-formatters.js";
import { type BotCalls, createBotCalls } from "../ingress/bot-calls.js";
import { splitText } from "../split/split-text.js";
import { backoffAfter, type DeliveryFate, deliveryFateOf } from "./delivery-fate.js";
import {
  createNoticePlaces,
  type NoticePlace,
  type NoticePlaces,
  type NoticeTopics,
} from "./notice-places.js";

/**
 * Where the outbox stands after a pass: every delivery it was asked for went, deliveries wait for
 * the owner to pair, or the next one is due at `atMs`.
 */
export type OutboxPass =
  | { readonly kind: "done" }
  | { readonly kind: "noOwner" }
  | { readonly kind: "waiting"; readonly atMs: number };

/**
 * One pass of the outbox. With `through`, the pass stops after that notice's delivery, so a notice
 * stored later waits for its own turn in the line it shares with the cards.
 */
export interface OutboxCall {
  readonly signal: AbortSignal;
  readonly through?: Id<"ntc">;
}

/** The owner's notices as Telegram sends them from the outbox (decision 0133). */
export interface NoticeOutbox {
  /**
   * Sends the deliveries waiting on Telegram, oldest first, one at a time, until none is due or the
   * pass reached the notice it runs through. A
   * delivery is marked `unknown_after_send` before its call and never sent again from there:
   * `sent` once every part reached the chat, `queued` again at its next time when Telegram refused
   * it, `failed` when Telegram refuses it for good. A delivery that waits holds the ones behind it.
   * Rejects with the signal's reason once it aborts; the delivery under way stays unknown.
   */
  send(call: OutboxCall): Promise<OutboxPass>;
}

/** What {@link createNoticeOutbox} needs. */
export interface NoticeOutboxOptions {
  /** The bot's grammY `Api`, with the token's throttler installed. */
  readonly api: Api;
  readonly owners: OwnerStore;
  readonly notices: Pick<NoticeStore, "queued" | "move">;
  /** The agents, whose names title their topics and stand before their notices. */
  readonly agents: Pick<AgentStore, "get">;
  /**
   * The agents' topics in the owner's chat (decision 0186); left out, or while they are off,
   * every notice goes to the chat itself.
   */
  readonly topics?: NoticeTopics;
  /** The chains whose coins and tokens a notice's amounts name. */
  readonly chains: ChainRegistry;
  /** The owner's language and timezone as they are now, read for each notice. */
  readonly display: () => { readonly locale: MessageLocale; readonly timeZone: string };
  readonly clock: Clock;
  readonly logger: Logger;
}

/** One delivery on its way to the owner's chat, in a pass that may stop after a notice. */
interface Send extends OutboxCall {
  readonly delivery: NoticeDelivery;
  readonly chatId: number;
}

/** A delivery with the place in the chat it goes to. */
interface Placed extends Send {
  readonly threadId?: number;
}

/** How far a send got: the parts that reached the chat, and the fault that stopped it. */
interface Sent {
  readonly parts: number;
  readonly fault?: BinferenceError;
}

/** What one delivery left: the pass goes on, or it stops until `atMs`. */
type Step = { readonly kind: "next" } | { readonly kind: "wait"; readonly atMs: number };

interface Sender {
  readonly options: NoticeOutboxOptions;
  readonly bot: BotCalls;
  readonly places: NoticePlaces;
  /** The owner's formatter now, in the owner's language and timezone. */
  readonly formatter: () => Formatter;
}

const batchSize = 50;
const next: Step = { kind: "next" };
const unknownFate: DeliveryFate = { kind: "unknown" };

// The ids a log line names, never the text of a notice.
function fieldsOf(delivery: NoticeDelivery, errorCode: string): LogFields {
  const { agent, intent } = delivery.record.notice;
  return {
    ...(agent === undefined ? {} : { agentId: agent }),
    ...(intent === undefined ? {} : { intentId: intent }),
    errorCode,
  };
}

// Sends the parts one at a time, so they reach the chat in order, and stops at the first fault.
async function sendParts(sender: Sender, send: Placed, parts: readonly string[]): Promise<Sent> {
  const thread = send.threadId === undefined ? {} : { threadId: send.threadId };
  const target = { chatId: send.chatId, ...thread };
  const sendFrom = async (done: number): Promise<Sent> => {
    const part = parts[done];
    if (part === undefined) {
      return { parts: done };
    }
    try {
      await sender.bot.reply(target, part, { signal: send.signal });
    } catch (error) {
      send.signal.throwIfAborted();
      return error instanceof BinferenceError ? { parts: done, fault: error } : { parts: done };
    }
    return sendFrom(done + 1);
  };
  return sendFrom(0);
}

// Puts a delivery Telegram sent nothing for back in the queue, and holds the line until `atMs`.
async function requeue(sender: Sender, send: Placed, atMs: number): Promise<Step> {
  const { id } = send.delivery;
  const move = { id, from: "unknown_after_send", to: "queued", nextAtMs: atMs } as const;
  await sender.options.notices.move(move, { signal: send.signal });
  return { kind: "wait", atMs };
}

// Telegram sent nothing to a topic the owner deleted: the agent's topic is forgotten, and the
// delivery waits out its backoff, then makes a new topic.
async function settleGoneTopic(sender: Sender, send: Placed, threadId: number): Promise<Step> {
  const { clock, logger } = sender.options;
  const { delivery, signal, chatId } = send;
  logger.warn("telegram.topic_gone", fieldsOf(delivery, "telegram.api_refused"));
  await sender.places.gone({ notice: delivery.record.notice, chatId, threadId }, { signal });
  return requeue(sender, send, clock.now() + backoffAfter(delivery.attempts + 1));
}

// A refusal goes back in the queue, a message Telegram refuses for good fails, and one that may
// have reached the chat stays unknown while the line pauses for the backoff.
async function settleFault(sender: Sender, send: Placed, sent: Sent): Promise<Step> {
  const { notices, clock, logger } = sender.options;
  const { delivery, signal } = send;
  const attempts = delivery.attempts + 1;
  if (sent.parts === 0 && send.threadId !== undefined && sent.fault?.details["isTopicGone"]) {
    return settleGoneTopic(sender, send, send.threadId);
  }
  const fate = sent.parts === 0 ? deliveryFateOf(sent.fault, attempts) : unknownFate;
  const fields = fieldsOf(delivery, sent.fault?.code ?? "unexpected");
  if (fate.kind === "failed") {
    logger.warn("telegram.notice_failed", fields);
    await notices.move({ id: delivery.id, from: "unknown_after_send", to: "failed" }, { signal });
    return next;
  }
  if (fate.kind === "unknown") {
    logger.warn("telegram.notice_unknown", fields);
    return { kind: "wait", atMs: clock.now() + backoffAfter(attempts) };
  }
  logger.info("telegram.notice_waits", fields);
  return requeue(sender, send, clock.now() + fate.afterMs);
}

// The notice in the owner's language, with its agent's name before it when its place says so.
function placedText(sender: Sender, delivery: NoticeDelivery, place: NoticePlace): string {
  const formatter = sender.formatter();
  const display = { formatter, chains: sender.options.chains };
  const text = noticeText(delivery.record.notice, display);
  if (place.kind !== "chat" || place.agentName === undefined) {
    return text;
  }
  const values = { agent: place.agentName, notice: text };
  // oxlint-disable-next-line eslint/no-restricted-properties -- the formatter's message method picks i18n text by key; no error message is read
  return formatter.message("telegram.notice.agent", values);
}

// Draws the notice's text first: a notice that cannot be drawn fails before anything is sent.
function textOf(sender: Sender, delivery: NoticeDelivery, place: NoticePlace): string | undefined {
  try {
    return placedText(sender, delivery, place);
  } catch (error) {
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    sender.options.logger.warn("telegram.notice_failed", fieldsOf(delivery, errorCode));
    return undefined;
  }
}

async function deliver(sender: Sender, send: Send): Promise<Step> {
  const { notices, clock } = sender.options;
  const { delivery, signal } = send;
  const place = await sender.places.placeOf(delivery.record.notice, send.chatId, { signal });
  if (place.kind === "wait") {
    return { kind: "wait", atMs: place.atMs };
  }
  const text = textOf(sender, delivery, place);
  if (text === undefined) {
    await notices.move({ id: delivery.id, from: "queued", to: "failed" }, { signal });
    return next;
  }
  const claim = { id: delivery.id, from: "queued", to: "unknown_after_send" } as const;
  if (!(await notices.move(claim, { signal })).ok) {
    return next;
  }
  const parts = splitText(text);
  const placed = place.kind === "topic" ? { ...send, threadId: place.threadId } : send;
  const sent = await sendParts(sender, placed, parts);
  if (sent.parts < parts.length) {
    return settleFault(sender, placed, sent);
  }
  const atMs = clock.now();
  await notices.move({ id: delivery.id, from: "unknown_after_send", to: "sent", atMs }, { signal });
  return next;
}

// The batch's deliveries, oldest first, until one is not due yet, one makes the line wait, or the
// pass reached the notice it runs through.
async function sendBatch(
  sender: Sender,
  batch: readonly NoticeDelivery[],
  send: Omit<Send, "delivery">,
): Promise<OutboxPass | undefined> {
  const [delivery, ...rest] = batch;
  if (delivery === undefined) {
    return undefined;
  }
  if (delivery.nextAtMs > sender.options.clock.now()) {
    return { kind: "waiting", atMs: delivery.nextAtMs };
  }
  const step = await deliver(sender, { ...send, delivery });
  if (step.kind === "wait") {
    return { kind: "waiting", atMs: step.atMs };
  }
  return delivery.record.id === send.through ? { kind: "done" } : sendBatch(sender, rest, send);
}

async function sendAll(sender: Sender, call: OutboxCall): Promise<OutboxPass> {
  const { notices, owners } = sender.options;
  const { signal } = call;
  const batch = await notices.queued({ surface: "telegram", limit: batchSize }, { signal });
  if (batch.length === 0) {
    return { kind: "done" };
  }
  const owner = await owners.get({ signal });
  if (owner === undefined) {
    return { kind: "noOwner" };
  }
  const stopped = await sendBatch(sender, batch, { ...call, chatId: owner.userId });
  return stopped ?? sendAll(sender, call);
}

/**
 * Creates the outbox sender of the owner's chat (decision 0133). Each notice is written by the
 * engine's `noticeText` in the owner's language and timezone at the time it goes, and sent as
 * plain text, split at line breaks into messages Telegram takes. A notice about an agent goes to
 * the agent's topic when topics are on, or carries the agent's name (decision 0186); a topic the
 * owner deleted is made again. Before an owner is bound, nothing goes.
 */
export function createNoticeOutbox(options: NoticeOutboxOptions): NoticeOutbox {
  const formatters = createOwnerFormatters();
  const { api, agents, topics, clock, logger } = options;
  const sender: Sender = {
    options,
    bot: createBotCalls(api),
    places: createNoticePlaces({
      api,
      agents,
      ...(topics === undefined ? {} : { topics }),
      clock,
      logger,
    }),
    formatter: () => formatters(options.display()),
  };
  return { send: async (call) => sendAll(sender, call) };
}
