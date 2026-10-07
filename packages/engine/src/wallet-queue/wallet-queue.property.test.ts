import {
  type AccountRef,
  accountRefSchema,
  type NonceSource,
  type TxHash,
} from "@binference/chain";
import { createFakeNonceSource } from "@binference/chain/testing";
import { createManualClock } from "@binference/core/testing";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import {
  createMemoryTransactionStore,
  type MemoryTransactionStore,
} from "../fakes/memory-transaction-store.js";
import type { TransactionStore } from "../ports.js";
import type { TransactionRecord } from "./transaction-record.js";
import { createWalletQueue } from "./wallet-queue.js";
import type { WalletSlot } from "./wallet-slot.js";

const accounts: readonly [AccountRef, AccountRef] = [
  accountRefSchema.parse("fake:1:0x0000000a"),
  accountRefSchema.parse("fake:1:0x0000000b"),
];
const chainStart = 7;
const chainCounts: ReadonlyMap<AccountRef, number> = new Map(
  accounts.map((account) => [account, chainStart]),
);
const live = { signal: new AbortController().signal };

interface Run {
  readonly intents: number;
  readonly accountCount: number;
  /** The intent whose work stops the engine after it took its nonce, before its signature. */
  readonly crashAt: number | undefined;
  /** How many of each account's lowest transactions a block takes before the restart. */
  readonly inBlock: number;
  /** Intents whose transaction is dropped before the restart, when no block holds it. */
  readonly dropped: readonly number[];
}

const runArbitrary: fc.Arbitrary<Run> = fc.record({
  intents: fc.integer({ min: 1, max: 40 }),
  accountCount: fc.integer({ min: 1, max: 2 }),
  crashAt: fc.option(fc.nat({ max: 39 }), { nil: undefined }),
  inBlock: fc.nat({ max: 40 }),
  dropped: fc.array(fc.nat({ max: 39 }), { maxLength: 6 }),
});

const accountOf = (run: Run, n: number): AccountRef =>
  accounts[n % run.accountCount] ?? accounts[0];

// Every chain read and store call waits for the scheduler, which releases them in an order it picks.
function scheduled(
  scheduler: Readonly<fc.Scheduler>,
  store: TransactionStore,
  chain: NonceSource,
): { readonly transactions: TransactionStore; readonly nonces: NonceSource } {
  const wait = async (label: string) => scheduler.schedule(Promise.resolve(), label);
  return {
    transactions: {
      ...store,
      nextNonce: async (request, options) => {
        await wait("next nonce");
        return store.nextNonce(request, options);
      },
      saveSigned: async (transaction, options) => {
        await wait("save");
        return store.saveSigned(transaction, options);
      },
    },
    nonces: {
      next: async (account, options) => {
        await wait("chain count");
        return chain.next(account, options);
      },
    },
  };
}

interface Engine {
  readonly store: MemoryTransactionStore;
  readonly chain: ReturnType<typeof createFakeNonceSource>;
}

interface Attempt {
  readonly run: Run;
  /** 0 before the restart, 1 after; it tells transaction ids apart. */
  readonly attempt: number;
  readonly intents: readonly number[];
}

// One step of intent n. The work that stops the engine takes its nonce and never saves.
function stepOf({ run, attempt }: Attempt, stop: AbortController, n: number) {
  return async (slot: WalletSlot): Promise<void> => {
    const { nonce } = await slot.nextNonce(stop);
    if (attempt === 0 && n === run.crashAt) {
      stop.abort(new Error("the engine stopped"));
      return;
    }
    const id = attempt * 1_000 + n;
    const hash = `0x${id.toString(16).padStart(64, "0")}` as TxHash;
    const signed = { id: fixtureId("tx", id), intentId: fixtureId("int", n), step: 0, hash };
    const transaction = { ...signed, account: slot.account, nonce, raw: "0x02f8", signedAtMs: 1 };
    await slot.saveSigned(transaction, stop);
  };
}

// Runs every intent of the attempt at once on a fresh queue, in the order the scheduler picks.
async function runEngine(scheduler: Readonly<fc.Scheduler>, engine: Engine, attempt: Attempt) {
  const ports = scheduled(scheduler, engine.store, engine.chain);
  const queue = createWalletQueue({ ...ports, clock: createManualClock(1_000) });
  const stop = new AbortController();
  const works = attempt.intents.map(async (n) =>
    queue.run(accountOf(attempt.run, n), stepOf(attempt, stop, n), stop),
  );
  await scheduler.waitFor(Promise.allSettled(works));
}

async function stored(store: TransactionStore, account: AccountRef) {
  return store.list({ account, fromNonce: 0, limit: 1_000 }, live);
}

// Between the runs: a block takes the account's lowest transactions, and some others drop.
async function betweenRuns(engine: Engine, run: Run, account: AccountRef): Promise<void> {
  const own = await stored(engine.store, account);
  const final = own.slice(0, run.inBlock);
  const dropped = own
    .slice(final.length)
    .filter(({ intentId }) => run.dropped.some((n) => fixtureId("int", n) === intentId));
  final.forEach(({ id }) => {
    engine.store.setState(id, "final");
  });
  dropped.forEach(({ id }) => {
    engine.store.setState(id, "dropped");
  });
  engine.chain.set(account, chainStart + final.length);
}

const isLive = (transaction: TransactionRecord): boolean => transaction.state !== "dropped";

describe("the wallet queue under any order of chain reads and store calls", () => {
  it("gives every intent of a wallet one nonce, distinct and gapless, across a restart", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.scheduler(),
        runArbitrary,
        async (scheduler: Readonly<fc.Scheduler>, run: Run) => {
          const engine: Engine = {
            store: createMemoryTransactionStore(),
            chain: createFakeNonceSource(chainCounts),
          };
          const used = accounts.slice(0, run.accountCount);
          const intents = Array.from({ length: run.intents }, (_, n) => n);
          await runEngine(scheduler, engine, { run, attempt: 0, intents });
          await Promise.all(used.map(async (account) => betweenRuns(engine, run, account)));
          const all = await Promise.all(used.map(async (account) => stored(engine.store, account)));
          const done = new Set(
            all
              .flat()
              .filter(isLive)
              .map(({ intentId }) => intentId),
          );
          const left = intents.filter((n) => !done.has(fixtureId("int", n)));
          await runEngine(scheduler, engine, { run, attempt: 1, intents: left });
          const kept = await Promise.all(
            used.map(async (account) => stored(engine.store, account)),
          );
          expect(kept.map((own) => own.filter(isLive).map(({ nonce }) => nonce))).toStrictEqual(
            used.map((account) =>
              intents.filter((n) => accountOf(run, n) === account).map((_, i) => chainStart + i),
            ),
          );
          expect(
            new Set(
              kept
                .flat()
                .filter(isLive)
                .map(({ intentId }) => intentId),
            ).size,
          ).toBe(run.intents);
        },
      ),
    );
  });
});
