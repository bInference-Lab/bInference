// Store adapter tests run their tasks on a connection in the test's own thread, which is why this
// file imports the connection layer and carries the worker suffix. Nothing in production uses it.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { BinferenceError } from "@binference/core";
import type { DatabaseDefinition } from "../databases/database-definition.js";
import { runMigrations } from "../migrations/run-migrations.js";
import { openConnection } from "../sqlite/open-connection.worker.js";
import { readTransaction, writeTransaction } from "../sqlite/transaction.js";
import type { StoreHost } from "../tasks/store-host.js";
import { toWorkerError } from "../worker/worker-error.js";
import type { WorkerValue } from "../worker/worker-messages.schema.js";

/** A migrated database for one test: the host its adapters use, and the connection to plant rows. */
export interface TestDatabase {
  readonly host: StoreHost;
  readonly database: DatabaseSync;
}

/** Opens migrated databases in one scratch folder, and closes and deletes them all at the end. */
export interface TestDatabases {
  open(definition: DatabaseDefinition): TestDatabase;
  closeAll(): void;
}

// A task call as a store worker serves it: the input and output cross a structured clone, the
// work runs in one transaction, and a fault comes back as the BinferenceError the worker sends.
function inThreadHost(database: DatabaseSync): StoreHost {
  return {
    run: async (task, input, options) => {
      options.signal.throwIfAborted();
      const request = structuredClone(input);
      const work = (): WorkerValue => task.handle(database, request);
      try {
        const value =
          task.access === "write"
            ? writeTransaction(database, work)
            : readTransaction(database, work);
        return await Promise.resolve(task.output.parse(structuredClone(value)));
      } catch (error) {
        throw new BinferenceError(toWorkerError(error));
      }
    },
  };
}

/** Creates a set of test databases that live in a fresh folder under the OS temp folder. */
export function createTestDatabases(): TestDatabases {
  const folder = mkdtempSync(join(tmpdir(), "bnf-store-test-"));
  const open: DatabaseSync[] = [];
  return {
    open(definition) {
      const database = openConnection(join(folder, `${String(open.length)}.sqlite`), {
        role: "writer",
        synchronous: "normal",
      });
      open.push(database);
      runMigrations(database, definition);
      return { host: inThreadHost(database), database };
    },
    // Every connection closes before the folder goes: Windows refuses to delete an open file.
    closeAll() {
      for (const database of open.splice(0)) {
        database.close();
      }
      rmSync(folder, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}
