import { type AccountRef, accountRefParts, assetRefParts } from "@binference/chain";
import { evmAccountRef } from "@binference/chain-evm";
import { bscContract, type Fork, withFork } from "@binference/chain-evm/fork";
import { shortAddress } from "@binference/i18n";
import type { IntentView } from "@binference/protocol";
import { callsReply, type InProcessRuntime, textReply } from "@binference/runtime/testing";
import { getAddress, type Hex, toHex } from "viem";
import { describe, expect, it } from "vitest";
import { ownerText, superviseRuntime, watchChat } from "../e2e/runtime-machine.js";
import { activeValidator } from "./active-validator.js";
import { startMining } from "./executor-rig.js";
import { type OwnerChatMachine, startOwnerChatMachine } from "./owner-chat-machine.js";
import {
  ask,
  type Chat,
  confirm,
  live,
  liveAgent as agent,
  messageText,
  never,
  newestIntent,
  until,
} from "./owner-chat-steps.js";

// The staking skeleton: the owner asks in Telegram (the synthetic Bot API) to stake, the scripted
// model proposes with the agent's `stake` tool, the card names the validator, and the owner's
// Confirm stakes through StakeHub on a BSC fork; `/positions` then shows the stake's receipt units.
// A second stake, over the per-trade cap, ends before any card with the cap as its reason, which
// the agent reads and tells the owner.

const bnb = 10n ** 18n;
const hub = bscContract("stakehub", "stake-hub");
const done = String.fromCodePoint(0x2705);
const liveMark = String.fromCodePoint(0x1f534);
const waiting = String.fromCodePoint(0x1f7e1);
const overCapWords = "I did not stake 2 BNB: it is over your per-trade cap.";

// The rig's main wallet, with no code and 5 BNB.
async function fundedMain(fork: Fork, machine: OwnerChatMachine) {
  const [main = never()] = machine.rig.rigWallets;
  await fork.call("anvil_setCode", [main.address, "0x"]);
  await fork.call("anvil_setBalance", [main.address, toHex(5n * bnb)]);
  return main;
}

// The model's answers, one a turn: the stake of 1 BNB; its words once the stake settles; the
// stake of 2 BNB, which the engine refuses; and its words once it reads the refusal.
function modelReplies(fork: Fork, validator: AccountRef) {
  const stake = (base: bigint, reason: string) => ({
    name: "stake",
    args: {
      venue: "stakehub",
      validator,
      amount: { asset: fork.chain.nativeAsset, base: base.toString() },
      reason,
    },
  });
  return [
    callsReply([stake(bnb, "You asked to stake 1 BNB.")]),
    textReply("Your 1 BNB is staked."),
    callsReply([stake(2n * bnb, "You asked to stake 2 BNB.")]),
    textReply(overCapWords),
  ];
}

// An account or a token as a card shows it: its short address.
function shortOf(address: string): string {
  return shortAddress(getAddress(address));
}

// The receipt units the stake reconciled with, from its view's execution.
function receiptUnitsOf(view: IntentView): string {
  const [execution] = view.outcome?.executions ?? [];
  return assetRefParts(execution?.amountOut.asset ?? never()).assetReference;
}

// "stake 1 BNB": the card names the validator with its commission and rate, and the 7 days a later
// unstake waits as StakeHub reads them on the fork; the owner's tap stakes 1 BNB through StakeHub,
// and the card ends with the receipt units it minted.
async function stakesOne(chat: Chat, validator: AccountRef): Promise<IntentView> {
  const { fork, machine } = chat;
  const short = shortOf(accountRefParts(validator).address);
  const step = await ask(chat, "stake 1 BNB", 1);
  const lines = step.card.text.split("\n");
  expect(lines.slice(0, 6)).toStrictEqual([
    `${waiting} Confirm stake · rescue 0 · ${liveMark} Live`,
    expect.stringMatching(new RegExp(`^Stake 1 BNB with .+ \\(${short}\\)$`, "u")),
    expect.stringMatching(
      new RegExp(`^Validator .+ \\(${short}\\) · commission \\d+\\.\\d{2}%$`, "u"),
    ),
    expect.stringMatching(/^Yearly rate \d+\.\d{2}%, from its last day of rewards$/u),
    "Unstaking later takes 7 days before you can claim it",
    'Agent says  "You asked to stake 1 BNB."',
  ]);
  await confirm(machine);
  await expect(until(machine, step.intent, "reconciled")).resolves.toBe("reconciled");
  await chat.turns.turnsEnded(2);
  await machine.bot.idle();
  const view = await machine.client.call("intent/get", { intent: step.intent }, live());
  const [hash = never()] = view.outcome?.txHashes ?? [];
  const sent = await fork.client.getTransaction({ hash: hash as Hex });
  expect([sent.to, sent.value]).toStrictEqual([hub.toLowerCase(), bnb]);
  const units = shortOf(receiptUnitsOf(view));
  expect(messageText(machine, step.card)).toMatch(
    new RegExp(
      `^${done} Done: 1 BNB → [\\d.]+ \\S+ \\(${units}\\) · https://bscscan\\.com/tx/${hash}$`,
      "u",
    ),
  );
  return view;
}

