import assert from "node:assert/strict";
import {
  accountRefSchema,
  assetRefSchema,
  type ChainRef,
  chainRefSchema,
  isTxHash,
} from "@binference/chain";
import { bpsSchema } from "@binference/core";
import type { NewLaunch } from "@binference/engine/market";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { createSqliteLaunchStore } from "../launches/sqlite-launch-store.js";
import type { StoreHost } from "../tasks/store-host.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

/** A launch's insiders column and the raw JSON text to put in it. */
interface InsidersText {
  readonly token: string;
  readonly text: string;
}

/**
 * Puts raw JSON text in a launch's insiders column, as a row written before decision 0416 may hold
 * it: the text of `\u0000`, which only a cast to `jsonb` reads as U+0000. The Postgres test stores'
 * engine worker lists it.
 */
export const setInsidersTextTask: StoreTask<InsidersText, null> = defineTask({
  name: "testing.set_insiders_text",
  access: "write",
  input: z.strictObject({ token: z.string(), text: z.string() }),
  output: z.null(),
  run(database, change) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    execute(
      kysely
        .updateTable("launches")
        .set({ insiders: change.text })
        .where("token", "=", change.token),
    );
    return null;
  },
});

/**
 * Reads a JSON field of every launch's insiders column at a path no array holds, so the read
 * casts each row's JSON as a query that filters on a field does. The Postgres test stores' engine
 * worker lists it.
 */
export const readInsidersFieldTask: StoreTask<null, readonly (string | null)[]> = defineTask({
  name: "testing.read_insiders_field",
  access: "read",
  input: z.null(),
  output: z.array(z.string().nullable()),
  run(database) {
    const { kysely, execute, jsonField } = createSyncKysely<EngineTables>(database);
    const query = kysely
      .selectFrom("launches")
      .select(jsonField("launches.insiders", ["held"]).as("held"));
    return execute(query).rows.map((row) => (row.held === null ? null : String(row.held)));
  },
});

const chain: ChainRef = chainRefSchema.parse("fake:1");
const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(30_000) });

// Launch `n` with `insiders` insiders, at block `n`.
function launchOf(n: number, insiders: number): NewLaunch {
  const hex = n.toString(16).padStart(8, "0");
  const txHash = `0x${n.toString(16).padStart(64, "0")}`;
  return {
    token: assetRefSchema.parse(`fake:1/token:0x${hex}`),
    launchpad: "test-pad",
    creator: accountRefSchema.parse("fake:1:0x000000a1"),
    quoteToken: assetRefSchema.parse("fake:1/slip44:1"),
    symbol: `T${String(n)}`,
    decimals: 18,
    taxBps: bpsSchema.parse(0),
    curveProgressBps: bpsSchema.parse(0),
    graduated: false,
    insiders: Array.from({ length: insiders }, (_, place) =>
      accountRefSchema.parse(`fake:1:0x${(0xb0 + place).toString(16).padStart(8, "0")}`),
    ),
    block: BigInt(n),
    blockHash: `0x${n.toString(16).padStart(64, "0")}`,
    txHash: isTxHash(txHash) ? txHash : assert.fail("not a hash"),
    logIndex: 0,
    launchedAtMs: 1_800_000_000_000 + n,
  };
}

/**
 * Two launches, the second's insiders column holding the text of `\u0000` as a row written
 * before decision 0416 may: a list that bounds the insiders and a JSON field read over the whole
 * table both still answer, on either database.
 */
export async function readsPastOldEscape(host: StoreHost): Promise<void> {
  const store = createSqliteLaunchStore(host);
  const [clean, old] = [launchOf(1, 0), launchOf(2, 2)];
  const read = { chain, from: 1n, to: 2n, toHash: old.blockHash, atMs: 1, changes: [] };
  await store.record({ ...read, launches: [clean, old] }, live());
  const text = String.raw`["\u0000", "fake:1:0x000000b1"]`;
  await host.run(setInsidersTextTask, { token: old.token, text }, live());
  const query = { chain, limit: 10, filters: { maxInsiders: 0 } };
  const listed = await store.list(query, live());
  assert.deepEqual(
    listed.map((launch) => launch.token),
    [clean.token],
  );
  assert.deepEqual(await host.run(readInsidersFieldTask, null, live()), [null, null]);
}
