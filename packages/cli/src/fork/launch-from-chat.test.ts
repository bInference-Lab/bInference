import { setTimeout as wait } from "node:timers/promises";
import type { AssetRef } from "@binference/chain";
import { type Fork, withFork } from "@binference/chain-evm/fork";
import { BinferenceError, type Id } from "@binference/core";
import { apiAnswer, flapApiFake, pinAnswer } from "@binference/flap/testing";
import { callsReply, textReply } from "@binference/runtime/testing";
import type { FakeMessage } from "@binference/telegram/testing";
import { type Address, getAddress } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSignerBundle, type SignerBundle } from "../compose/test-signer-bundle.js";
import { ownerId, ownerPhoto, superviseRuntime, watchChat } from "../e2e/runtime-machine.js";
import { startMining } from "./executor-rig.js";
import { freshCid, onePixelPng } from "./flap-launch-parts.js";
import { type LaunchChatMachine, startLaunchChatMachine } from "./launch-chat-machine.js";
import { heldOn } from "./rescue-rig.js";

// The launch skeleton (decisions 0285 and 0286): the owner sends a photo and asks in Telegram (the
// synthetic Bot API) for a token named Fork Cat on Flap with a 0.01 BNB first buy. The scripted
// model drafts the launch with the agent's own tool; the bot shows the draft, and the owner's
// Start proposes it as the owner on Telegram. Flap's API (faked from its recorded answers, never
// reached) takes the photo and the words and reports the pin, the engine simulates the Portal's
// create call and opens its card in Telegram, and the owner's Confirm has the launch wallet sign
// it through the signer process and the Privy fake. The token and its first buy land on the fork.

const built: { bundle?: SignerBundle } = {};
const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(30_000) });
const photoId = "AgACAgIAAxkBAAIBforkcat";
const firstBuy = 10n ** 16n;
const done = String.fromCodePoint(0x2705);
const warning = `${String.fromCodePoint(0x26a0)}${String.fromCodePoint(0xfe0f)}`;

beforeAll(async () => {
  built.bundle = await buildSignerBundle("signer-launch-chat-");
}, 60_000);

afterAll(async () => {
  await built.bundle?.remove();
}, 60_000);

// The signer bundle's entry, which beforeAll built.
function signerEntry(): string {
  return built.bundle?.entry ?? never();
}

function never(): never {
  throw new BinferenceError({ code: "test.missing", message: "The fixture holds it." });
}

// The model's one call: the launch the owner asked for, its picture the owner's photo.
function draftReply(fork: Fork, taxRecipient: Address) {
  const coin = fork.chain.nativeAsset;
  const launch = {
    reason: "You asked for a token named Fork Cat on Flap with a 0.01 BNB first buy.",
    venue: "flap",
    name: "Fork Cat",
    symbol: "FCAT",
    description: "A cat launched on a fork",
    links: { website: "https://fork.example" },
    pairWith: coin,
    firstBuy: { asset: coin, base: firstBuy.toString() },
    venueOptions: {
      buyTaxBps: 300,
      sellTaxBps: 500,
      taxRecipient,
      burnShareBps: 1_000,
      taxDays: 365,
    },
  };
  return callsReply([{ name: "launch_draft", args: { launch, photo: 1 } }]);
}

// The newest message in the owner's chat whose first button's data starts so.
function withButton(machine: LaunchChatMachine, prefix: string): FakeMessage | undefined {
  return machine.botApi
    .messages()
    .findLast((message) => message.buttons[0]?.[0]?.data?.startsWith(prefix) === true);
}

// The owner presses the first button of the newest message that carries it.
async function pressFirst(machine: LaunchChatMachine, prefix: string): Promise<FakeMessage> {
  const message = withButton(machine, prefix) ?? never();
  const data = message.buttons[0]?.[0]?.data ?? never();
  const update = machine.botApi.press({ from: ownerId, data, messageId: message.messageId });
  await machine.bot.ingress.receive(update, live());
  await machine.bot.idle();
  return message;
}

// Follows the launch's pin as the engine's timer does, until its card reaches the owner's chat or
// a minute passes.
async function untilCard(machine: LaunchChatMachine, signal: AbortSignal): Promise<FakeMessage> {
  await machine.composed.engine.checkPins({ signal });
  await machine.bot.idle();
  const card = withButton(machine, "bnf1:c:y:");
  if (card !== undefined || signal.aborted) {
    return card ?? never();
  }
  await wait(500);
  return untilCard(machine, signal);
}

// Waits until the launch's intent ends in `state`, polling the store, for at most a minute.
async function until(
  machine: LaunchChatMachine,
  intent: Id<"int">,
  state: string,
): Promise<string> {
  const record = await machine.stores.intents.get(intent, live());
  if (record === undefined || record.state === state) {
    return record?.state ?? "missing";
  }
  await wait(250);
  return until(machine, intent, state);
}

// The launch the owner's Start proposed: the agent's one intent.
async function launchIntent(machine: LaunchChatMachine): Promise<Id<"int">> {
  const listed = await machine.client.call("intent/list", { agent: machine.agent }, live());
  return listed.items[0]?.intent ?? never();
}

