import { idSchema } from "@binference/core";
import { cardCopyStoreContract, ownerStoreContract } from "@binference/engine/testing";
import { describe, expect, it } from "vitest";
import { createRunBotStores } from "./run-bot-stores.js";

const live = { signal: new AbortController().signal };
const refOf = (n: number): string => `ref${String(n).padStart(13, "0")}`;

describe("the bot's stores for one run", () => {
  it.each(ownerStoreContract({ create: async () => Promise.resolve(createRunBotStores().owners) }))(
    "keeps the owner as the owner store contract says: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );

  it.each(
    cardCopyStoreContract({ create: async () => Promise.resolve(createRunBotStores().copies) }),
  )("keeps card copies as the card copy store contract says: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("forgets the oldest card version's copies past a thousand versions", async () => {
    const { copies } = createRunBotStores();
    const intent = idSchema("int").parse("int_0190f1c2-3a4b-7c5d-8e6f-000000000001");
    const kept = Array.from({ length: 1_001 }, (_, n) => ({
      ref: refOf(n),
      intent,
      cardVersion: n + 1,
      chatId: 1,
      messageId: n + 1,
    }));
    // In order, as the bot keeps them: each copy is kept before the next card version shows.
    await kept.reduce<Promise<void>>(
      async (earlier, copy) => earlier.then(async () => copies.keep(copy, live)),
      Promise.resolve(),
    );
    await expect(copies.find(refOf(0), live)).resolves.toStrictEqual([]);
    await expect(copies.find(refOf(1_000), live)).resolves.toHaveLength(1);
    await expect(copies.ofIntent(intent, live)).resolves.toHaveLength(1_000);
  });
});
