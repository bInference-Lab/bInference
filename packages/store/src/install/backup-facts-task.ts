import { type InstallBackupFacts, installBackupFactsSchema } from "@binference/engine/install";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { field } from "../rows/column-values.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

/**
 * Reads what a backup takes of the install. The backup before a migration runs it on a database an
 * older release left, so it names only columns of `oldestUpdatedEngineSchemaVersion`.
 */
export const readBackupFactsTask: StoreTask<null, InstallBackupFacts> = defineTask({
  name: "install.read_backup_facts",
  access: "read",
  input: z.null(),
  output: installBackupFactsSchema,
  run(database) {
    const { kysely, execute, takeFirst } = createSyncKysely<EngineTables>(database);
    const custody = takeFirst(
      kysely
        .selectFrom("custody")
        .select(["app_id", "owner_key_public", "seal_key_public", "attached_at"])
        .where("id", "=", 1),
    );
    const wallets = execute(
      kysely
        .selectFrom("wallets")
        .select(["custody_wallet_id", "archived_at"])
        .orderBy("created_at")
        .orderBy("id"),
    ).rows;
    return {
      ...(custody === undefined
        ? {}
        : {
            custody: {
              appId: custody.app_id,
              ownerKeyPublic: custody.owner_key_public,
              ...field("sealKeyPublic", custody.seal_key_public),
              attachedAtMs: custody.attached_at,
            },
          }),
      wallets: wallets.map(({ custody_wallet_id: custodyWalletId, archived_at: archivedAtMs }) =>
        archivedAtMs === null ? { custodyWalletId } : { custodyWalletId, archivedAtMs },
      ),
    };
  },
});
