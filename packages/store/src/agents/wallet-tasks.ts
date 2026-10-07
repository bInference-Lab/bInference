import {
  walletListLimit,
  type WalletQuery,
  walletQuerySchema,
  type WalletRecord,
  walletRecordSchema,
} from "@binference/engine/wallets";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { field } from "../rows/column-values.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

/** Lists the query's wallets, oldest first, then by id, at most {@link walletListLimit}. */
export const listWalletsTask: StoreTask<WalletQuery, readonly WalletRecord[]> = defineTask({
  name: "wallets.list",
  access: "read",
  input: walletQuerySchema,
  output: z.array(walletRecordSchema),
  run(database, query) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const every = kysely
      .selectFrom("wallets")
      .select(["id", "agent_id", "label", "created_at", "archived_at"]);
    const chosen =
      query.agentId === undefined ? every : every.where("agent_id", "=", query.agentId);
    const rows = execute(chosen.orderBy("created_at").orderBy("id").limit(walletListLimit)).rows;
    return rows.map((row) =>
      walletRecordSchema.parse({
        id: row.id,
        agentId: row.agent_id,
        label: row.label,
        createdAtMs: row.created_at,
        ...field("archivedAtMs", row.archived_at),
      }),
    );
  },
});
