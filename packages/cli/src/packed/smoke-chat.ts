import { bsc } from "@binference/chains";
import { ownerText } from "../e2e/runtime-machine.js";
import type { SmokeBot } from "./smoke-bot.js";
import type { SmokeToolCall } from "./smoke-model.js";

// The Telegram user the packed smokes pair as the owner.
const ownerId = 7_012_345_678;

const minute = 60_000;
const usdt = bsc.tokens.find((token) => token.symbol === "USDT")?.address ?? "";
const { assetNamespace, assetReference } = bsc.nativeAsset;

/**
 * What the scripted model says in a paper trade by chat: the agent's first turn swaps 0.001 BNB
 * for USDT, every later turn answers `report`.
 */
export const paperTradeScript: { readonly call: SmokeToolCall; readonly report: string } = {
  call: {
    name: "swap",
    args: {
      from: `${bsc.id}/${assetNamespace}:${assetReference}`,
      to: `${bsc.id}/erc20:${usdt}`,
      amount: { base: (10n ** 15n).toString() },
      reason: "You asked for USDT.",
    },
  },
  report: "Bought USDT for 0.001 BNB on paper.",
};

/** The last JSON line a `--json` command printed, or `null` as JSON when it printed none. */
export function lastJsonLine(stdout: string): string {
  return stdout.split("\n").findLast((line) => line.startsWith("{")) ?? "null";
}

function isPaired(api: SmokeBot["api"]): boolean {
  return api.sent().some((sent) => sent.text.includes("You are now the owner"));
}

/** The owner sends `/start <code>` and waits for the bot's pairing answer. */
export async function pairOwner(bot: SmokeBot, code: string): Promise<void> {
  bot.api.push(ownerText(`/start ${code}`, 1));
  await bot.until("pairing answer", isPaired, minute);
}

// The first Confirm button the bot showed, with its message.
function confirmOf(api: SmokeBot["api"]) {
  return api
    .messages()
    .flatMap((message) =>
      message.buttons
        .flat()
        .flatMap((button) => (button.data === undefined ? [] : [button.data]))
        .filter((data) => data.startsWith("bnf1:c:y:"))
        .map((data) => ({ data, messageId: message.messageId })),
    )
    .at(0);
}

function isFilled(api: SmokeBot["api"]): boolean {
  return api.messages().some((message) => message.text.includes("Paper fill"));
}

// How many messages the bot sent that carry `text`.
function sentWith(api: SmokeBot["api"], text: string): number {
  return api.sent().filter((sent) => sent.text.includes(text)).length;
}

/**
 * The owner asks for USDT in Telegram, taps Confirm on the card, and waits for the paper fill
 * and the agent's report, which the scripted model says as `report`.
 */
export async function tradeByChat(bot: SmokeBot, report: string): Promise<void> {
  bot.api.push(ownerText("Buy USDT for 0.001 BNB", 2));
  await bot.until("card with Confirm", (api) => confirmOf(api) !== undefined, 4 * minute);
  const confirm = confirmOf(bot.api);
  if (confirm !== undefined) {
    bot.api.press({ from: ownerId, ...confirm });
  }
  await bot.until("paper fill", isFilled, 2 * minute);
  await bot.until("agent's report", (api) => sentWith(api, report) > 0, 2 * minute);
}
