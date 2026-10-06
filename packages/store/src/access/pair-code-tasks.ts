import { err, ok, type Result } from "@binference/core";
import {
  type PairCodeRecord,
  pairCodeRecordSchema,
  type PairCodeUse,
  pairCodeUseSchema,
} from "@binference/engine";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { field } from "../rows/column-values.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

/** Saves a new pairing code; a hash in use is `exists`. */
export const addPairCodeTask: StoreTask<
  PairCodeRecord,
  Result<PairCodeRecord, "exists">
> = defineTask({
  name: "access.add_pair_code",
  access: "write",
  input: pairCodeRecordSchema,
  output: resultSchema(pairCodeRecordSchema, ["exists"]),
  run(database, code) {
    const { kysely, execute, takeFirst } = createSyncKysely<EngineTables>(database);
    const taken = takeFirst(
      kysely.selectFrom("pair_codes").select("code_hash").where("code_hash", "=", code.codeHash),
    );
    if (taken !== undefined) {
      return err("exists");
    }
    execute(
      kysely.insertInto("pair_codes").values({
        code_hash: code.codeHash,
        expires_at: code.expiresAtMs,
        used_at: code.usedAtMs ?? null,
      }),
    );
    return ok(code);
  },
});

/** Uses a code once, before it expires. */
export const usePairCodeTask: StoreTask<
  PairCodeUse,
  Result<PairCodeRecord, "unknown" | "expired" | "used">
> = defineTask({
  name: "access.use_pair_code",
  access: "write",
  input: pairCodeUseSchema,
  output: resultSchema(pairCodeRecordSchema, ["unknown", "expired", "used"]),
  run(database, use) {
    const { kysely, execute, takeFirst } = createSyncKysely<EngineTables>(database);
    const row = takeFirst(
      kysely.selectFrom("pair_codes").selectAll().where("code_hash", "=", use.codeHash),
    );
    if (row === undefined) {
      return err("unknown");
    }
    if (row.used_at !== null) {
      return err("used");
    }
    if (use.atMs >= row.expires_at) {
      return err("expired");
    }
    execute(
      kysely
        .updateTable("pair_codes")
        .set({ used_at: use.atMs })
        .where("code_hash", "=", use.codeHash),
    );
    return ok(
      pairCodeRecordSchema.parse({
        codeHash: row.code_hash,
        expiresAtMs: row.expires_at,
        ...field("usedAtMs", use.atMs),
      }),
    );
  },
});
