import { cardCopyStoreContract, type CardVersionKey } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { engineDatabase } from "../databases/engine-database.js";
import { plantCardVersions } from "../testing/engine-store-subjects.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteCardCopyStore } from "./sqlite-card-copy-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

const live = { signal: new AbortController().signal };

describe("sqlite card copy store", () => {
  it.each(
    cardCopyStoreContract({
      create: async (cards) => {
        const { host } = databases.open(engineDatabase);
        await plantCardVersions(host, cards);
        return createSqliteCardCopyStore(host);
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
