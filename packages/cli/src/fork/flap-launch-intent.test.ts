import { randomBytes } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { createEvmTxSimulator, erc20AssetRef, evmAccountRef } from "@binference/chain-evm";
import { bscContract, bscToken, type Fork, withFork } from "@binference/chain-evm/fork";
import { BinferenceError, type Id } from "@binference/core";
import { createFlapVenue } from "@binference/flap";
import { apiAnswer, type FlapApiFake, flapApiFake, pinAnswer } from "@binference/flap/testing";
import { cardLineText, createFormatter } from "@binference/i18n";
import type { CardView, IntentView, LaunchTokenRequest } from "@binference/protocol";
import { type Address, getAddress, parseAbi } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSignerBundle, type SignerBundle } from "../compose/test-signer-bundle.js";
import { createSystemRandom } from "../runtime/system-random.js";
import { startMining } from "./executor-rig.js";
import { flapSettingLinesZh, unboundFirstBuyZh } from "./flap-launch-card.zh.js";
import { type LaunchRig, launchRigOf, rigOwner } from "./launch-wallet-rig.js";
import { heldOn } from "./rescue-rig.js";

// A token launch on Flap through the engine's real launch path on a BSC fork (decisions 0234 to
// 0241, 0270, 0271): the owner proposes it from the CLI, Flap's API (faked, never reached) takes
// the picture and words and reports the pin, the engine simulates the Portal's create call, opens
// its card, and the agent's launch wallet signs it through the signer process and the Privy fake
// under the ceiling binference builds for it. The token and its first buy land on the fork.
const built: { bundle?: SignerBundle } = {};
const firstBuy = 10n ** 16n;
// The smallest PNG: its signature and a 1x1 image.
const png = Uint8Array.from(
  Buffer.from(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
      "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
    "hex",
  ),
);
const portal = bscContract("flap", "portal");
const portalAbi = parseAbi([
  "struct TokenStateV8Safe { uint8 status; uint256 reserve; uint256 circulatingSupply; uint256 price; uint8 tokenVersion; uint256 r; uint256 h; uint256 k; uint256 dexSupplyThresh; address quoteTokenAddress; bool nativeToQuoteSwapEnabled; bytes32 extensionID; uint256 buyTaxRate; uint256 sellTaxRate; address pool; uint256 progress; uint8 lpFeeTier; uint8 dexId; }",
  "function getTokenV8Safe(address token) view returns (TokenStateV8Safe state)",
]);

beforeAll(async () => {
  built.bundle = await buildSignerBundle("signer-flap-launch-");
}, 60_000);

afterAll(async () => {
  await built.bundle?.remove();
}, 60_000);

// A raw CIDv1 no launch used: every Flap token's metadata is its own.
function freshCid(): string {
  const letters = "abcdefghijklmnopqrstuvwxyz234567";
  return `bafkrei${[...randomBytes(52)].map((byte) => letters[byte % 32]).join("")}`;
}

// Flap on the fork, launching through a fake of Flap's API that reports the pin on its second read.
function flapOn(fork: Fork, api: FlapApiFake) {
  const { ref: chain, nativeAsset } = fork.chain;
  const quoteTokens = [bscToken("USDT"), bscToken("USD1")].map((token) =>
    erc20AssetRef(fork.chain, token),
  );
  const implementation = bscContract("flap", "tax-token-v3-implementation");
  return createFlapVenue({
    chains: [{ chain, nativeAsset, quoteTokens, rpc: fork.rpc }],
    launches: {
      http: api,
      random: createSystemRandom(),
      chains: [
        {
          chain,
          simulator: createEvmTxSimulator({ rpc: fork.rpc, chain: fork.chain }),
          taxTokenImplementation: evmAccountRef(fork.chain, implementation),
        },
      ],
    },
  });
}

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

