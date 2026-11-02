import { type AccountRef, accountRefSchema, assetRefSchema } from "@binference/chain";
import { bscContract, bscToken, type Fork, withFork } from "@binference/chain-evm/fork";
import type { StakingVenue } from "@binference/chain/staking";
import { BinferenceError } from "@binference/core";
import { createListaVenue } from "@binference/lista";
import type { IntentRequest } from "@binference/protocol";
import { type Address, erc20Abi, pad, parseAbi, toHex } from "viem";
import { describe, expect, it } from "vitest";
import { startMining } from "./executor-rig.js";
import { rescueAgents } from "./rescue-rig-parts.js";
import { rescueRigOf } from "./rescue-rig.js";
import { proposeOn } from "./rig-calls.js";
import { fundedMain, tappedOn } from "./stake-rig-steps.js";

// A stake of BNB for slisBNB, an unstake of the whole slisBNB and its claim, through the engine and
// its executor on a fork of BSC: each planned through Lista's stake manager before its card,
// planned again as the queue takes it, signed by the wallet's key, and reconciled from what the
// stake manager reads back of the landed move (decisions 0331 and 0332).
const manager = bscContract("lista", "stake-manager");
const slisBnb = bscToken("slisBNB");
const hub = bscContract("stakehub", "stake-hub");
const multicall = bscContract("multicall3", "multicall3");
const bnb = 10n ** 18n;
const [agent] = rescueAgents;

// Lista's bot marks requests claimable by raising `nextConfirmedRequestUUID`, which sits in the
// stake manager's slot 205 (read on BSC on 2026-11-02 beside `requestUUID` in slot 204). The test
// raises it past its own request, as the bot does once StakeHub's unbonding is done.
const nextConfirmedSlot = toHex(205, { size: 32 });
const managerAbi = parseAbi([
  "function nextConfirmedRequestUUID() view returns (uint256)",
  "function getUserWithdrawalRequests(address) view returns ((uint256 uuid, uint256 amountInSnBnb, uint256 startTime)[])",
]);

const accountOf = (fork: Fork, address: Address): AccountRef =>
  accountRefSchema.parse(`${fork.chain.ref}:${address}`);

function listaOn(fork: Fork): StakingVenue {
  return createListaVenue({
    chain: fork.chain.ref,
    coin: fork.chain.nativeAsset,
    receipt: assetRefSchema.parse(`${fork.chain.ref}/erc20:${slisBnb}`),
    rpc: fork.rpc,
    contracts: { "stake-manager": accountOf(fork, manager) },
    stakeHub: accountOf(fork, hub),
    multicall: accountOf(fork, multicall),
  });
}

function listaRequest(
  action: "stake" | "unstake" | "claim",
  fork: Fork,
  base?: bigint,
): IntentRequest {
  if (agent === undefined) {
    throw new BinferenceError({ code: "fork.no_agent", message: "The rig has no agent." });
  }
  const request = {
    kind: "stake",
    agent,
    reason: "Earn on idle BNB",
    action,
    venue: "lista",
  } as const;
  return base === undefined
    ? request
    : { ...request, amount: { asset: fork.chain.nativeAsset, base } };
}

// Raises the stake manager's confirmed request id past the wallet's newest request, as Lista's bot
// does once it unbonded enough, after checking the slot holds what the stake manager answers.
async function releaseQueue(fork: Fork, wallet: Address): Promise<void> {
  const read = { address: manager, abi: managerAbi } as const;
  const confirmed = await fork.client.readContract({
    ...read,
    functionName: "nextConfirmedRequestUUID",
  });
  const held = await fork.client.getStorageAt({ address: manager, slot: nextConfirmedSlot });
  expect(BigInt(held ?? "0x0")).toBe(confirmed);
  const requests = await fork.client.readContract({
    ...read,
    functionName: "getUserWithdrawalRequests",
    args: [wallet],
  });
  const newest = requests.reduce((top, { uuid }) => (uuid > top ? uuid : top), 0n);
  await fork.call("anvil_setStorageAt", [manager, nextConfirmedSlot, pad(toHex(newest + 1n))]);
}

async function slisBnbOf(fork: Fork, wallet: Address): Promise<bigint> {
  return fork.client.readContract({
    address: slisBnb,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [wallet],
  });
}

describe("staking BNB for slisBNB through the engine on the BSC fork", () => {
  it("refuses a stake over the per-trade cap, stakes 1 BNB, unstakes its slisBNB, then claims once Lista releases it", async ({
    signal,
  }) => {
    await withFork(signal, async (fork) => {
      const venue = listaOn(fork);
      const rig = await rescueRigOf(fork, { stakingVenues: [venue] });
      const main = await fundedMain(fork, rig);
      const miner = new AbortController();
      const mining = startMining(fork, miner.signal);
      try {
        const over = await proposeOn(rig, listaRequest("stake", fork, 2n * bnb), signal);
        expect([over.state, over.outcome?.reason]).toStrictEqual([
          "rejected_policy",
          "per_trade_cap",
        ]);

        const staked = await tappedOn(rig, listaRequest("stake", fork, bnb), signal);
        expect(staked.lines[1]).toMatch(/^Stake 1 BNB with Lista for at least 0\.9\d+ slisBNB/u);
        expect(staked.lines[2]).toBe("Unstaking later takes 7 days before you can claim it");
        expect(staked.state).toBe("reconciled");
        const minted = await slisBnbOf(fork, main.address);
        expect(minted).toBeGreaterThan((bnb * 95n) / 100n);

        const unstaked = await tappedOn(rig, listaRequest("unstake", fork), signal);
        expect(unstaked.lines[1]).toMatch(/^Unstake 0\.9\d+ slisBNB .*from Lista$/u);
        expect(unstaked.lines[2]).toMatch(
          /^Locked while it unbonds: you can claim it from .+, in about 7 days/u,
        );
        expect(unstaked.lines[3]).toBe(
          "Lista's own queue releases it and may take longer; binference tells you once you can claim it",
        );
        expect(unstaked.state).toBe("reconciled");
        expect(await slisBnbOf(fork, main.address)).toBe(0n);
        const allowance = await fork.client.readContract({
          address: slisBnb,
          abi: erc20Abi,
          functionName: "allowance",
          args: [main.address, manager],
        });
        expect(allowance).toBe(0n);
        const pool = accountOf(fork, manager);
        const query = { walletId: main.wallet, isPaper: false, venue: "lista", validator: pool };
        const [open] = await rig.stores.unbondings.listOpen(query, { signal });
        expect(open?.amount.base).toBeGreaterThan(bnb - 10n ** 15n);

        const early = await proposeOn(rig, listaRequest("claim", fork), signal);
        expect([early.state, early.outcome?.reason]).toStrictEqual([
          "failed_check",
          "nothing_to_claim",
        ]);
        await releaseQueue(fork, main.address);
        const before = await fork.client.getBalance({ address: main.address });
        const claimed = await tappedOn(rig, listaRequest("claim", fork), signal);
        expect(claimed.lines[1]).toMatch(/^Claim 0\.9\d+ BNB from your Lista unstake$/u);
        expect(claimed.state).toBe("reconciled");
        const after = await fork.client.getBalance({ address: main.address });
        expect(after - before).toBeGreaterThan(bnb - 10n ** 16n);
        const taken = await rig.stores.unbondings.claimedBy(claimed.view.intent, { signal });
        expect(taken.map((row) => row.requestRef)).toStrictEqual([open?.requestRef]);
      } finally {
        miner.abort();
        await mining;
      }
    });
  });
});
