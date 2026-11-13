import type { BinferenceError } from "@binference/core";
import { describe, expect, expectTypeOf, it } from "vitest";
import { listChangesTask } from "../audit/config-journal-tasks.js";
import { nthId } from "../contracts/agent-fixtures.js";
import { pruneIdempotencyTask } from "../ingress/idempotency-tasks.js";
import { workerIdSchema } from "../leases/agent-leases.js";
import { installSchemas } from "../migrations/install-schemas.js";
import type { PostgresDatabase } from "./open-postgres.js";
import { commitUnknown } from "./postgres-error.js";
import { createPostgresStoreHost, type PostgresStoreHostOptions } from "./postgres-store-host.js";
import type { PostgresTaskThread } from "./postgres-task-thread.js";

const installId = nthId("ins", 1);
const held = {
  installId,
  workerId: workerIdSchema.parse("worker-a"),
  fence: 1,
  takenAtMs: 0,
  expiresAtMs: 1,
};
const live = { signal: new AbortController().signal };

/** A promise a test settles when it chooses. */
interface Gate {
  readonly opened: Promise<void>;
  readonly open: () => void;
}

function ignore(): void {
  // Replaced before anything calls it.
}

function gate(): Gate {
  let open: () => void = ignore;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open: () => open() };
}

// A pool whose first write lost its COMMIT answer for good once `checked` settles, whose later
// writes would land, and whose reads find no rows.
function poolOf(
  checked: Promise<void> = Promise.resolve(),
): PostgresDatabase<unknown> & { readonly writes: () => number } {
  let writes = 0;
  return {
    write: async <Output>(): Promise<Output> => {
      writes += 1;
      if (writes > 1) {
        return 0 as Output;
      }
      await checked;
      throw commitUnknown(undefined, "742");
    },
    read: async <Output>(): Promise<Output> => [] as Output,
    close: async () => undefined,
    writes: () => writes,
  };
}

function hostOn(
  pool: PostgresDatabase<unknown>,
  told: BinferenceError[],
): ReturnType<typeof createPostgresStoreHost> {
  return createPostgresStoreHost({
    database: pool,
    thread: {} as PostgresTaskThread,
    schema: installSchemas(installId).engine,
    lease: { sharedSchema: "shared", held },
    onCommitUnknown: (fault) => told.push(fault),
  });
}

const prune = { beforeMs: 5, running: [] };
const unknown = { code: "store.commit_unknown", details: { transactionId: "742" } };

describe("a Postgres store host after a write's commit was unknown", () => {
  it("refuses every later write before the database, tells its owner once, and still reads", async () => {
    const pool = poolOf();
    const told: BinferenceError[] = [];
    const host = hostOn(pool, told);
    await expect(host.run(pruneIdempotencyTask, prune, live)).rejects.toMatchObject(unknown);
    await expect(host.run(pruneIdempotencyTask, prune, live)).rejects.toMatchObject(unknown);
    await expect(host.run(pruneIdempotencyTask, prune, live)).rejects.toMatchObject(unknown);
    expect(pool.writes()).toBe(1);
    expect(told.map(({ code }) => code)).toStrictEqual(["store.commit_unknown"]);
    await expect(host.run(listChangesTask, { after: 0, limit: 10 }, live)).resolves.toStrictEqual(
      [],
    );
  });

  it("refuses the writes queued behind it while its check ran", async () => {
    const check = gate();
    const pool = poolOf(check.opened);
    const told: BinferenceError[] = [];
    const host = hostOn(pool, told);
    const sent = [1, 2, 3].map(async () => host.run(pruneIdempotencyTask, prune, live));
    check.open();
    await Promise.all(sent.map(async (write) => expect(write).rejects.toMatchObject(unknown)));
    expect(pool.writes()).toBe(1);
    expect(told).toHaveLength(1);
  });

  it("takes a lease only with a stop for an unknown commit", () => {
    const place = {
      database: poolOf(),
      thread: {} as PostgresTaskThread,
      schema: installSchemas(installId).engine,
    };
    const lease = { sharedSchema: "shared", held };
    expectTypeOf(place).toExtend<PostgresStoreHostOptions<unknown>>();
    expectTypeOf({ ...place, lease }).not.toExtend<PostgresStoreHostOptions<unknown>>();
    expectTypeOf({
      ...place,
      lease,
      onCommitUnknown: (_fault: BinferenceError) => undefined,
    }).toExtend<PostgresStoreHostOptions<unknown>>();
  });
});
