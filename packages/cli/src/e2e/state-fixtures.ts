import { join } from "node:path";
import { createIdSource } from "@binference/core";
import { createSeededRandom } from "@binference/core/testing";
import {
  agentWorker,
  createSqliteEngineStores,
  createSqliteNoteStore,
  createSqliteWriterFence,
  type DatabaseHandle,
  engineWorker,
  openDatabase,
} from "@binference/store";
import { storedInstall } from "./init-fixtures.js";
import { hostOn, type TestMachine } from "./test-host.js";

/**
 * Leaves a live swap of the install's first agent in `executing` in `engine.sqlite`, as an engine
 * that stopped while its transaction was on its way does. The engine must be stopped.
 */
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
        request: { kind: "swap", sell: { asset: "eip155:56/slip44:714", base: "1000" } },
        hasOutsideContent: false,
        isPaper: false,
        proposer: ids.next("tok"),
        atMs,
        cause: { trigger: "propose" },
        ledger,
      },
      { signal },
    );
    await intents.transition(
      { id, expectedVersion: 0, state: "executing", atMs, cause: { trigger: "executing" } },
      { signal },
    );
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
