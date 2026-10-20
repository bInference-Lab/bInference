import { join } from "node:path";
import { createIdSource } from "@binference/core";
import { createSeededRandom } from "@binference/core/testing";
import { createSqliteEngineStores, engineWorker, openDatabase } from "@binference/store";
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
