import type { OrderStoreSubject, PlantedPair } from "../contracts/order-fixtures.js";
import { fixtureId, live } from "../contracts/store-fixtures.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { testAgentDraft } from "../intents/test-intents.js";
import { createMemoryEngineStores } from "./memory-engine-stores.js";

/** Every engine store in memory, with two agents that each hold one wallet. */
export async function subjectOf(): Promise<OrderStoreSubject> {
  const { orders, intents, agents, install } = createMemoryEngineStores();
  const plant = async (n: number): Promise<PlantedPair> => {
    const pair = { agentId: fixtureId("agt", n), walletId: fixtureId("wal", n) };
    install.addWallet(
      testWalletRecord({ id: pair.walletId, ...pair, label: "main", createdAtMs: 1 }),
    );
    await agents.create(testAgentDraft({ id: pair.agentId, name: `agent ${String(n)}` }), live());
    return pair;
  };
  const [mine, other] = await Promise.all([plant(1), plant(2)]);
  return { store: orders, intents, agents, ...mine, other };
}
