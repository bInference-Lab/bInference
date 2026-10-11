import { describe, expect, it } from "vitest";
import { backupStoreContract } from "../contracts/backup-store-contract.js";
import { createMemoryBackupStore } from "./memory-backup-store.js";

describe("memory backup store", () => {
  it.each(backupStoreContract({ create: async () => Promise.resolve(createMemoryBackupStore()) }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );
});
