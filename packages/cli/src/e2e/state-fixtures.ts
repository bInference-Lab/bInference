import { join } from "node:path";
import { createIdSource, type Id, type JsonValue, jsonValueSchema } from "@binference/core";
import { createSeededRandom } from "@binference/core/testing";
import { intentRequestSchema } from "@binference/protocol";
import {
  agentWorker,
  createSqliteEngineStores,
  createSqliteNoteStore,
  createSqliteWriterFence,
  type DatabaseHandle,
  engineWorker,
  openDatabase,
} from "@binference/store";
import { z } from "zod";
import { storedInstall } from "./init-fixtures.js";
import { hostOn, type TestMachine } from "./test-host.js";

// The first agent of the install and its first wallet, as `engine.sqlite` holds them.
async function firstWallet(machine: TestMachine) {
  const { facts, agents } = await storedInstall(machine);
  const [agent] = agents;
  const [wallet] = facts.wallets;
  if (agent === undefined || wallet === undefined) {
    throw new Error("Expected binference init to make an agent and its wallet.");
  }
  return { agentId: agent.id, walletId: wallet.id };
}

/**
 * Leaves a live swap of the install's first agent in `executing` in `engine.sqlite`, as an engine
 * that stopped while its transaction was on its way does. The engine must be stopped.
 */
export async function seedSendingTrade(machine: TestMachine): Promise<void> {
  const request = { kind: "swap", sell: { asset: "eip155:56/slip44:714", base: "1000" } };
  await seedLiveSwap(machine, { state: "executing", request });
}

/**
 * Leaves a live swap of the install's first agent `confirmed` in `engine.sqlite`, as an engine
 * that stopped after the owner's tap and before its queue took it does, and answers its id. The
 * engine must be stopped.
 */
export async function seedConfirmedTrade(machine: TestMachine): Promise<Id<"int">> {
  const { agentId, walletId } = await firstWallet(machine);
  // The request as the protocol carries it, read back through its schema.
  const swap = intentRequestSchema.parse({
    kind: "swap",
    agent: agentId,
    wallet: walletId,
    reason: "Rotate into the stablecoin",
    from: "eip155:56/slip44:714",
    to: "eip155:56/erc20:0x55d398326f99059ff775485246999027b3197955",
    amount: { base: "1000" },
  });
  const request = jsonValueSchema.parse(z.encode(intentRequestSchema, swap));
  const cause = { trigger: "propose", proposer: "owner", by: "tok_owner" };
  return seedLiveSwap(machine, { state: "confirmed", request, cause });
}

// Stores a live swap of the first agent with `request` and moves it into `state`.
async function seedLiveSwap(
  machine: TestMachine,
  seed: {
    readonly state: "executing" | "confirmed";
    readonly request: JsonValue;
    readonly cause?: { readonly trigger: string; readonly [field: string]: string };
  },
): Promise<Id<"int">> {
  const { state, request, cause = { trigger: "propose" } } = seed;
  const signal = new AbortController().signal;
  const { agentId, walletId } = await firstWallet(machine);
  const database = await openDatabase({
    file: join(machine.folder, "engine.sqlite"),
    worker: engineWorker,
    execArgv: hostOn(machine, []).workerExecArgv ?? [],
    signal,
  });
  try {
    const { intents } = createSqliteEngineStores(database);
    const ids = createIdSource({ clock: machine.clock, random: createSeededRandom(5) });
    const id = ids.next("int");
    const atMs = machine.clock.now();
    const ledger = { id: ids.next("led"), atMs, kind: "proposed", subject: id, data: {}, agentId };
    await intents.create(
      {
        id,
        agentId,
        walletId,
        kind: "swap",
        state: "proposed",
        request,
        hasOutsideContent: false,
        isPaper: false,
        proposer: ids.next("tok"),
        atMs,
        cause,
        ledger,
      },
      { signal },
    );
    await intents.transition(
      { id, expectedVersion: 0, state, atMs, cause: { trigger: state } },
      { signal },
    );
    return id;
  } finally {
    await database.close();
  }
}

// Runs `use` on the machine's `agent.sqlite`, opened and migrated as the runtime opens it.
async function withAgentDatabase<T>(
  machine: TestMachine,
  use: (database: DatabaseHandle, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const signal = new AbortController().signal;
  const database = await openDatabase({
    file: join(machine.folder, "agent.sqlite"),
    worker: agentWorker,
    execArgv: hostOn(machine, []).workerExecArgv ?? [],
    signal,
  });
  try {
    await database.migrate({ signal });
    return await use(database, signal);
  } finally {
    await database.close();
  }
}

/** Writes a note of the install's first agent into `agent.sqlite`, as the agent does. */
export async function seedNote(machine: TestMachine, text: string): Promise<void> {
  const { agentId } = await firstWallet(machine);
  await withAgentDatabase(machine, async (database, signal) => {
    const fence = await createSqliteWriterFence(database).raise({ signal });
    const atMs = machine.clock.now();
    await createSqliteNoteStore(database).write(
      { agentId, text, origin: "owner", atMs, fence },
      { signal },
    );
  });
}

/** The texts of the first agent's notes in `agent.sqlite`. */
export async function noteTexts(machine: TestMachine): Promise<readonly string[]> {
  const { agentId } = await firstWallet(machine);
  return withAgentDatabase(machine, async (database, signal) => {
    const notes = await createSqliteNoteStore(database).list({ agentId, limit: 100 }, { signal });
    return notes.map((note) => note.text);
  });
}
