import type { Amount } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import { createManualClock, type ManualClock } from "@binference/core/testing";
import type { HeldWallet } from "../executor/held-wallets.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { testAgent, testCoin, testWallet } from "../intents/test-intents.js";
import { startTestEngine, type TestEngine, testAccount } from "../operations/test-engine.js";
import { createPositions } from "../positions/create-positions.js";
import type { SummaryFactsParts } from "./read-summary-facts.js";

/** 2027-01-16 09:00 in Asia/Shanghai, 01:00 UTC: the fixture day's summary is due. */
const fixtureDueMs: number = Date.UTC(2027, 0, 16, 1, 0);

/** The test engine's agent `main` with its wallet stored, and what its summary reads it through. */
export interface DayRig {
  readonly test: TestEngine;
  /** The summaries' own clock. */
  readonly clock: ManualClock;
  /** Makes a stuck step hold the wallet from now on. */
  readonly hold: (wallet: HeldWallet) => void;
  /** The owner's timezone now. */
  readonly zone: () => string;
  /** Moves the owner's timezone, as a change of `owner.timezone` does. */
  readonly moveZone: (zone: string) => void;
  /** The parts a summary reads the agent's day through. */
  readonly parts: SummaryFactsParts;
}

/** What the rig starts from: the owner's timezone, the clock and what the live wallet holds. */
export interface DayRigOptions {
  readonly timeZone?: string;
  readonly startMs?: number;
  readonly liveHeld?: readonly Amount[];
  /** Whether no chain answers a live balance read. */
  readonly isChainDown?: boolean;
}

const chainDown = async (): Promise<never> =>
  Promise.reject(new BinferenceError({ code: "chain.rpc_down", message: "No node answers." }));

/** An amount of the fake chain's coin, in whole coins. */
export const coins = (n: bigint): Amount => ({ asset: testCoin, base: n * 10n ** 18n });

/**
 * The test engine's paper agent `main`, with its wallet stored, one paper coin at $600 and, live,
 * two coins on chain unless told otherwise, read on a clock of the rig's own.
 */
export async function startDayRig(options: DayRigOptions = {}): Promise<DayRig> {
  const liveHeld = options.liveHeld ?? [coins(2n)];
  const test = await startTestEngine({
    held: new Map([[testAccount, liveHeld]]),
    // Every balance read fails, as on a chain no endpoint answers for.
    ...(options.isChainDown === true
      ? { walletFacts: (source) => ({ ...source, balances: chainDown }) }
      : {}),
  });
  const wallet = { id: testWallet, agentId: testAgent, label: "main", createdAtMs: 1 };
  test.stores.install.addWallet({ ...testWalletRecord(wallet), address: "0x0000000c" });
  const held: HeldWallet[] = [];
  const zone = { now: options.timeZone ?? "Asia/Shanghai" };
  const { stores, engineOptions } = test;
  return {
    test,
    clock: createManualClock(options.startMs ?? fixtureDueMs),
    hold: (stuck) => held.push(stuck),
    zone: () => zone.now,
    moveZone: (moved) => {
      zone.now = moved;
    },
    parts: {
      install: stores.install,
      intents: stores.intents,
      orders: stores.orders,
      questions: stores.questions,
      usage: stores.modelUsage,
      store: test.positions,
      positions: createPositions({ store: test.positions, prices: engineOptions.prices }),
      wallets: engineOptions.wallets,
      prices: engineOptions.prices,
      chains: engineOptions.chains,
      heldWallets: () => held,
    },
  };
}
