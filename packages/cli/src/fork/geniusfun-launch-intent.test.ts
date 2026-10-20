import { setTimeout as wait } from "node:timers/promises";
import { bscContract, type Fork, withFork } from "@binference/chain-evm/fork";
import { BinferenceError, type Id } from "@binference/core";
import { cardLineText, createFormatter } from "@binference/i18n";
import {
  type CardView,
  type IntentView,
  type LaunchTokenRequest,
  noUploadImage,
} from "@binference/protocol";
import { type Address, getAddress, parseAbi } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSignerBundle, type SignerBundle } from "../compose/test-signer-bundle.js";
import { startMining } from "./executor-rig.js";
import { geniusfunSettingLinesZh } from "./geniusfun-launch-card.zh.js";
import { geniusfunOn } from "./launch-wallet-parts.js";
import { type LaunchRig, launchRigOf, rigOwner } from "./launch-wallet-rig.js";
import { heldOn } from "./rescue-rig.js";

// A token launch on Genius.fun through the engine's real launch path on a BSC fork (decisions 0234
// to 0241, 0275 to 0277): the owner proposes it from the CLI with a picture link they host, which
// nothing opens; nothing is uploaded and no pin is waited for; the engine simulates the router's
// `launchAndBuy`, opens its card, and the agent's launch wallet signs it through the signer
// process and the Privy fake under the ceiling binference builds for it. The token and its first
// buy land on the fork (gate Y7).
const built: { bundle?: SignerBundle } = {};
const firstBuy = 10n ** 16n;
const launchFee = 2n * 10n ** 15n;
const pictureLink = "ipfs://bafkreig7wwicvvvzrbrcgs62ybg7yc7f7ay6s6yhsgpxcxvan5owbcfefm";
const factory = bscContract("geniusfun", "factory-m4-2");
const readAbi = parseAbi([
  "struct LaunchedToken { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists; }",
  "function getLaunchedToken(address token) view returns (LaunchedToken launch)",
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "function getTokenInfo() view returns (address tokenDeployer, string tokenLogo, string tokenDescription, Socials tokenSocials)",
]);

beforeAll(async () => {
  built.bundle = await buildSignerBundle("signer-geniusfun-launch-");
}, 60_000);

afterAll(async () => {
  await built.bundle?.remove();
}, 60_000);

function call<Args>(args: Args, signal: AbortSignal) {
  return { args, caller: rigOwner, signal };
}

function valueOf<T>(
  result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string },
): T {
  if (!result.ok) {
    throw new BinferenceError({ code: "fork.refused", message: result.error });
  }
  return result.value;
}

// Waits until the intent reaches the state, polling the store, for at most a minute.
async function until(rig: LaunchRig, intent: Id<"int">, state: string): Promise<string> {
  const record = await rig.stores.intents.get(intent, { signal: AbortSignal.timeout(5_000) });
  if (record?.state === state || record === undefined) {
    return record?.state ?? "missing";
  }
  await wait(250);
  return until(rig, intent, state);
}

// The launch's card, line by line, in one language.
async function cardText(rig: LaunchRig, view: IntentView, locale: "en" | "zh") {
  const signal = AbortSignal.timeout(10_000);
  const drawn = valueOf(
    await rig.engine.handlers["intent/card"](call({ intent: view.intent }, signal)),
  );
  const display = { formatter: createFormatter({ locale, timeZone: "UTC" }), assets: drawn.assets };
  return drawn.lines.map((line) => cardLineText(line, display));
}

function launchOf(rig: LaunchRig, fork: Fork): LaunchTokenRequest {
  const coin = fork.chain.nativeAsset;
  return {
    kind: "launchToken",
    agent: rig.agent,
    reason: "Launch the fork genius",
    venue: "geniusfun",
    name: "Fork Genius",
    symbol: "FGEN",
    // A launchpad that takes a picture link names no upload (decision 0276).
    image: noUploadImage,
    description: "A token launched on a fork",
    links: { website: "https://fork.example", x: "https://x.com/forkgenius" },
    pairWith: coin,
    firstBuy: { asset: coin, base: firstBuy },
    venueOptions: { creatorFeeRecipient: rig.rescue, pictureLink },
  };
}

/** The launch as the engine readied it: its card, and the token its simulation got. */
interface Readied {
  readonly view: IntentView;
  readonly card: CardView;
  readonly token: Address;
  readonly minted: bigint;
}

