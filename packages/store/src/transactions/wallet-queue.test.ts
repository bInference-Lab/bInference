import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountRefSchema, type TxHash } from "@binference/chain";
import { createFakeNonceSource } from "@binference/chain/testing";
import type { Id } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import {
  createWalletQueue,
  type NonceGrant,
  type WalletSlot,
} from "@binference/engine/wallet-queue";
import { afterEach, describe, expect, it } from "vitest";
import { engineWorker } from "../databases/engine-database.js";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { type DatabaseHandle, openDatabase } from "../host/open-database.js";
import { openConnection } from "../sqlite/open-connection.worker.js";
import { createIntent } from "../testing/create-intent.js";
import { plantAgent } from "../testing/plant-agent.js";
import { createSqliteTransactionStore } from "./sqlite-transaction-store.js";

// Workers run the TypeScript source, as in the host's own tests.
const execArgv = ["--conditions=@binference/source", "--import", "tsx"];
const workerTest = { timeout: 60_000 };
const call = { signal: AbortSignal.timeout(30_000) };
const account = accountRefSchema.parse("fake:1:0x0000000a");
const chainStart = 7;

const range = (count: number, from = 0): readonly number[] =>
  Array.from({ length: count }, (_, index) => from + index);

const opened: DatabaseHandle[] = [];
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map(async (handle) => handle.close()));
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

async function open(file: string): Promise<DatabaseHandle> {
  const handle = await openDatabase({ file, worker: engineWorker, execArgv, signal: call.signal });
  opened.push(handle);
  await handle.migrate(call);
  return handle;
}

interface Engine {
  readonly file: string;
  readonly handle: DatabaseHandle;
  readonly intents: readonly Id<"int">[];
}

// A migrated engine database with 40 confirmed intents, planted through a connection that closes.
async function engineWithIntents(): Promise<Engine> {
  const folder = mkdtempSync(join(tmpdir(), "bnf-queue-"));
  folders.push(folder);
  const file = join(folder, "engine.sqlite");
  const handle = await open(file);
  const connection = openConnection(file, { role: "writer", synchronous: "normal" });
  const agent = plantAgent(connection, 1);
  connection.close();
  const intents = await Promise.all(range(40).map(async (n) => createIntent(handle, agent, n)));
  return { file, handle, intents };
}

function queueOn(handle: DatabaseHandle, nonces: ReturnType<typeof createFakeNonceSource>) {
  const transactions = createSqliteTransactionStore(handle);
  return createWalletQueue({ transactions, nonces, clock: createManualClock(1_000) });
}

// One step of an intent: a nonce, a signature, the save before any send.
async function sendStep(slot: WalletSlot, intent: Id<"int">, n: number): Promise<NonceGrant> {
  const grant = await slot.nextNonce(call);
  const id = `tx_0190f1c2-3a4b-7c5d-8e6f-${n.toString(16).padStart(12, "0")}` as Id<"tx">;
  const saved = await slot.saveSigned(
    {
      id,
      intentId: intent,
      step: 0,
      account,
      nonce: grant.nonce,
      raw: `0x02f8${n.toString(16)}`,
      hash: `0x${n.toString(16).padStart(64, "0")}` as TxHash,
      signedAtMs: 1_000,
    },
    call,
  );
  expect(saved.ok).toBe(true);
  return grant;
}

interface CrashingStep {
  readonly stop: AbortController;
  readonly intent: Id<"int">;
  readonly n: number;
}

// Intent 17 takes its nonce, and the engine stops before its signature is stored.
async function crashingStep(slot: WalletSlot, { stop, intent, n }: CrashingStep) {
  if (n !== 17) {
    return sendStep(slot, intent, n);
  }
  await slot.nextNonce(call);
  const crash = new Error("the engine stopped");
  stop.abort(crash);
  throw crash;
}

async function storedNonces(handle: DatabaseHandle): Promise<readonly number[]> {
  const stored = await createSqliteTransactionStore(handle).list(
    { account, fromNonce: 0, limit: 100 },
    call,
  );
  expect(new Set(stored.map(({ intentId }) => intentId)).size).toBe(stored.length);
  return stored.map(({ nonce }) => nonce);
}

describe("the wallet queue on the SQLite store", () => {
  it(
    "gives 40 parallel intents on one wallet 40 distinct nonces with no gap",
    workerTest,
    async () => {
      const { handle, intents } = await engineWithIntents();
      const queue = queueOn(handle, createFakeNonceSource(new Map([[account, chainStart]])));
      const grants = await Promise.all(
        intents.map(async (intent, n) =>
          queue.run(account, async (slot) => sendStep(slot, intent, n), call),
        ),
      );
      expect(grants.map(({ nonce }) => nonce)).toStrictEqual(range(40, chainStart));
      await expect(storedNonces(handle)).resolves.toStrictEqual(range(40, chainStart));
    },
  );

  it(
    "goes on after a restart mid-run with no nonce used twice and no gap",
    workerTest,
    async () => {
      const { file, handle: before, intents } = await engineWithIntents();
      const nonces = createFakeNonceSource(new Map([[account, chainStart]]));
      const stop = new AbortController();
      const queue = queueOn(before, nonces);
      const settled = await Promise.allSettled(
        intents.map(async (intent, n) =>
          queue.run(account, async (slot) => crashingStep(slot, { stop, intent, n }), stop),
        ),
      );
      expect(settled.filter(({ status }) => status === "fulfilled")).toHaveLength(17);
      await before.close();
      // While the engine was down, a block took the first ten and the chain counts them.
      const connection = openConnection(file, { role: "writer", synchronous: "normal" });
      const { kysely, execute } = createSyncKysely<EngineTables>(connection);
      execute(
        kysely
          .updateTable("txs")
          .set({ state: "final" })
          .where("nonce", "<", chainStart + 10),
      );
      connection.close();
      nonces.set(account, chainStart + 10);
      const after = await open(file);
      const resumedQueue = queueOn(after, nonces);
      const resumed = await Promise.all(
        intents
          .slice(17)
          .map(async (intent, n) =>
            resumedQueue.run(account, async (slot) => sendStep(slot, intent, n + 17), call),
          ),
      );
      expect(resumed[0]).toStrictEqual({ nonce: chainStart + 17, refillsGap: true });
      await expect(storedNonces(after)).resolves.toStrictEqual(range(40, chainStart));
    },
  );
});
