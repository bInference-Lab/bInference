import { setTimeout as wait } from "node:timers/promises";
import type { Fork } from "@binference/chain-evm/fork";
import { BinferenceError, type Id, idSchema } from "@binference/core";
import type { FakeMessage } from "@binference/telegram/testing";
import { type ChatWatch, ownerId, ownerText } from "../e2e/runtime-machine.js";
import type { OwnerChatMachine } from "./owner-chat-machine.js";
import { rescueAgents } from "./rescue-rig-parts.js";

/** The rig's live agent, whose chat the owner writes in. */
export const liveAgent: Id<"agt"> =
  rescueAgents[0] ?? idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000061");

/** A call's signal: a fork's reads and the engine's steps answer within 30 seconds. */
export const live = (): { readonly signal: AbortSignal } => ({
  signal: AbortSignal.timeout(30_000),
});

/** Throws for a value the fixture always holds. */
export function never(): never {
  throw new BinferenceError({ code: "test.missing", message: "The fixture holds it." });
}

// The newest message in the owner's chat that still carries a Confirm button.
function openCard(machine: OwnerChatMachine): FakeMessage {
  return (
    machine.botApi
      .messages()
      .findLast((message) => message.buttons[0]?.[0]?.data?.startsWith("bnf1:c:y:") === true) ??
    never()
  );
}

/** The owner taps Confirm on the newest open card. */
export async function confirm(machine: OwnerChatMachine): Promise<void> {
  const card = openCard(machine);
  const data = card.buttons[0]?.[0]?.data ?? never();
  const update = machine.botApi.press({ from: ownerId, data, messageId: card.messageId });
  await machine.bot.ingress.receive(update, live());
  await machine.bot.idle();
}

/**
 * Waits until the intent reaches `state` or ends otherwise, polling the store, for at most a
 * minute, and answers the state it reached.
 */
export async function until(
  machine: OwnerChatMachine,
  intent: Id<"int">,
  state: string,
): Promise<string> {
  const ended = new Set(["reconciled", "failed_check", "failed_onchain", "expired", "cancelled"]);
  const deadline = Date.now() + 60_000;
  const poll = async (): Promise<string> => {
    const record = await machine.stores.intents.get(intent, live());
    const now = record?.state ?? "missing";
    if (now === state || ended.has(now) || Date.now() > deadline) {
      return now;
    }
    await wait(250);
    return poll();
  };
  return poll();
}

/** The live agent's newest intent: ids are time ordered. */
export async function newestIntent(machine: OwnerChatMachine): Promise<Id<"int">> {
  const listed = await machine.client.call("intent/list", { agent: liveAgent }, live());
  const ids = listed.items.map(({ intent }) => intent).toSorted();
  return ids.at(-1) ?? never();
}

/** The text the card's message holds now. */
export function messageText(machine: OwnerChatMachine, card: FakeMessage): string {
  const now = machine.botApi.messages().find(({ messageId }) => messageId === card.messageId);
  return now?.text ?? "";
}

/** The chat a step runs in: the machine, the watch on the agent's turns, and the fork. */
export interface Chat {
  readonly fork: Fork;
  readonly machine: OwnerChatMachine;
  readonly turns: ChatWatch;
}

/** What a step leaves to check: the card's message as it was shown, and its intent. */
export interface Step {
  readonly card: FakeMessage;
  readonly intent: Id<"int">;
}

/** The owner writes `text`; the model's nth turn proposes, and its card reaches the chat. */
export async function ask(chat: Chat, text: string, turn: number): Promise<Step> {
  const { machine } = chat;
  await machine.bot.ingress.receive(ownerText(text, turn + 1), live());
  await chat.turns.turnsEnded(turn);
  await machine.bot.idle();
  return { card: openCard(machine), intent: await newestIntent(machine) };
}
