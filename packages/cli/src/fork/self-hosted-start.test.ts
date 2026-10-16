import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { type AssetRef, accountRefParts } from "@binference/chain";
import { erc20AssetRef } from "@binference/chain-evm";
import {
  bscContract,
  bscToken,
  encodeFixtureRound,
  type Fork,
  withFork,
} from "@binference/chain-evm/fork";
import { bsc } from "@binference/chains";
import type { ProtocolClient } from "@binference/client";
import { BinferenceError, type Http, type Id } from "@binference/core";
import { disclaimerVersion } from "@binference/i18n";
import { readTextFile, writePrivateFile } from "@binference/platform";
import type { TempFolder } from "@binference/platform/testing";
import type { IntentView, PortfolioView } from "@binference/protocol";
import { type Address, erc20Abi, getAddress, parseAbi, toHex } from "viem";
import { afterEach, describe, expect, it } from "vitest";
import { type InitMachine, initFlags, newInitMachine, runOn } from "../e2e/init-fixtures.js";
import { connectClient, noPermissions } from "../e2e/test-host.js";
import { createRunningEngines } from "../e2e/unlock-fixtures.js";
import { createSystemClock } from "../runtime/system-clock.js";
import { createSystemHttp } from "../runtime/system-http.js";
import { startMining } from "./executor-rig.js";

// `binference start` as it composes itself, on the suite's BSC fork: its chain reads go to anvil,
// its relay to anvil, Privy to the machine's fake (which signs with each wallet's own key), the
// signer runs in this process, and KyberSwap's public API quotes and builds every trade, as the
// KyberSwap plugin's own fork test reads it. Nothing else is reached.
const kyberswapOrigin = "https://aggregator-api.kyberswap.com";
const privyOrigin = "https://api.privy.io";
const relay = "https://a.relay.test";
const spend = 10n ** 16n;
const usdt = bscToken("USDT");
const feedAbi = parseAbi([
  "function aggregator() view returns (address)",
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
]);
const terminal = new Set(["paper_filled", "reconciled", "failed_onchain", "failed_check"]);
const folders: TempFolder[] = [];
const engines = createRunningEngines();
const network = createSystemHttp({ version: "test" });

