import {
  confirmationStoreContract,
  idempotencyStoreContract,
  identityStoreContract,
  intentStoreContract,
  ledgerStoreContract,
  orderStoreContract,
  positionStoreContract,
  transactionStoreContract,
  unbondingStoreContract,
} from "@binference/engine/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { createSqliteIdempotencyStore } from "../ingress/sqlite-idempotency-store.js";
import {
  type CommitCut,
  type CommitCutProxy,
  type CutRule,
  startCommitCutProxy,
} from "../testing/commit-cut-proxy.js";
import {
  confirmationSubject,
  identitySubject,
  intentSubject,
  ledgerSubject,
  orderSubject,
  positionSubject,
  transactionSubject,
  unbondingSubject,
} from "../testing/money-store-subjects.js";
import {
  createTestPostgresStores,
  type TestPostgresStores,
} from "../testing/test-postgres-stores.js";

const url = inject("postgres");

// Every check of the money stores' contracts, with each write's COMMIT cut (decision 0438): cut
// after the server applied it, the write answers what it gave; cut before the server saw it, the
// write runs again, and every other one passes so the rerun lands. Each check holds as on an
// uncut database, so no money write answers differently, or stores twice, for a lost COMMIT.
function cutChecks(stores: () => TestPostgresStores) {
  const engine = async () => stores().open("engine");
  return [
    ...intentStoreContract({ create: async () => intentSubject(await engine()) }),
    ...identityStoreContract({ create: async () => identitySubject(await engine()) }),
    ...ledgerStoreContract({ create: async () => ledgerSubject(await engine()) }),
    ...positionStoreContract({ create: async () => positionSubject(await engine()) }),
    ...transactionStoreContract({ create: async () => transactionSubject(await engine()) }),
    ...orderStoreContract({ create: async () => orderSubject(await engine()) }),
    ...unbondingStoreContract({ create: async () => unbondingSubject(await engine()) }),
    ...idempotencyStoreContract({
      create: async () => createSqliteIdempotencyStore(await engine()),
    }),
    ...confirmationStoreContract({
      create: () => {
        const host = engine();
        return confirmationSubject({
          run: async (task, input, options) => (await host).run(task, input, options),
        });
      },
    }),
  ];
}

const cuts: readonly (readonly [CommitCut, CutRule])[] = [
  ["after", "each"],
  ["before", "alternate"],
];

// The file's one proxy, which the first host's pool starts.
const proxied: { proxy?: CommitCutProxy } = {};

function cutsSoFar(): number {
  return proxied.proxy?.cuts() ?? 0;
}

describe.runIf(url !== "")("the money stores on Postgres with every COMMIT answer cut", () => {
  let stores: TestPostgresStores;
  beforeAll(async () => {
    stores = await createTestPostgresStores(url, {
      route: async (settings) => {
        const proxy = await startCommitCutProxy(settings);
        proxied.proxy = proxy;
        return { ...settings, port: proxy.port };
      },
    });
  });
  afterAll(async () => {
    await stores.closeAll();
    await proxied.proxy?.close();
  });

  describe.each(cuts)("cut %s, %s write", (cut, rule) => {
    beforeEach(() => {
      proxied.proxy?.plan(cut, rule);
    });

    it.each(cutChecks(() => stores))("holds: $name", async ({ run }) => {
      const before = cutsSoFar();
      await expect(run()).resolves.toBeUndefined();
      expect(cutsSoFar()).toBeGreaterThan(before);
    });
  });
});
