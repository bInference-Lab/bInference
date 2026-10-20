import { setTimeout as wait } from "node:timers/promises";
import { type AssetRef, accountRefSchema } from "@binference/chain";
import { erc20AssetRef, evmAccountRef } from "@binference/chain-evm";
import { bscContract, bscToken, type Fork, withFork } from "@binference/chain-evm/fork";
import { BinferenceError, type Id } from "@binference/core";
import { cardLineText, createFormatter } from "@binference/i18n";
import type { CardView, IntentView, LaunchTokenRequest } from "@binference/protocol";
import {
  type Address,
  encodeAbiParameters,
  erc20Abi,
  getAddress,
  type Hex,
  keccak256,
  parseAbi,
  parseAbiParameters,
  toHex,
} from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSignerBundle, type SignerBundle } from "../compose/test-signer-bundle.js";
import { brewSettingLinesZh } from "./brew-launch-card.zh.js";
import { startMining } from "./executor-rig.js";
import { brewOn } from "./launch-wallet-parts.js";
import { type LaunchRig, launchRigOf, rigOwner } from "./launch-wallet-rig.js";
import { heldOn } from "./rescue-rig.js";

// A token launch on Brew through the engine's real launch path on a BSC fork (decisions 0278 to
// 0283): the owner proposes it from the CLI with a small picture of their own, which the create
// call writes into the token's metadata; nothing is uploaded and no pin is waited for; the engine
// simulates BrewFactory's `launch`, opens its card, and the agent's launch wallet signs it through
// the signer process and the Privy fake under the ceiling binference builds for it. The token,
// its pool and its first buy land on the fork, and the factory records the launch (gate Y7).
const built: { bundle?: SignerBundle } = {};
const firstBuyBnb = 10n ** 16n;
const firstBuyUsdt = 10n * 10n ** 18n;
const factory = bscContract("brew", "factory");
const locker = bscContract("brew", "locker");
const distributorFactory = bscContract("brew", "distributor-factory");
// A 1 by 1 PNG, the owner's picture.
const picture = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const readAbi = parseAbi([
  "function launches(address token) view returns (address token, address quoteToken, address pool, address creator, uint24 fee, uint64 launchedAtBlock)",
  "function metadataURI() view returns (string)",
  "function positionsOf(address token) view returns (uint256[])",
  "function lockedPositions(uint256 id) view returns (address token, address creatorFeeRecipient, uint16 protocolFeeBps)",
  "function predict(address token) view returns (address)",
]);