// Follows the launch's pin as the engine's timer does, until its card opens or a minute passes.
async function untilCard(rig: LaunchRig, intent: Id<"int">, signal: AbortSignal): Promise<string> {
  await rig.engine.checkPins({ signal });
  const record = await rig.stores.intents.get(intent, { signal });
  const state = record?.state ?? "missing";
  if (state !== "quoted" || signal.aborted) {
    return state;
  }
  await wait(500);
  return untilCard(rig, intent, signal);
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

// The token's state on the Portal: its status, quote token and tax rates.
async function portalState(fork: Fork, token: Address) {
  const state = await fork.client.readContract({
    address: portal,
    abi: portalAbi,
    functionName: "getTokenV8Safe",
    args: [token],
  });
  const { status, quoteTokenAddress, buyTaxRate, sellTaxRate } = state;
  return { status, quoteTokenAddress, buyTaxRate, sellTaxRate };
}

function launchOf(rig: LaunchRig, fork: Fork): LaunchTokenRequest {
  const coin = fork.chain.nativeAsset;
  return {
    kind: "launchToken",
    agent: rig.agent,
    reason: "Launch the fork cat",
    venue: "flap",
    name: "Fork Cat",
    symbol: "FCAT",
    image: "upl_fork_cat",
    description: "A cat launched on a fork",
    links: { website: "https://fork.example" },
    pairWith: coin,
    firstBuy: { asset: coin, base: firstBuy },
    venueOptions: {
      buyTaxBps: 300,
      sellTaxBps: 500,
      taxRecipient: rig.rescue,
      burnShareBps: 1_000,
      taxDays: 365,
    },
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

/** The rig with its Flap launcher, Flap's API fake and the CID that fake answers. */
interface FlapRig {
  readonly rig: LaunchRig;
  readonly api: FlapApiFake;
  readonly cid: string;
}

// Runs `test` on a launch rig whose Flap launcher talks to a fake of Flap's API, mining as it goes.
async function onFlapRig(signal: AbortSignal, test: (flap: FlapRig, fork: Fork) => Promise<void>) {
  await withFork(signal, async (fork) => {
    const cid = freshCid();
    const pins = [pinAnswer("processing", cid), pinAnswer("pinned", cid)];
    const api = flapApiFake(pins, apiAnswer(200, { data: { create: cid } }));
    const images = new Map([["upl_fork_cat", png]]);
    const launcher = { venue: flapOn(fork, api), images };
    const rig = await launchRigOf(fork, { entry: built.bundle?.entry ?? "", launcher }, signal);
    const miner = new AbortController();
    const mining = startMining(fork, miner.signal);
    try {
      await test({ rig, api, cid }, fork);
    } finally {
      miner.abort();
      await mining;
      await rig.stop();
    }
  });
}

describe("a Flap launch on a BSC fork", () => {
  it("makes a tax token with its first buy from the launch wallet, through the intent path", async () => {
    const signal = AbortSignal.timeout(110_000);
    await onFlapRig(signal, async ({ rig, api, cid }, fork) => {
      const proposed = valueOf(
        await rig.engine.handlers["intent/propose"](call(launchOf(rig, fork), signal)),
      );
      expect(proposed.wallet).toBe(rig.launch.wallet);
      await expect(untilCard(rig, proposed.intent, signal)).resolves.toBe("awaiting_confirmation");
      // Only Flap's API was asked, never a gateway: the upload, then the pin until it was pinned.
      expect(api.urls()).toStrictEqual([
        "https://funcs.flap.sh/api/upload",
        `https://funcs.flap.sh/api/v1/ipfs/pins?cid=${cid}`,
        `https://funcs.flap.sh/api/v1/ipfs/pins?cid=${cid}`,
      ]);
      const { view, card, token, minted } = await readied(rig, proposed, signal);
      // A launch setting's account shows whole on the card.
      const recipient = rig.rescue;
      expect(await cardText(rig, view, "en")).toStrictEqual(
        expect.arrayContaining([
          "Tax on every buy: 3.00%",
          "Tax on every sell: 5.00%",
          `Tax paid to ${recipient}`,
          "Burned from the tax: 10.00%",
          "Tax lasts 365 days",
          expect.stringMatching(/^⚠️ The first buy has no minimum on chain/),
        ]),
      );
      expect(await cardText(rig, view, "zh")).toStrictEqual(
        expect.arrayContaining([
          ...flapSettingLinesZh(recipient),
          expect.stringMatching(unboundFirstBuyZh),
        ]),
      );
      const tap = { intent: view.intent, card: card.card, cardVersion: card.version };
      valueOf(await rig.engine.handlers["intent/confirm"](call(tap, signal)));
      await expect(until(rig, view.intent, "reconciled")).resolves.toBe("reconciled");
      // The token is new, Flap's, at a tax token's address, with the card's taxes, against BNB.
      expect(token).toMatch(/7777$/);
      expect(await fork.client.getCode({ address: token })).toMatch(/^0x[0-9a-f]{20,}/);
      expect(await portalState(fork, token)).toStrictEqual({
        status: 1,
        quoteTokenAddress: "0x0000000000000000000000000000000000000000",
        buyTaxRate: 300n,
        sellTaxRate: 500n,
      });
      // The launch wallet holds what the simulation showed its first buy gets.
      await expect(heldOn(fork, { address: rig.launch.address, token })).resolves.toMatchObject({
        token: minted,
      });
    });
  });
});
