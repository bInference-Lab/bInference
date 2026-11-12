import { accountRefSchema } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { MoneyRaceSubject, MoneyWriter } from "../contracts/money-race-runs.js";
import { moneyWriteRaces } from "../contracts/money-write-races.js";
import type { PlantedPair } from "../contracts/order-fixtures.js";
import { fixtureId, live } from "../contracts/store-fixtures.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { testAgentDraft } from "../intents/test-intents.js";
import { createMemoryEngineStores } from "./memory-engine-stores.js";
import { createMemoryPositionStore } from "./memory-position-store.js";

async function gaveUp(): Promise<never> {
  return Promise.reject(
    new BinferenceError({
      code: "store.write_conflict",
      message: "The write met conflicts on every try and wrote nothing.",
    }),
  );
}

// A writer each of whose writes gives up on conflicts and writes nothing, as a Postgres write
// does after its last retry; its reads answer as the others'.
function givingUp(writer: MoneyWriter): MoneyWriter {
  const { intents, ledger, orders, positions, transactions } = writer;
  return {
    intents: { ...intents, create: gaveUp, transition: gaveUp, recordLandedLate: gaveUp },
    ledger: { ...ledger, append: gaveUp },
    orders: { ...orders, recordLandedFill: gaveUp },
    positions: { ...positions, record: gaveUp },
    transactions: { ...transactions, saveSigned: gaveUp },
  };
}

// Eight writers over one set of memory stores: the fakes check each write as one step, as a
// database's transaction does. The last gives up on every write.
async function racers(): Promise<MoneyRaceSubject> {
  const { intents, ledger, orders, transactions, agents, install, identities } =
    createMemoryEngineStores();
  const plant = async (n: number): Promise<PlantedPair> => {
    const pair = { agentId: fixtureId("agt", n), walletId: fixtureId("wal", n) };
    install.addWallet(
      testWalletRecord({ id: pair.walletId, ...pair, label: "main", createdAtMs: 1 }),
    );
    await agents.create(testAgentDraft({ id: pair.agentId, name: `agent ${String(n)}` }), live());
    return pair;
  };
  const mine = await plant(1);
  const other = await plant(2);
  const positions = createMemoryPositionStore();
  const writer = { intents, ledger, orders, positions, transactions };
  const accounts = [
    accountRefSchema.parse("fake:1:0x0000000a"),
    accountRefSchema.parse("fake:1:0x0000000b"),
  ] as const;
  const writers = [...Array.from({ length: 7 }, () => writer), givingUp(writer)];
  return { writers, agents, identities, ...mine, other, accounts };
}

describe("memory money stores under racing writers", () => {
  it.each(moneyWriteRaces({ create: racers }))("hold: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
