import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Id, idSchema } from "@binference/core";
import { type IntentDraft, sha256Hex, type TokenRecord } from "@binference/engine";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type DatabaseHandle } from "../host/open-database.js";
import { openConnection } from "../sqlite/open-connection.worker.js";
import { plantAgent, type PlantedAgent } from "../testing/plant-agent.js";
import { engineWorker } from "./engine-database.js";
import { createSqliteEngineStores } from "./sqlite-engine-stores.js";

// Workers run the TypeScript source, as in the host's own tests.
const execArgv = ["--conditions=@binference/source", "--import", "tsx"];
const workerTest = { timeout: 60_000 };
const call = { signal: AbortSignal.timeout(30_000) };

function fixtureId<P extends string>(prefix: P, n: number): Id<P> {
  return idSchema(prefix).parse(`${prefix}_0190f1c2-3a4b-7c5d-8e6f-${String(n).padStart(12, "0")}`);
}

const opened: DatabaseHandle[] = [];
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map(async (handle) => handle.close()));
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true, maxRetries: 5 });
  }
});

// Opens and migrates an engine database on its store workers, with an agent and a wallet planted
// through a second connection that closes before the test goes on.
async function openEngine(): Promise<{ handle: DatabaseHandle; planted: PlantedAgent }> {
  const folder = mkdtempSync(join(tmpdir(), "bnf-store-"));
  folders.push(folder);
  const file = join(folder, "engine.sqlite");
  const handle = await openDatabase({ file, worker: engineWorker, execArgv, signal: call.signal });
  opened.push(handle);
  await handle.migrate(call);
  const connection = openConnection(file, { role: "writer", synchronous: "normal" });
  const planted = plantAgent(connection, 1);
  connection.close();
  return { handle, planted };
}

const token: TokenRecord = {
  id: fixtureId("tok", 1),
  label: "runtime",
  kind: "runtime",
  scopes: ["read", "propose"],
  secretHash: sha256Hex("bnt_secret"),
  createdAtMs: 1,
};

describe("the SQLite engine stores", () => {
  it("serve every port through the engine's store workers", workerTest, async () => {
    const stores = createSqliteEngineStores((await openEngine()).handle);
    await expect(stores.access.addToken(token, call)).resolves.toStrictEqual({
      ok: true,
      value: token,
    });
    await expect(stores.access.findToken(token.secretHash, call)).resolves.toStrictEqual(token);
    const change = { atMs: 2, by: token.id, surface: "cli", path: "agents.main.locale" };
    await expect(stores.configJournal.record(change, call)).resolves.toStrictEqual({
      ...change,
      id: 1,
    });
    const update = { source: "telegram", sourceKey: "tg:1:1", payload: {}, receivedAtMs: 3 };
    await expect(
      stores.inbox.admit({ ...update, source: "telegram" }, call),
    ).resolves.toMatchObject({ kind: "new" });
    const lookup = {
      credential: token.id,
      op: "intent/propose",
      key: "k",
      argsHash: token.secretHash,
    };
    await stores.idempotency.remember({ ...lookup, result: 1, atMs: 4 }, call);
    await expect(stores.idempotency.recall(lookup, call)).resolves.toStrictEqual({
      kind: "repeat",
      result: 1,
    });
    await expect(stores.agents.list(call)).resolves.toHaveLength(1);
  });

  it("lets exactly one of two racing moves win through the one writer", workerTest, async () => {
    const { handle, planted } = await openEngine();
    const { intents, ledger } = createSqliteEngineStores(handle);
    const draft: IntentDraft = {
      ...planted,
      id: fixtureId("int", 1),
      kind: "swap",
      state: "awaiting_confirmation",
      request: {},
      hasOutsideContent: false,
      isPaper: true,
      proposer: "engine",
      atMs: 10,
      cause: {},
    };
    await intents.create(draft, call);
    const answer = (state: "confirmed" | "denied", n: number) =>
      intents.transition(
        {
          id: draft.id,
          expectedVersion: 0,
          state,
          atMs: 20,
          cause: { by: "owner" },
          ledger: { id: fixtureId("led", n), atMs: 20, kind: state, data: {} },
        },
        call,
      );
    const outcomes = await Promise.all([answer("confirmed", 1), answer("denied", 2)]);
    expect(outcomes).toMatchObject([{ ok: true }, { ok: false, error: "stale" }]);
    await expect(intents.get(draft.id, call)).resolves.toMatchObject({
      state: "confirmed",
      version: 1,
    });
    await expect(ledger.list({ after: 0, limit: 10 }, call)).resolves.toHaveLength(1);
  });
});
