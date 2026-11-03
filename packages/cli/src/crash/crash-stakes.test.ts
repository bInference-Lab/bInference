import { accountRefSchema, assetRefSchema } from "@binference/chain";
import { bsc } from "@binference/chains";
import type { Id, JsonValue } from "@binference/core";
import type { ProtocolId } from "@binference/protocol";
import { createSqlitePositionStore } from "@binference/store";
import { encodeFunctionData, erc20Abi } from "viem";
import { beforeAll, describe, expect, inject, it, onTestFailed } from "vitest";
import { z } from "zod";
import type { CrashContext } from "./crash-context.js";
import { useCrashHarness } from "./crash-harness.js";
import {
  crashIntentOnce,
  type IntentRun,
  oneStepKillCases,
  sentOnceOf,
  sentSummaryOf,
} from "./crash-intent-runs.js";
import { crashSlisBnb, installCrashLista } from "./crash-lista.js";
import { hashesOf, withStore } from "./crash-reads.js";
import type { CrashInstall, CrashRequestOf, CrashWorld } from "./crash-runs.js";
import {
  type CrashStakeHub,
  crashStakeHub,
  crashValidator,
  installCrashStakeHub,
} from "./crash-stake-hub.js";

// Each run stakes, unstakes or claims with StakeHub, or stakes with Lista, from a fresh install as
// the owner does from the CLI, and kills the engine outright at the run's point between the
// signature and the send, between the send and the receipt, or once the receipt is stored; a second
// engine on the same folder recovers and books the move. StakeHub and Lista's stake manager stand
// in on the bare chain beside models of their state. What reached the chain is counted by the
// test's relays and anvil, the signatures by the test's Privy, the bookings read from the store.
const crash: CrashContext = inject("crash");
const harness = useCrashHarness(crash, { seed: 43 });
const runs = Array.from({ length: crash.runs }, (_, index) => index + 1);
const held: { hub?: CrashStakeHub } = {};

beforeAll(async () => {
  const { chain } = harness.worldOf();
  const anvil = async (method: string, params: readonly JsonValue[]) => chain.call(method, params);
  held.hub = await installCrashStakeHub(anvil);
  chain.serve(held.hub.standIn);
  chain.serve(await installCrashLista(anvil));
});

function hubOf(): CrashStakeHub {
  if (held.hub === undefined) {
    throw new Error("StakeHub was not installed.");
  }
  return held.hub;
}

const validator = accountRefSchema.parse(`${bsc.id}:${crashValidator.operator}`);
const coin = assetRefSchema.parse(`${bsc.id}/slip44:714`);
const stakeAmount = 10n ** 16n;

function moveOf(action: "stake" | "unstake" | "claim"): CrashRequestOf {
  return (agent: ProtocolId<"agent">) => ({
    kind: "stake",
    agent,
    reason: `The crash chain's ${action}`,
    action,
    venue: "stakehub",
    validator,
    ...(action === "stake" ? { amount: { asset: coin, base: stakeAmount } } : {}),
  });
}

/** A staking move a run makes, by the name its kill points carry. */
interface StakeRun extends IntentRun {
  readonly name: string;
}

const hexSchema = z.string().regex(/^0x[0-9a-f]*$/u);

// What StakeHub holds in coin on the crash chain.
async function hubCoin(world: CrashWorld): Promise<bigint> {
  return BigInt(
    hexSchema.parse(await world.chain.call("eth_getBalance", [crashStakeHub, "latest"])),
  );
}

// The unbondings the store opened for the intent that no claim took.
async function unbondingsOf(folder: string, intent: Id<"int">): Promise<number> {
  return withStore(folder, async (stores, signal) => {
    const record = await stores.intents.get(intent, { signal });
    if (record === undefined) {
      return 0;
    }
    const query = { walletId: record.walletId, isPaper: false };
    const open = await stores.unbondings.openOf(query, { signal });
    return open.filter(({ intentId }) => intentId === intent).length;
  });
}

const stake: StakeRun = {
  name: "a stake with StakeHub",
  executions: 1,
  requestOf: moveOf("stake"),
  // StakeHub takes the stake's coin once.
  effect: { read: hubCoin, moves: stakeAmount },
};

// The wallet holds 0.05 BNB staked with the validator, as a stake made earlier.
const staked = 5n * stakeAmount;

const unstake: StakeRun = {
  name: "an unstake from StakeHub",
  executions: 1,
  requestOf: moveOf("unstake"),
  prepare: async (_world, install) => {
    hubOf().seed(install.from, { staked });
    return install.from;
  },
  // The whole stake waits in the validator's queue once, and the store opens its unbonding once.
  effect: {
    read: async (_world, install) => Promise.resolve(hubOf().unbonding(install.from)),
    moves: staked,
  },
  rows: { read: unbondingsOf, landed: 1 },
};

// The arrivals the store booked from the intent's transactions.
async function arrivalsOf(folder: string, intent: Id<"int">): Promise<number> {
  const hashes = new Set(await hashesOf(folder, intent));
  return withStore(folder, async (_stores, signal, database) => {
    const page = { after: 0, limit: 100, isPaper: false };
    const arrivals = await createSqlitePositionStore(database).arrivals(page, { signal });
    return arrivals.filter(({ txHash }) => txHash !== undefined && hashes.has(txHash)).length;
  });
}

const claim: StakeRun = {
  name: "a claim from StakeHub",
  executions: 0,
  requestOf: moveOf("claim"),
  prepare: async (_world, install) => {
    hubOf().seed(install.from, { staked: 0n, ready: staked });
    return install.from;
  },
  // StakeHub pays the unstake's coin out once, and the store books its arrival once.
  effect: { read: hubCoin, moves: -staked },
  rows: { read: arrivalsOf, landed: 1 },
};

// The slisBNB units the run's wallet holds on the crash chain.
async function slisBnbOf(world: CrashWorld, install: CrashInstall): Promise<bigint> {
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [install.from],
  });
  return BigInt(
    hexSchema.parse(await world.chain.call("eth_call", [{ to: crashSlisBnb, data }, "latest"])),
  );
}

const liquidStake: StakeRun = {
  name: "a stake with Lista",
  executions: 1,
  requestOf: (agent) => ({
    kind: "stake",
    agent,
    reason: "The crash chain's stake with Lista",
    action: "stake",
    venue: "lista",
    amount: { asset: coin, base: stakeAmount },
  }),
  // The stake manager mints the wallet a slisBNB unit per wei once.
  effect: { read: slisBnbOf, moves: stakeAmount },
};

// Between the signature and the send, between the send and the receipt, and once the receipt
// is stored, before the move is booked.
const { signed, stored, sent, included, receipt } = oneStepKillCases;
const cases = [stake, unstake, claim, liquidStake].flatMap((run) =>
  [signed, stored, sent, included, receipt].map((killCase) =>
    Object.assign({ run, name: run.name }, killCase),
  ),
);

describe.each(cases)("an engine killed at $point during $name", (killCase) => {
  it.each(runs)("sends one transaction at most and books it once, run %i", async () => {
    const outcome = await crashIntentOnce(harness, killCase.run, killCase);
    onTestFailed(() => {
      process.stderr.write(`${outcome.story}\n`);
    });
    expect(sentSummaryOf(outcome)).toStrictEqual(sentOnceOf(killCase, killCase.run));
  });
});
