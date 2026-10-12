import { setTimeout as wait } from "node:timers/promises";
import type { AssetRef } from "@binference/chain";
import { erc20AssetRef, type WatchedPrice } from "@binference/chain-evm";
import { bscContract, bscToken, type Fork, withFork } from "@binference/chain-evm/fork";
import { BinferenceError } from "@binference/core";
import { callsReply } from "@binference/runtime/testing";
import type { FakeBotApi } from "@binference/telegram/testing";
import { type Address, encodeFunctionData, parseAbi, toHex } from "viem";
import { describe, expect, it } from "vitest";
import type { ComposedTelegram } from "../compose/compose-telegram.js";
import {
  type ChatWatch,
  ownerBot,
  ownerId,
  ownerText,
  superviseRuntime,
  watchChat,
} from "../e2e/runtime-machine.js";
import { blockTimeMs, orderPriceOf, watcherOn } from "./fork-price-watch.js";
import { type OrdersMachine, skeletonAgent, startOrdersMachine } from "./orders-skeleton-rig.js";

// The orders skeleton: the owner asks for a stop-loss in Telegram (the synthetic Bot API), the
// scripted model creates it with the agent's own tool, its card reaches Telegram and the owner's
// tap makes it active. That one model call costs more than the agent's $3 budget of the day, so
// chat pauses: the owner is told once, and the next message starts no turn. The runtime stops; the
// ETH price on the fork falls through the stop-loss, which fills on paper, and its notice reaches
// Telegram.

const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(20_000) });
// $600,000 per million input tokens: the scripted call's 10 input tokens cost $6.
const price = { inputPerMTokUsd: 600_000_000_000n, outputPerMTokUsd: 0n, cachedPerMTokUsd: 0n };
const pairAbi = parseAbi([
  "function getPair(address, address) view returns (address)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address, uint256) returns (bool)",
  "function sync()",
]);
const tokenBase = 10n ** 18n;
const eth = bscToken("ETH");
const icons = { waiting: String.fromCodePoint(0x1f7e1), paper: String.fromCodePoint(0x1f9ea) };
const done = String.fromCodePoint(0x2705);
const paused = /^Chat paused until .+: today's model budget is spent\. Orders keep running\.$/u;
const told =
  /^main used today's model budget \(\$3\.00\)\. Chat resumes .+; orders keep running\.$/u;

function never(): never {
  throw new BinferenceError({ code: "test.missing", message: "The fixture holds it." });
}

// A price's micro-dollars for one whole token of 18 decimals.
function wholeTokenUsd(read: WatchedPrice): bigint {
  const { numerator, denominator } = orderPriceOf(read).usdPerBaseUnit;
  return (numerator * tokenBase) / denominator;
}

/** The prices the watcher read, and the fills each started, in order. */
interface Watch {
  readonly seen: readonly WatchedPrice[];
  readonly fills: readonly Promise<
    readonly { readonly order: string; readonly outcome: string }[]
  >[];
}

// Mines a block a block time until the watcher read a price after the first `from`.
async function nextPrice(fork: Fork, watch: Watch, from: number): Promise<WatchedPrice> {
  await fork.call("evm_mine", []);
  await wait(blockTimeMs);
  return watch.seen[from] ?? nextPrice(fork, watch, from);
}

// Mines a block a block time until the watcher read a price under the level.
async function priceUnder(fork: Fork, watch: Watch, level: bigint): Promise<WatchedPrice> {
  const read = await nextPrice(fork, watch, watch.seen.length);
  return wholeTokenUsd(read) < level ? read : priceUnder(fork, watch, level);
}

// Takes half the WBNB out of ETH's pair with WBNB, as the pair itself, and syncs it: the price of
// ETH in BNB halves at the next block, with no trade.
async function halvePrice(fork: Fork): Promise<void> {
  const wbnb = bscToken("WBNB");
  const pair: Address = await fork.client.readContract({
    address: bscContract("pancakeswap", "v2-factory"),
    abi: pairAbi,
    functionName: "getPair",
    args: [eth, wbnb],
  });
  const held = await fork.client.readContract({
    address: wbnb,
    abi: pairAbi,
    functionName: "balanceOf",
    args: [pair],
  });
  await fork.call("anvil_impersonateAccount", [pair]);
  await fork.call("anvil_setBalance", [pair, toHex(tokenBase)]);
  const args = [fork.account, held / 2n] as const;
  const taken = encodeFunctionData({ abi: pairAbi, functionName: "transfer", args });
  await fork.send({ from: pair, to: wbnb, data: taken });
  await fork.call("anvil_stopImpersonatingAccount", [pair]);
  const sync = encodeFunctionData({ abi: pairAbi, functionName: "sync" });
  await fork.send({ from: fork.account, to: pair, data: sync });
}

// The model's one answer: a stop-loss that sells all the agent's ETH once its price falls to the
// level, in micro-dollars a whole ETH.
function stopLossReply(token: AssetRef, levelUsdMicros: bigint) {
  const order = {
    kind: "stopLoss",
    token,
    side: "sell",
    size: { percentBps: 10_000 },
    trigger: { price: levelUsdMicros.toString() },
    reason: "You asked for a stop-loss 10% under the price.",
  };
  return callsReply([{ name: "order_create", args: { order } }]);
}