// The launch's intent once its card opened: the token is the one ERC-20 its simulation received.
async function readied(rig: LaunchRig, view: IntentView, signal: AbortSignal): Promise<Readied> {
  const shown = valueOf(
    await rig.engine.handlers["intent/get"](call({ intent: view.intent }, signal)),
  );
  const minted = shown.simulation?.received.find((amount) => amount.asset.includes("erc20"));
  if (shown.card === undefined || minted === undefined) {
    throw new BinferenceError({ code: "fork.no_card", message: `No card: ${shown.state}.` });
  }
  const token = getAddress(minted.asset.split(":").at(-1) ?? "");
  return { view, card: shown.card, token, minted: minted.base };
}

// Runs `test` on a launch rig whose Genius.fun venue launches, mining as it goes.
async function onGeniusRig(
  signal: AbortSignal,
  test: (rig: LaunchRig, fork: Fork) => Promise<void>,
) {
  await withFork(signal, async (fork) => {
    const launcher = { venue: geniusfunOn(fork, { launches: true }), images: new Map() };
    const rig = await launchRigOf(fork, { entry: built.bundle?.entry ?? "", launcher }, signal);
    const miner = new AbortController();
    const mining = startMining(fork, miner.signal);
    try {
      await test(rig, fork);
    } finally {
      miner.abort();
      await mining;
      await rig.stop();
    }
  });
}

// What Genius.fun's factory and the new token say of the launch.
async function launchedOn(fork: Fork, token: Address) {
  const [launch, info] = await Promise.all([
    fork.client.readContract({
      address: factory,
      abi: readAbi,
      functionName: "getLaunchedToken",
      args: [token],
    }),
    fork.client.readContract({ address: token, abi: readAbi, functionName: "getTokenInfo" }),
  ]);
  const [, logo, description, socials] = info;
  return {
    exists: launch.exists,
    creatorFeeRecipient: launch.creatorFeeRecipient,
    pairToken: launch.pairToken,
    creatorTaxBps: launch.creatorTaxBps,
    buybackEnabled: launch.buybackEnabled,
    logo,
    description,
    website: socials.website,
    twitter: socials.twitter,
  };
}

describe("a geniusfun launch on a BSC fork", () => {
  it("makes a token with its first buy from the launch wallet, through the intent path", async () => {
    const signal = AbortSignal.timeout(110_000);
    await onGeniusRig(signal, async (rig, fork) => {
      const proposed = valueOf(
        await rig.engine.handlers["intent/propose"](call(launchOf(rig, fork), signal)),
      );
      expect(proposed.wallet).toBe(rig.launch.wallet);
      // Nothing to upload or pin: the card opens with the proposal.
      expect(proposed.state).toBe("awaiting_confirmation");
      const { view, card, token, minted } = await readied(rig, proposed, signal);
      // A launch setting's account shows whole on the card.
      const recipient = rig.rescue;
      expect(await cardText(rig, view, "en")).toStrictEqual(
        expect.arrayContaining([
          "Launch fee 0.002 BNB",
          `Creator fees from every trade wait on the launchpad until ${recipient} claims them; that address also buys free of the snipe tax`,
          `Picture at ${pictureLink} (binference never opens it)`,
          "Description: A token launched on a fork",
        ]),
      );
      expect(await cardText(rig, view, "zh")).toStrictEqual(
        expect.arrayContaining([...geniusfunSettingLinesZh(recipient, pictureLink)]),
      );
      const before = await fork.client.getBalance({ address: rig.launch.address });
      const tap = { intent: view.intent, card: card.card, cardVersion: card.version };
      valueOf(await rig.engine.handlers["intent/confirm"](call(tap, signal)));
      await expect(until(rig, view.intent, "reconciled")).resolves.toBe("reconciled");
      // The token is new, Genius.fun's, with the card's words, picture link and recipient.
      expect(await launchedOn(fork, token)).toStrictEqual({
        exists: true,
        creatorFeeRecipient: rig.rescue,
        pairToken: "0x0000000000000000000000000000000000000000",
        creatorTaxBps: 0,
        buybackEnabled: true,
        logo: pictureLink,
        description: "A token launched on a fork",
        website: "https://fork.example",
        twitter: "https://x.com/forkgenius",
      });
      // The launch wallet holds what the simulation showed its first buy gets, and paid the fee
      // and the first buy, with gas besides.
      await expect(heldOn(fork, { address: rig.launch.address, token })).resolves.toMatchObject({
        token: minted,
      });
      const after = await fork.client.getBalance({ address: rig.launch.address });
      expect(before - after > launchFee + firstBuy).toBe(true);
      expect(rig.refusals).toStrictEqual([]);
    });
  });
});
