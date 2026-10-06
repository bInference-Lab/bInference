import { describe, expect, it } from "vitest";
import { configJournalContract } from "../contracts/config-journal-contract.js";
import { createMemoryConfigJournal } from "./memory-config-journal.js";

describe("memory config journal", () => {
  it.each(configJournalContract({ create: async () => createMemoryConfigJournal() }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );
});