// The paper ETH the stop-loss sells: a limit buy of 0.02 BNB of it at any price, created from the
// owner's CLI and confirmed there, which the watcher's next price fills.
async function buyOnPaper(machine: OrdersMachine, fork: Fork, watch: Watch): Promise<void> {
  const token = erc20AssetRef(fork.chain, eth);
  const request = {
    kind: "limit",
    agent: skeletonAgent,
    token,
    side: "buy",
    size: { base: 2n * 10n ** 16n },
    trigger: { price: 1n, direction: "above" },
    worstPrice: 10n ** 12n,
    reason: "Buy the token at any price",
  } as const;
  const created = await machine.client.call("order/create", request, live());
  const answeredBy = { surface: "cli", by: "cli" } as const;
  const confirm = { decision: "confirm", cardVersion: 1, answeredBy } as const;
  await machine.composed.engine.answer({ ...confirm, intent: created.intent ?? never() }, live());
  await nextPrice(fork, watch, 0);
  await Promise.all(watch.fills);
}

// The price watcher on the fork, handing each price to the engine's triggers at once.
function watchEth(machine: OrdersMachine, fork: Fork, signal: AbortSignal) {
  const seen: WatchedPrice[] = [];
  const fills: Watch["fills"][number][] = [];
  const watcher = watcherOn(fork);
  watcher.onPrice((read) => {
    seen.push(read);
    fills.push(machine.composed.engine.seePrice(orderPriceOf(read), { signal }));
  });
  watcher.watch(erc20AssetRef(fork.chain, eth));
  return { watch: { seen, fills }, running: watcher.run(signal).catch(() => undefined) };
}

/** The owner's chat with the agent: the bot, what it sent, and the agent's chat topic. */
interface OwnerChat {
  readonly bot: ComposedTelegram;
  readonly botApi: FakeBotApi;
  readonly chat: ChatWatch;
}

// The owner asks for the stop-loss; the agent's turn ends waiting on its card, which the owner
// taps: the last card in the chat.
async function stopLossFromChat(owner: OwnerChat): Promise<void> {
  const { bot, botApi, chat } = owner;
  await bot.ingress.receive(ownerText("Set a stop-loss on ETH 10% under the price", 1), live());
  await chat.turnsEnded(1);
  await bot.idle();
  const card = botApi.messages().findLast((message) => message.buttons.length > 0) ?? never();
  const data = card.buttons[0]?.[0]?.data ?? never();
  await bot.ingress.receive(
    botApi.press({ from: ownerId, data, messageId: card.messageId }),
    live(),
  );
}

// What the owner's chat showed, the agent's chat topic carried, and the engine stored.
async function reportOf(machine: OrdersMachine, owner: OwnerChat) {
  await machine.composed.notices.idle();
  await owner.bot.idle();
  const texts = owner.botApi.sent().map(({ text }) => text);
  const starts = owner.chat.pushes.filter(({ kind }) => kind === "chat/turnStarted");
  const orders = await machine.client.call("order/list", { agent: skeletonAgent }, live());
  const spent = await machine.stores.modelUsage.spent({ fromMs: 0, toMs: Date.now() + 1 }, live());
  return { texts, starts, orders: orders.items.map(({ kind, state }) => [kind, state]), spent };
}

describe("the orders skeleton on a BSC fork", () => {
  it("fills a stop-loss set in a Telegram chat with the runtime stopped and chat paused", async ({
    signal,
  }) =>
    withFork(signal, async (fork) => {
      const { botApi, telegram } = await ownerBot();
      const machine = await startOrdersMachine(fork, telegram);
      const stop = new AbortController();
      const { watch, running } = watchEth(machine, fork, AbortSignal.any([signal, stop.signal]));
      try {
        const { bot } = machine;
        bot.start();
        await machine.client.call("portfolio/resetPaper", { agent: skeletonAgent }, live());
        await buyOnPaper(machine, fork, watch);
        const level = (wholeTokenUsd(await nextPrice(fork, watch, watch.seen.length)) * 9n) / 10n;
        const chat = watchChat(machine.client, skeletonAgent);
        const script = { replies: [stopLossReply(erc20AssetRef(fork.chain, eth), level)], price };
        const runtime = superviseRuntime(machine, { turns: machine.turns, script });
        const owner = { bot, botApi, chat };
        await stopLossFromChat(owner);
        const active = await reportOf(machine, owner);
        await bot.ingress.receive(ownerText("Anything new?", 2), live());
        await chat.pushed("chat/status", 2);
        await bot.idle();
        await runtime.stop(AbortSignal.timeout(10_000));
        await halvePrice(fork);
        await priceUnder(fork, watch, level);
        const outcomes = (await Promise.all(watch.fills)).flat().map(({ outcome }) => outcome);
        const filled = await reportOf(machine, owner);

        expect(active.orders).toStrictEqual([
          ["limit", "filled"],
          ["stopLoss", "active"],
        ]);
        expect(filled.orders).toStrictEqual([
          ["limit", "filled"],
          ["stopLoss", "filled"],
        ]);
        expect(outcomes.filter((outcome) => outcome === "filled")).toHaveLength(2);
        expect(filled.starts).toHaveLength(1);
        expect(filled.spent.map(({ usdMicros }) => usdMicros)).toStrictEqual([6_000_000n]);
        expect(filled.texts).toContain(`${icons.waiting} Waiting for your answer on its card`);
        expect(filled.texts.filter((text) => told.test(text))).toHaveLength(1);
        expect(filled.texts.filter((text) => paused.test(text)).length).toBeGreaterThan(0);
        expect(filled.texts.at(-1)).toMatch(
          new RegExp(
            `^main · ${icons.paper} ${done} Stop-loss filled: sold [\\d.]+ ETH for \\$[\\d.,]+ at \\$[\\d.,]+$`,
            "u",
          ),
        );
      } finally {
        stop.abort();
        await running;
        await machine.close();
      }
    }));
});
