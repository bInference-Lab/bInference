import type { DatabaseSync } from "node:sqlite";
import { cardCopyStoreContract, type CardVersionKey } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { engineDatabase } from "../databases/engine-database.js";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import type { StoreHost } from "../tasks/store-host.js";
import { createIntent } from "../testing/create-intent.js";
import { plantAgent } from "../testing/plant-agent.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteCardCopyStore } from "./sqlite-card-copy-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

const live = { signal: new AbortController().signal };

// The intents the card versions name, by the number of their id, then each card version.
async function storeCards(
  { host, database }: { readonly host: StoreHost; readonly database: DatabaseSync },
  cards: readonly CardVersionKey[],
): Promise<void> {
  const agent = plantAgent(database, 1);
  const intents = [...new Set(cards.map((card) => card.intent))];
  await intents.reduce<Promise<void>>(async (earlier, intent) => {
    await earlier;
    await createIntent(host, agent, Number.parseInt(intent.slice(-12), 16));
  }, Promise.resolve());
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  cards.forEach((card, index) => {
    execute(
      kysely.insertInto("cards").values({
        id: `crd_0190f1c2-3a4b-7c5d-8e6f-${String(index + 1).padStart(12, "0")}`,
        intent_id: card.intent,
        version: card.cardVersion,
        terms_hash: "a".repeat(64),
        callback_ref: card.ref,
        opened_at: 1,
        expires_at: 2,
        closed_at: null,
        close_reason: null,
      }),
    );
  });
}

describe("sqlite card copy store", () => {
  it.each(
    cardCopyStoreContract({
      create: async (cards) => {
        const opened = databases.open(engineDatabase);
        await storeCards(opened, cards);
        return createSqliteCardCopyStore(opened.host);
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("refuses a copy of a card version it does not hold", async () => {
    const { host } = databases.open(engineDatabase);
    const copy = {
      ref: "ZZZZZZZZZZZZZZZZ",
      intent: "int_0190f1c2-3a4b-7c5d-8e6f-000000000001",
      cardVersion: 1,
      chatId: 1,
      messageId: 1,
      sentAtMs: 1,
    } as const;
    await expect(
      createSqliteCardCopyStore(host).keep(
        { ...copy, intent: copy.intent as CardVersionKey["intent"] },
        live,
      ),
    ).rejects.toMatchObject({ code: "store.unknown_card" });
  });
});