// `/positions` shows the live stake's receipt units as the engine's position of the wallet.
async function showsPosition(chat: Chat, staked: IntentView): Promise<void> {
  const { machine } = chat;
  const before = machine.botApi.messages().length;
  await machine.bot.ingress.receive(ownerText("/positions", 3), live());
  await machine.bot.idle();
  const units = shortOf(receiptUnitsOf(staked));
  const [shown] = machine.botApi.messages().slice(before);
  expect(shown?.text.split("\n").slice(0, 4)).toStrictEqual([
    `${liveMark} Live positions`,
    "",
    expect.stringMatching(new RegExp(`^\\S+ \\(${units}\\) · rescue 0 · ${liveMark} Live$`, "u")),
    expect.stringMatching(
      new RegExp(`^Holding [\\d.]+ \\S+ \\(${units}\\) · value \\$600\\.00$`, "u"),
    ),
  ]);
}

// "stake 2 BNB": $1,200 at the rig's BNB price, over the $1,000 per-trade cap, so it ends
// `rejected_policy` with no card. The proposal's answer names the cap as the reason, the engine
// tells the agent the intent ended, and the agent's next turn tells the owner.
async function refusesOverCap(chat: Chat, runtimes: readonly InProcessRuntime[]): Promise<void> {
  const { machine } = chat;
  await machine.bot.ingress.receive(ownerText("stake 2 BNB", 4), live());
  await chat.turns.turnsEnded(4);
  await machine.bot.idle();
  const refused = await newestIntent(machine);
  const view = await machine.client.call("intent/get", { intent: refused }, live());
  expect([view.state, view.outcome?.reason, view.card]).toStrictEqual([
    "rejected_policy",
    "per_trade_cap",
    undefined,
  ]);
  const asked = runtimes.flatMap(({ transports }) => transports.main.requests).at(-1);
  expect(JSON.stringify(asked?.messages)).toContain(
    `Intent ${refused} is in state rejected_policy with reason per_trade_cap.`,
  );
  expect(machine.botApi.messages().at(-1)?.text).toBe(`rescue 0 · ${overCapWords}`);
}

describe("a stake from a Telegram chat on a BSC fork", () => {
  it("stakes 1 BNB with a validator on the owner's tap, and refuses 2 BNB over the per-trade cap", async ({
    signal,
  }) =>
    withFork(signal, async (fork) => {
      const machine = await startOwnerChatMachine(fork, signal);
      const [venue = never()] = machine.stakingVenues;
      const main = await fundedMain(fork, machine);
      const wallet = evmAccountRef(fork.chain, main.address);
      const validator = await activeValidator(fork, { venue, wallet }, signal);
      const miner = new AbortController();
      const mining = startMining(fork, miner.signal);
      const runtimes: InProcessRuntime[] = [];
      const runtime = superviseRuntime(machine, {
        turns: machine.turns,
        script: { replies: modelReplies(fork, validator) },
        started: runtimes,
      });
      try {
        machine.bot.start();
        const chat = { fork, machine, turns: watchChat(machine.client, agent) };
        // The rig holds a second agent on paper, so the owner first picks the live one.
        await machine.bot.ingress.receive(ownerText(`/use ${agent}`, 1), live());
        await machine.bot.idle();

        const staked = await stakesOne(chat, validator);
        await showsPosition(chat, staked);
        await refusesOverCap(chat, runtimes);
        expect(runtimes).toHaveLength(1);
      } finally {
        miner.abort();
        await mining;
        await runtime.stop(AbortSignal.timeout(10_000));
        await machine.stop();
      }
    }));
});
