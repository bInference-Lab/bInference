import { setTimeout as wait } from "node:timers/promises";
import { BinferenceError } from "@binference/core";
import { isTerminalState } from "@binference/engine";
import type { IntentView } from "@binference/protocol";
import type { FakeBotApi, FakeMessage } from "@binference/telegram/testing";
import { ownerId, ownerPhoto, ownerText } from "../e2e/runtime-machine.js";
import { connectClient } from "../e2e/test-host.js";
import { onePixelPng } from "../fork/flap-launch-parts.js";
import { type CrashLauncher, launchOf, type SettledLaunch } from "./crash-launches.js";
import type { CrashInstall } from "./crash-runs.js";

/** The prefixes of a draft's Start button and a card's Confirm button, as the bot writes them. */
const startButton = "bnf1:s:y:";
const confirmButton = "bnf1:c:y:";
const photoId = "AgACAgIAAxkBAAIBcrashcat";

const never = (what: string): never => {
  throw new BinferenceError({ code: "crash.no_message", message: `The bot sent no ${what}.` });
};

/** The newest message in the owner's chat whose first button's data starts with `prefix`. */
function withButton(bot: FakeBotApi, prefix: string): FakeMessage | undefined {
  return bot
    .messages()
    .findLast((message) => message.buttons[0]?.[0]?.data?.startsWith(prefix) === true);
}

// Waits until `found` answers, polling, for at most a minute.
async function until<T>(found: () => T | undefined, what: string, deadline: number): Promise<T> {
  const value = found();
  if (value !== undefined) {
    return value;
  }
  if (Date.now() > deadline) {
    return never(what);
  }
  await wait(200);
  return until(found, what, deadline);
}

/**
 * Pairs the owner's Telegram with the bot through init's pairing link, then sends the owner's
 * photo asking for the launch; answers the draft the agent's runtime made of it, once the bot
 * showed it with its Start button.
 */
export async function draftInChat(install: CrashInstall): Promise<FakeMessage> {
  const { bot } = install.machine;
  const deadline = Date.now() + 60_000;
  const sent = bot.sent().length;
  bot.push(ownerText(`/start ${install.pairingCode}`, 1));
  await until(() => (bot.sent().length > sent ? true : undefined), "pairing answer", deadline);
  bot.addFile(photoId, { bytes: onePixelPng });
  const caption = "Launch a token named Crash Cat on Flap with a 0.01 BNB first buy";
  bot.push(ownerPhoto({ fileId: photoId, caption }, 2));
  return until(() => withButton(bot, startButton), "launch draft", deadline);
}

/** The owner presses the first button of `message`. */
export function pressFirst(bot: FakeBotApi, message: FakeMessage): void {
  const data = message.buttons[0]?.[0]?.data ?? never("button");
  bot.press({ from: ownerId, data, messageId: message.messageId });
}

// Presses Confirm on the card the bot shows while the launch waits for it; answers whether it did.
function pressedCard(bot: FakeBotApi, view: IntentView | undefined): boolean {
  const card = withButton(bot, confirmButton);
  if (view?.state !== "awaiting_confirmation" || card === undefined) {
    return false;
  }
  pressFirst(bot, card);
  return true;
}

// Whether the run is over: the launch ended, or none is stored and the bot took every update.
function isOver(bot: FakeBotApi, view: IntentView | undefined): boolean {
  return view === undefined ? bot.pending().length === 0 : isTerminalState(view.state);
}

/**
 * Waits on the running engine until the agent's launch ended, pressing Confirm on a card the bot
 * shows as the owner would, then stops the engine through `engine/stop`. With no launch stored, it
 * waits until the bot took every update, the owner's presses among them, and stops.
 */
export async function settleChatAndStop(
  install: CrashInstall,
  launcher: CrashLauncher,
): Promise<SettledLaunch> {
  const { bot } = install.machine;
  const client = await connectClient(install.machine);
  const deadline = Date.now() + 120_000;
  const state = { isTapped: false };
  try {
    const follow = async (): Promise<SettledLaunch> => {
      const view = await launchOf(client, launcher.agent);
      if (!state.isTapped && pressedCard(bot, view)) {
        state.isTapped = true;
      }
      if (isOver(bot, view) || Date.now() > deadline) {
        const { isTapped } = state;
        return { intent: view?.intent, state: view?.state ?? "none", isTappedAfter: isTapped };
      }
      await wait(250);
      return follow();
    };
    const settled = await follow();
    // The bot's last words, such as a notice from the outbox, go out before the engine stops.
    await wait(1_000);
    await client.call("engine/stop", {}, { signal: AbortSignal.timeout(10_000) }).catch(() => ({}));
    return settled;
  } finally {
    client.close();
  }
}
