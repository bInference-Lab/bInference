import { confirmationStoreContract } from "@binference/engine/testing";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { confirmationSubject } from "../testing/money-store-subjects.js";
import {
  createTestPostgresStores,
  type TestPostgresStores,
} from "../testing/test-postgres-stores.js";

const url = inject("postgres");

describe.runIf(url !== "")("the engine's confirmations over the intent store on Postgres", () => {
  let stores: TestPostgresStores;
  beforeAll(async () => {
    stores = await createTestPostgresStores(url);
  });
  afterAll(async () => {
    await stores.closeAll();
  });

  // The contract's create is synchronous: each check's install opens while its first call waits.
  it.each(
    confirmationStoreContract({
      create: () => {
        const host = stores.open("engine");
        return confirmationSubject({
          run: async (task, input, options) => (await host).run(task, input, options),
        });
      },
    }),
  )("follow the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
