import {
  accountRefSchema,
  type StakeRequest,
  type TxDraft,
  type TxHash,
} from "@binference/plugin-sdk";
import { stakingVenueContract } from "@binference/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { listaForeignDrafts } from "./testing/foreign-drafts.js";
import { createListaWorld, type ListaWorld } from "./testing/lista-world.js";

const wallet = accountRefSchema.parse("eip155:56:0x00000000000000000000000000000000000000A1");
const unknown = accountRefSchema.parse("eip155:56:0x00000000000000000000000000000000000000c9");
const live = { signal: new AbortController().signal };
const bnb = 10n ** 18n;
const day = 86_400;

// The calls Lista builds for the request's plan; a refusal fails the test.
async function builtOf(world: ListaWorld, request: StakeRequest): Promise<readonly TxDraft[]> {
  const planned = await world.venue.plan(request, live);
  if (!planned.ok) {
    throw new Error(`Lista refused a ${request.action}: ${planned.error}.`);
  }
  return world.venue.build(planned.value, live);
}

async function moved(world: ListaWorld, request: StakeRequest): Promise<void> {
  world.run(await builtOf(world, request));
}

function hashOf(hash: TxHash | undefined): TxHash {
  if (hash === undefined) {
    throw new Error("The world mined no move.");
  }
  return hash;
}

function stakeOf(world: ListaWorld, base: bigint): StakeRequest {
  return { action: "stake", wallet, validator: world.pool, amount: { asset: world.coin, base } };
}

describe("the Lista venue", () => {
  it.each(
    stakingVenueContract({
      create: async () => {
        const world = createListaWorld();
        return await Promise.resolve({
          venue: world.venue,
          wallet,
          active: world.pool,
          unknown,
          stake: { asset: world.coin, base: 2n * bnb },
          foreign: listaForeignDrafts(wallet),
          run: async (drafts) => await Promise.resolve(world.run(drafts)),
          wait: async (seconds) => {
            world.wait(seconds);
            await Promise.resolve();
          },
        });
      },
    }),
  )("keeps the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("lists Lista's one pool, with the 15% it keeps, StakeHub's 7 days and a 2 wei least stake", async () => {
    const world = createListaWorld();

    const options = await world.venue.options(live);

    expect(options.validators).toStrictEqual([
      { validator: world.pool, name: "Lista", commissionBps: 1_500, jailed: false },
    ]);
    expect([options.unbondingSeconds, options.minStake.base]).toStrictEqual([7 * day, 2n]);
  });

  it("promises a stake 10 basis points under the slisBNB it mints at the plan's rate", async () => {
    const world = createListaWorld();

    const planned = await world.venue.plan(stakeOf(world, bnb), live);

    const minted = (bnb * 10n ** 24n) / 1_039_342_452_779_596_239_000_000n;
    expect(planned).toMatchObject({
      ok: true,
      value: { shares: { base: minted }, minShares: { base: (minted * 9_990n) / 10_000n } },
    });
  });

  it("refuses every move while paused, and an unstake under Lista's least withdrawal", async () => {
    const world = createListaWorld();
    await moved(world, stakeOf(world, bnb));
    const tiny = { asset: world.receipt, base: 10n ** 14n };
    const small = await world.venue.plan(
      { action: "unstake", wallet, validator: world.pool, amount: tiny },
      live,
    );
    world.pause();
    const paused = await world.venue.plan(stakeOf(world, bnb), live);

    expect(small).toStrictEqual({
      ok: false,
      error: "below_min_stake",
      facts: { minStake: { asset: world.coin, base: 10n ** 15n } },
    });
    expect(paused).toStrictEqual({ ok: false, error: "staking_paused" });
  });

  it("names a request Lista's queue holds as queued after its read, and claims none of it", async () => {
    const world = createListaWorld();
    await moved(world, stakeOf(world, bnb));
    await moved(world, { action: "unstake", wallet, validator: world.pool, amount: "whole" });
    world.holdQueue();
    world.wait(8 * day);

    const [held] = await world.venue.holdings(wallet, live);
    const claim = await world.venue.plan({ action: "claim", wallet, validator: world.pool }, live);
    world.releaseQueue();
    const released = await world.venue.plan(
      { action: "claim", wallet, validator: world.pool },
      live,
    );

    expect(held?.unbonding).toMatchObject([{ ref: "1", queued: true }]);
    expect(held?.claimable.base).toBe(0n);
    expect(claim).toMatchObject({ ok: false, error: "nothing_to_claim" });
    expect(released).toMatchObject({ ok: true, value: { parts: ["1"] } });
  });

  it("builds an unstake as an exact approval of its slisBNB, then the request", async () => {
    const world = createListaWorld();
    await moved(world, stakeOf(world, bnb));
    const drafts = await builtOf(world, {
      action: "unstake",
      wallet,
      validator: world.pool,
      amount: "whole",
    });

    expect(drafts.map((draft) => world.venue.decode(draft).ok)).toStrictEqual([false, true]);
    expect(drafts[0]?.payload).toContain("095ea7b3");
  });

  it("reads back no move from a reverted transaction or another pool", async () => {
    const world = createListaWorld();
    const drafts = await builtOf(world, stakeOf(world, bnb));
    world.pause();
    const [hash] = world.run(drafts);
    const move = { action: "stake", wallet, validator: world.pool, hash: hashOf(hash) } as const;

    await expect(world.venue.landed(move, live)).resolves.toStrictEqual({
      ok: false,
      error: "not_found",
    });
    await expect(world.venue.landed({ ...move, validator: unknown }, live)).resolves.toStrictEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("fails a read while no node answers", async () => {
    const world = createListaWorld();
    world.goDown();
    await expect(world.venue.options(live)).rejects.toMatchObject({ code: "chain.rpc_down" });
  });
});