afterEach(async () => {
  await engines.stopAll();
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

function refused(url: string): BinferenceError {
  return new BinferenceError({
    code: "fork.call_refused",
    message: `The fork test reaches no ${new URL(url).host}.`,
    retryable: true,
  });
}

// What the engine reaches: anvil for its RPC and relay, the fake Privy, and KyberSwap's API.
function forkHttp(fork: Fork, privy: Http): Http {
  return {
    async request(request) {
      const url = new URL(request.url);
      if (url.origin === privyOrigin) {
        return privy.request(request);
      }
      if (url.origin === kyberswapOrigin) {
        return network.request(request);
      }
      if (url.origin === relay) {
        return fork.http.request({ ...request, url: fork.rpcUrl });
      }
      if (request.url.startsWith(fork.rpcUrl)) {
        return fork.http.request(request);
      }
      throw refused(request.url);
    },
  };
}

// BSC's RPC and relay point at the fork; the fee cap leaves room for anvil's priority fee.
async function pointAtFork(machine: InitMachine, fork: Fork): Promise<void> {
  const file = join(machine.folder, "config.json5");
  const read = await readTextFile(file, AbortSignal.timeout(5_000));
  const chains = {
    rpc: { [bsc.id]: { urls: [fork.rpcUrl] } },
    relays: { [bsc.id]: [relay] },
    maxFeePerGasGwei: { [bsc.id]: "10" },
  };
  const text = read.ok ? read.value.replace("{", `{\n  chains: ${JSON.stringify(chains)},`) : "";
  await writePrivateFile(file, text, {
    permissions: noPermissions,
    signal: AbortSignal.timeout(5_000),
  });
}

// The fork's feeds answer a fresh round at their answer now: their last update is up to a
// heartbeat older than the pinned block, which the price source would refuse as stale.
async function freshFeeds(fork: Fork): Promise<void> {
  const updatedAtSeconds = BigInt(Math.floor(Date.now() / 1_000));
  await Promise.all(
    ["bnb-usd", "usdt-usd"].map(async (name) => {
      const read = { address: bscContract("chainlink", name), abi: feedAbi } as const;
      const [aggregator, [, answer]] = await Promise.all([
        fork.client.readContract({ ...read, functionName: "aggregator" }),
        fork.client.readContract({ ...read, functionName: "latestRoundData" }),
      ]);
      const code = encodeFixtureRound({ answer, updatedAtSeconds });
      await fork.call("anvil_setCode", [aggregator, code]);
    }),
  );
}

interface Started {
  readonly client: ProtocolClient;
  /** BNB on the fork. */
  readonly coin: AssetRef;
  readonly agent: Id<"agt">;
  readonly wallet: Id<"wal">;
  readonly address: Address;
}

async function startOn(fork: Fork): Promise<Started> {
  const machine = await newInitMachine(folders, createSystemClock());
  const init = await runOn(machine, ["init", "--yes", ...initFlags(machine)]);
  expect(init.code).toBe(0);
  await pointAtFork(machine, fork);
  await freshFeeds(fork);
  const ready = await engines.start(machine, {
    parts: { http: forkHttp(fork, machine.privy.http) },
  });
  expect(ready).toMatchObject({ state: "ready" });
  const client = await connectClient(machine);
  const signal = AbortSignal.timeout(10_000);
  const [listed] = (await client.call("engine/status", {}, { signal })).agents;
  const [held] = (await client.call("wallet/list", {}, { signal })).items;
  if (listed === undefined || held === undefined) {
    throw new BinferenceError({ code: "fork.no_wallet", message: "init made no wallet." });
  }
  const address = getAddress(accountRefParts(held.address).address);
  return { client, coin: fork.chain.nativeAsset, agent: listed.id, wallet: held.wallet, address };
}

// Proposes a swap of 0.01 BNB for USDT and taps Confirm on its card.
async function buyUsdt(started: Started, bought: AssetRef): Promise<IntentView> {
  const { client, agent, wallet } = started;
  const signal = AbortSignal.timeout(30_000);
  const request = {
    kind: "swap",
    agent,
    wallet,
    reason: "Buy USDT on the fork",
    from: started.coin,
    to: bought,
    amount: { base: spend },
  } as const;
  const proposed = await client.call("intent/propose", request, { signal });
  const card = proposed.card;
  if (card === undefined) {
    throw new BinferenceError({
      code: "fork.no_card",
      message: `The swap opened no card: ${proposed.state} ${proposed.outcome?.reason ?? ""}.`,
    });
  }
  const tap = { intent: proposed.intent, card: card.card, cardVersion: card.version };
  return client.call("intent/confirm", tap, { signal });
}

async function settled(client: ProtocolClient, intent: IntentView["intent"]): Promise<IntentView> {
  const deadline = Date.now() + 30_000;
  const poll = async (): Promise<IntentView> => {
    const view = await client.call(
      "intent/get",
      { intent },
      { signal: AbortSignal.timeout(5_000) },
    );
    if (terminal.has(view.state) || Date.now() > deadline) {
      return view;
    }
    await wait(200);
    return poll();
  };
  return poll();
}

const modeOf = (balance: { readonly paper: boolean }): string => (balance.paper ? "paper" : "live");

// What the portfolio shows: each balance's mode in its order, the USDT it holds by mode, and the
// units of the live USDT position.
function heldOf(view: PortfolioView, bought: AssetRef) {
  const position = view.positions.find((item) => item.asset === bought && !item.paper);
  return {
    modes: view.balances.map(modeOf),
    usdt: view.balances
      .filter(({ amount }) => amount.asset === bought)
      .map((balance) => [modeOf(balance), balance.amount.base] as const),
    livePosition: position?.quantity,
  };
}

describe("binference start on the BSC fork", () => {
  it("fills a paper swap and sends, settles and records a live one, shown in the portfolio", async ({
    signal,
    annotate,
  }) =>
    withFork(signal, async (fork) => {
      const started = await startOn(fork);
      const { client, agent, address } = started;
      await annotate(`fork block ${fork.block.toString()}`);
      const bought = erc20AssetRef(fork.chain, usdt);
      const call = { signal: AbortSignal.timeout(30_000) };

      await client.call("portfolio/resetPaper", { agent }, call);
      const paper = await settled(client, (await buyUsdt(started, bought)).intent);
      expect(paper.state).toBe("paper_filled");

      await fork.call("anvil_setCode", [address, "0x"]);
      await fork.call("anvil_setBalance", [address, toHex(10n ** 18n)]);
      const miner = new AbortController();
      const mining = startMining(fork, miner.signal);
      try {
        await client.call("agent/goLive", { agent, disclaimer: disclaimerVersion }, call);
        const live = await settled(client, (await buyUsdt(started, bought)).intent);
        expect(live.state).toBe("reconciled");
      } finally {
        miner.abort();
        await mining;
      }

      const onChain = await fork.client.readContract({
        address: usdt,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      });
      expect(onChain).toBeGreaterThan(0n);
      const view = await client.call("portfolio/get", { agent }, call);
      const held = heldOf(view, bought);
      expect(held.modes.indexOf("paper")).toBeGreaterThan(held.modes.lastIndexOf("live"));
      expect(held.usdt).toStrictEqual([
        ["live", onChain],
        ["paper", expect.any(BigInt)],
      ]);
      expect(held.usdt[1]?.[1]).toBeGreaterThan(500n * 10n ** 18n);
      expect(held.livePosition).toBe(onChain);
      expect(view.totalUsdMicros).toBeGreaterThan(0n);
      expect(view.paperTotalUsdMicros).toBeGreaterThan(1_000_000_000n);
    }));
});
