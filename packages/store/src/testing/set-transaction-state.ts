import { type Id, idSchema } from "@binference/core";
import type { TransactionState } from "@binference/engine/wallet-queue";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import type { StoreHost } from "../tasks/store-host.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

interface StateChange {
  readonly id: Id<"tx">;
  readonly state: TransactionState;
}

/**
 * Sets a stored transaction's state straight in its row, for the transaction store's contract
 * cases that start from a state the wallet queue reaches only on a chain. The Postgres test
 * stores' engine worker lists it.
 */
export const setTransactionStateTask: StoreTask<StateChange, null> = defineTask({
  name: "testing.set_transaction_state",
  access: "write",
  input: z.strictObject({
    id: idSchema("tx"),
    state: z.custom<TransactionState>((value) => typeof value === "string"),
  }),
  output: z.null(),
  run(database, change) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    execute(kysely.updateTable("txs").set({ state: change.state }).where("id", "=", change.id));
    return null;
  },
});

/** Sets a transaction's state through `host`, on SQLite or Postgres alike. */
export async function setTransactionState(
  host: StoreHost,
  id: Id<"tx">,
  state: TransactionState,
): Promise<void> {
  await host.run(setTransactionStateTask, { id, state }, { signal: AbortSignal.timeout(30_000) });
}