beforeAll(async () => {
  built.bundle = await buildSignerBundle("signer-brew-launch-");
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

async function cardText(rig: LaunchRig, view: IntentView, locale: "en" | "zh") {
  const signal = AbortSignal.timeout(10_000);
  const drawn = valueOf(
    await rig.engine.handlers["intent/card"](call({ intent: view.intent }, signal)),
  );
  const display = { formatter: createFormatter({ locale, timeZone: "UTC" }), assets: drawn.assets };
  return drawn.lines.map((line) => cardLineText(line, display));
}

function launchOf(
  rig: LaunchRig,
  fork: Fork,
  launch: {
    readonly firstBuy: { readonly asset: AssetRef; readonly base: bigint };
    readonly venueOptions: LaunchTokenRequest["venueOptions"];
  },
): LaunchTokenRequest {
  return {
    kind: "launchToken",
    agent: rig.agent,
    reason: "Launch the fork brew",
    venue: "brew",
    name: "Fork Brew",
    symbol: "FBREW",
    image: "upl_brew",
    description: "A token launched on a fork",
    links: { website: "https://fork.example", x: "https://x.com/forkbrew" },
    pairWith: launch.firstBuy.asset,
    firstBuy: launch.firstBuy,
    ...(launch.venueOptions === undefined ? {} : { venueOptions: launch.venueOptions }),
  };
}

/** The launch as the engine readied it: its card, and the token its simulation got. */
interface Readied {
  readonly view: IntentView;
  readonly card: CardView;
  readonly token: Address;
  readonly minted: bigint;
}

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

async function onBrewRig(signal: AbortSignal, test: (rig: LaunchRig, fork: Fork) => Promise<void>) {
  await withFork(signal, async (fork) => {
    const launcher = { venue: brewOn(fork), images: new Map([["upl_brew", picture]]) };
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

// What BrewFactory records of a launch, and the fee recipient its one locked position names.
async function launchedOn(fork: Fork, token: Address) {
  const { client } = fork;
  const [record, metadataURI, positions] = await Promise.all([
    client.readContract({
      address: factory,
      abi: readAbi,
      functionName: "launches",
      args: [token],
    }),
    client.readContract({ address: token, abi: readAbi, functionName: "metadataURI" }),
    client.readContract({
      address: locker,
      abi: readAbi,
      functionName: "positionsOf",
      args: [token],
    }),
  ]);
  const [first = 0n] = positions;
  const [, feeRecipient] = await client.readContract({
    address: locker,
    abi: readAbi,
    functionName: "lockedPositions",
    args: [first],
  });
  const [recorded, quoteToken, pool, creator, fee] = record;
  return {
    recorded,
    quoteToken,
    pool,
    creator,
    fee,
    metadataURI,
    positions: positions.length,
    feeRecipient,
  };
}

// The document a token's metadata address holds.
function documentOf(metadataURI: string): unknown {
  const [, encoded] = metadataURI.split(",");
  return JSON.parse(Buffer.from(encoded ?? "", "base64").toString());
}

// The factory's logs in the transaction the launch landed in.
async function factoryLogsOf(
  rig: LaunchRig,
  landed: { readonly fork: Fork; readonly intent: Id<"int"> },
  signal: AbortSignal,
) {
  const shown = valueOf(
    await rig.engine.handlers["intent/get"](call({ intent: landed.intent }, signal)),
  );
  const [hash] = shown.outcome?.txHashes ?? [];
  if (hash === undefined) {
    throw new BinferenceError({ code: "fork.no_hash", message: "The launch landed no step." });
  }
  const receipt = await landed.fork.client.getTransactionReceipt({ hash: hash as Hex });
  return receipt.logs.filter((log) => getAddress(log.address) === factory);
}

const usdt = bscToken("USDT");
// BSC's USDT keeps its balances in the mapping at slot 1.
async function fundUsdt(fork: Fork, holder: Address, amount: bigint): Promise<void> {
  const slot = keccak256(encodeAbiParameters(parseAbiParameters("address, uint256"), [holder, 1n]));
  await fork.call("anvil_setStorageAt", [usdt, slot, toHex(amount, { size: 32 })]);
}

describe("a brew launch on a BSC fork", () => {
  it("makes a token with its first buy from the launch wallet, through the intent path", async () => {
    const signal = AbortSignal.timeout(115_000);
    await onBrewRig(signal, async (rig, fork) => {
      const recipient = rig.rescue;
      const firstBuy = { asset: fork.chain.nativeAsset, base: firstBuyBnb };
      const request = launchOf(rig, fork, {
        firstBuy,
        venueOptions: { poolFeeRecipient: recipient },
      });
      const proposed = valueOf(await rig.engine.handlers["intent/propose"](call(request, signal)));
      expect(proposed.wallet).toBe(rig.launch.wallet);
      // Nothing to upload or pin: the card opens with the proposal.
      expect(proposed.state).toBe("awaiting_confirmation");
      const { view, card, token, minted } = await readied(rig, proposed, signal);
      expect(token.toLowerCase().endsWith("6666")).toBe(true);
      expect(await cardText(rig, view, "en")).toStrictEqual(
        expect.arrayContaining([
          "Launch fee 0 BNB",
          `Creator fees from the pool wait in Brew's locker until ${recipient} claims them`,
          "Holder rewards: off",
          "Starts at a market cap of about 8 BNB, rounded down to the pool's next price step",
          "Description: A token launched on a fork",
          "⚠️ Brew's site says it is not available to U.S. citizens",
          expect.stringMatching(
            /^Picture written on chain with the token: PNG, 70 bytes, 1 x 1 pixels/,
          ),
        ]),
      );
      expect(await cardText(rig, view, "zh")).toStrictEqual(
        expect.arrayContaining([...brewSettingLinesZh(recipient)]),
      );
      const tap = { intent: view.intent, card: card.card, cardVersion: card.version };
      valueOf(await rig.engine.handlers["intent/confirm"](call(tap, signal)));
      await expect(until(rig, view.intent, "reconciled")).resolves.toBe("reconciled");
      // BrewFactory records the launch: its token, WBNB, a 1% pool, the launch wallet as creator,
      // the owner's fee recipient on its one locked position, and the card's words and picture.
      const launched = await launchedOn(fork, token);
      expect(launched).toMatchObject({
        recorded: token,
        quoteToken: bscToken("WBNB"),
        creator: rig.launch.address,
        fee: 10_000,
        positions: 1,
        feeRecipient: recipient,
      });
      expect(documentOf(launched.metadataURI)).toStrictEqual({
        v: 1,
        description: "A token launched on a fork",
        website: "https://fork.example",
        twitter: "https://x.com/forkbrew",
        image: `data:image/png;base64,${picture.toString("base64")}`,
      });
      // The launch wallet holds what the simulation showed its first buy gets.
      await expect(heldOn(fork, { address: rig.launch.address, token })).resolves.toMatchObject({
        token: minted,
      });
      // The launch feed reads the launch from the factory's own logs, with its first buy's
      // recipient as insider.
      const logs = await factoryLogsOf(rig, { fork, intent: view.intent }, signal);
      const found = brewOn(fork).readLaunches?.({
        chain: fork.chain.ref,
        contracts: { factory: evmAccountRef(fork.chain, factory) },
        logs: logs.map((log) => ({
          emitter: accountRefSchema.parse(`${fork.chain.ref}:${log.address}`),
          topics: log.topics,
          data: log.data,
          index: log.logIndex,
        })),
      });
      expect(found?.launches.map(({ token: made, insiders }) => [made, insiders])).toContainEqual([
        erc20AssetRef(fork.chain, token),
        [evmAccountRef(fork.chain, rig.launch.address)],
      ]);
      expect(rig.refusals).toStrictEqual([]);
    });
  });

  it("makes a token against USDT with holder rewards, after an exact approval of the factory", async () => {
    const signal = AbortSignal.timeout(115_000);
    await onBrewRig(signal, async (rig, fork) => {
      await fundUsdt(fork, rig.launch.address, firstBuyUsdt);
      const pair = erc20AssetRef(fork.chain, usdt);
      const firstBuy = { asset: pair, base: firstBuyUsdt };
      const request = launchOf(rig, fork, { firstBuy, venueOptions: { holderRewards: true } });
      const proposed = valueOf(await rig.engine.handlers["intent/propose"](call(request, signal)));
      expect(proposed).toMatchObject({ state: "awaiting_confirmation" });
      const { view, card, token, minted } = await readied(rig, proposed, signal);
      const lines = await cardText(rig, view, "en");
      expect(lines).toStrictEqual(
        expect.arrayContaining([
          "Starts at a market cap of about 5,000 USDT, rounded down to the pool's next price step",
        ]),
      );
      const tap = { intent: view.intent, card: card.card, cardVersion: card.version };
      valueOf(await rig.engine.handlers["intent/confirm"](call(tap, signal)));
      await expect(until(rig, view.intent, "reconciled")).resolves.toBe("reconciled");
      // The factory pulled exactly the first buy and left no allowance; the creator's fees go to
      // the token's holder distributor.
      const [balance, allowance, distributor] = await Promise.all([
        fork.client.readContract({
          address: usdt,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [rig.launch.address],
        }),
        fork.client.readContract({
          address: usdt,
          abi: erc20Abi,
          functionName: "allowance",
          args: [rig.launch.address, factory],
        }),
        fork.client.readContract({
          address: distributorFactory,
          abi: readAbi,
          functionName: "predict",
          args: [token],
        }),
      ]);
      expect({ balance, allowance }).toStrictEqual({ balance: 0n, allowance: 0n });
      // The card named that distributor whole.
      const shown = `Creator fees from the pool go to the token's holder distributor, ${distributor}`;
      expect(lines.map((line) => line.toLowerCase())).toContain(shown.toLowerCase());
      await expect(launchedOn(fork, token)).resolves.toMatchObject({
        recorded: token,
        quoteToken: usdt,
        feeRecipient: distributor,
      });
      await expect(heldOn(fork, { address: rig.launch.address, token })).resolves.toMatchObject({
        token: minted,
      });
      expect(rig.refusals).toStrictEqual([]);
    });
  });
});