// The token the launch made: the one ERC-20 its simulation received.
async function launchedToken(machine: LaunchChatMachine, intent: Id<"int">): Promise<Address> {
  const view = await machine.client.call("intent/get", { intent }, live());
  const minted: AssetRef | undefined = view.simulation?.received.find((amount) =>
    amount.asset.includes("erc20"),
  )?.asset;
  return getAddress(minted?.split(":").at(-1) ?? never());
}

describe("a token launch started from a Telegram chat on a BSC fork", () => {
  it("drafts the owner's launch, starts it on the owner's tap and lands its first buy", async ({
    signal,
  }) =>
    withFork(signal, async (fork) => {
      const cid = freshCid();
      const pins = [pinAnswer("processing", cid), pinAnswer("pinned", cid)];
      const api = flapApiFake(pins, apiAnswer(200, { data: { create: cid } }));
      const entry = signerEntry();
      const machine = await startLaunchChatMachine(fork, { entry, api }, signal);
      const miner = new AbortController();
      const mining = startMining(fork, miner.signal);
      const replies = [draftReply(fork, machine.rescue), textReply("Drafted. Tap Start launch.")];
      const runtime = superviseRuntime(machine, {
        turns: machine.turns,
        script: { replies, readsImages: true },
      });
      try {
        machine.bot.start();
        machine.botApi.addFile(photoId, { bytes: onePixelPng });
        const chat = watchChat(machine.client, machine.agent);
        const caption = "Launch a token named Fork Cat on Flap with a 0.01 BNB first buy";
        await machine.bot.ingress.receive(ownerPhoto({ fileId: photoId, caption }), live());
        await chat.turnsEnded(1);
        await machine.bot.idle();
        const draft = await pressFirst(machine, "bnf1:s:y:");
        const card = await untilCard(
          machine,
          AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
        );
        const intent = await launchIntent(machine);
        await pressFirst(machine, "bnf1:c:y:");
        await expect(until(machine, intent, "reconciled")).resolves.toBe("reconciled");
        await machine.bot.idle();
        const token = await launchedToken(machine, intent);

        // The draft showed every value the card carries from it, and nothing went out before Start.
        expect(draft.text.split("\n")).toStrictEqual(
          expect.arrayContaining([
            "curves drafted this token launch. Nothing is uploaded or public until you tap Start launch.",
            expect.stringMatching(
              /^Launch FCAT \(Fork Cat\) on flap, paired with BNB · first buy 0\.01 BNB$/u,
            ),
            "Description: A cat launched on a fork",
            "Website: https://fork.example",
            expect.stringMatching(
              /^Picture: your photo from the chat, PNG, 1 KB, SHA-256 [0-9a-f]{16}$/u,
            ),
            "Tax on every buy: 3.00%",
            "Tax on every sell: 5.00%",
            `${warning} Start launch makes the picture and words public on flap's storage at once, and they stay public if you cancel the card`,
          ]),
        );
        // The owner saw the photo Start publishes right above the draft, which replies to it.
        const photoMessage = machine.botApi.messages().find(({ file }) => file?.fileId === photoId);
        const draftSent = machine.botApi
          .sent()
          .find(({ text }) => text.startsWith("curves drafted"));
        expect([photoMessage?.file?.kind, draftSent?.replyTo]).toStrictEqual([
          "photo",
          photoMessage?.messageId,
        ]);
        // Only Flap's API was asked, after the tap: the upload, then the pin until it was pinned.
        expect(api.urls()).toStrictEqual([
          "https://funcs.flap.sh/api/upload",
          `https://funcs.flap.sh/api/v1/ipfs/pins?cid=${cid}`,
          `https://funcs.flap.sh/api/v1/ipfs/pins?cid=${cid}`,
        ]);
        // The owner's photo made the drafting turn outside content, so the launch's card warns.
        expect(card.text).toContain(`${warning} This came after reading outside content`);
        expect(card.text).toMatch(
          /Launch FCAT \(Fork Cat\) on flap, paired with BNB · first buy 0\.01 BNB/u,
        );
        // The draft's message and the card's became how each ended.
        const messages = machine.botApi.messages();
        expect(messages.find(({ messageId }) => messageId === draft.messageId)).toMatchObject({
          text: `${done} Launch started. Its card follows: confirm there before anything is signed.`,
          buttons: [],
        });
        // Once the launch landed, the card's message is its receipt: the token, the first buy, the
        // create call's link.
        const receipt = messages.find(({ messageId }) => messageId === card.messageId)?.text;
        const short = `${token.slice(0, 6)}…${token.slice(-4)}`;
        expect(receipt).toMatch(
          new RegExp(
            `^${done} Launched FCAT \\(${short}\\): first buy 0\\.01 BNB → [\\d.,]+[KMB]? FCAT \\(${short}\\) · https://bscscan\\.com/tx/0x[0-9a-f]{64}$`,
            "u",
          ),
        );
        // The token is new, at a Flap tax token's address, and the launch wallet holds its first buy.
        expect(token).toMatch(/7777$/u);
        expect(await fork.client.getCode({ address: token })).toMatch(/^0x[0-9a-f]{20,}/u);
        expect(
          (await heldOn(fork, { address: machine.launch.address, token })).token,
        ).toBeGreaterThan(0n);
      } finally {
        miner.abort();
        await mining;
        await runtime.stop(AbortSignal.timeout(10_000));
        await machine.stop();
      }
    }));
});
