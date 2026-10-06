import type { DatabaseSync } from "node:sqlite";
import { err, type Id, ok, type Result } from "@binference/core";
import {
  type Sha256Hex,
  sha256HexSchema,
  type StampedId,
  stampedIdSchema,
  type TokenRecord,
  tokenRecordSchema,
} from "@binference/engine";
import type { Selectable } from "kysely";
import { z } from "zod";
import type { EngineTables, TokensTable } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { field, jsonText, readJson } from "../rows/column-values.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

function toToken(row: Selectable<TokensTable>): TokenRecord {
  return tokenRecordSchema.parse({
    id: row.id,
    label: row.label,
    kind: row.kind,
    scopes: readJson(row.scopes),
    secretHash: row.secret_hash,
    createdAtMs: row.created_at,
    ...field("lastUsedAtMs", row.last_used_at),
    ...field("revokedAtMs", row.revoked_at),
  });
}

function readToken(database: DatabaseSync, id: Id<"tok">): Selectable<TokensTable> | undefined {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  return takeFirst(kysely.selectFrom("tokens").selectAll().where("id", "=", id));
}

type TokenStamp = Pick<TokensTable, "last_used_at" | "revoked_at">;

// Reads the token, applies the stamp to its row and writes both stamp columns back.
function stampToken(
  database: DatabaseSync,
  id: Id<"tok">,
  stamp: (row: Selectable<TokensTable>) => TokenStamp,
): Result<TokenRecord, "not_found"> {
  const row = readToken(database, id);
  if (row === undefined) {
    return err("not_found");
  }
  const stamped = stamp(row);
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  execute(kysely.updateTable("tokens").set(stamped).where("id", "=", id));
  return ok(toToken({ ...row, ...stamped }));
}

const tokenResult = resultSchema(tokenRecordSchema, ["not_found"]);

/** Saves a new token; an id or secret hash in use is `exists`. */
export const addTokenTask: StoreTask<TokenRecord, Result<TokenRecord, "exists">> = defineTask({
  name: "access.add_token",
  access: "write",
  input: tokenRecordSchema,
  output: resultSchema(tokenRecordSchema, ["exists"]),
  run(database, token) {
    const { kysely, execute, takeFirst } = createSyncKysely<EngineTables>(database);
    const taken = takeFirst(
      kysely
        .selectFrom("tokens")
        .select("id")
        .where((row) =>
          row.or([row("id", "=", token.id), row("secret_hash", "=", token.secretHash)]),
        ),
    );
    if (taken !== undefined) {
      return err("exists");
    }
    execute(
      kysely.insertInto("tokens").values({
        id: token.id,
        label: token.label,
        kind: token.kind,
        scopes: jsonText(token.scopes),
        secret_hash: token.secretHash,
        created_at: token.createdAtMs,
        last_used_at: token.lastUsedAtMs ?? null,
        revoked_at: token.revokedAtMs ?? null,
      }),
    );
    return ok(token);
  },
});

/** Finds the token whose secret has this hash. */
export const findTokenTask: StoreTask<Sha256Hex, TokenRecord | undefined> = defineTask({
  name: "access.find_token",
  access: "read",
  input: sha256HexSchema,
  output: tokenRecordSchema.optional(),
  run(database, secretHash) {
    const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
    const row = takeFirst(
      kysely.selectFrom("tokens").selectAll().where("secret_hash", "=", secretHash),
    );
    return row === undefined ? undefined : toToken(row);
  },
});

/** Lists every token, oldest first. */
export const listTokensTask: StoreTask<null, readonly TokenRecord[]> = defineTask({
  name: "access.list_tokens",
  access: "read",
  input: z.null(),
  output: z.array(tokenRecordSchema),
  run(database) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const tokens = kysely.selectFrom("tokens").selectAll().orderBy("created_at").orderBy("id");
    return execute(tokens).rows.map(toToken);
  },
});

/** Records a use; the last use only moves forward. */
export const markTokenUsedTask: StoreTask<
  StampedId<"tok">,
  Result<TokenRecord, "not_found">
> = defineTask({
  name: "access.mark_token_used",
  access: "write",
  input: stampedIdSchema("tok"),
  output: tokenResult,
  run: (database, use) =>
    stampToken(database, use.id, (row) => ({
      last_used_at: Math.max(row.last_used_at ?? use.atMs, use.atMs),
      revoked_at: row.revoked_at,
    })),
});

/** Revokes a token; a second revoke keeps the first time. */
export const revokeTokenTask: StoreTask<
  StampedId<"tok">,
  Result<TokenRecord, "not_found">
> = defineTask({
  name: "access.revoke_token",
  access: "write",
  input: stampedIdSchema("tok"),
  output: tokenResult,
  run: (database, revoke) =>
    stampToken(database, revoke.id, (row) => ({
      last_used_at: row.last_used_at,
      revoked_at: row.revoked_at ?? revoke.atMs,
    })),
});
