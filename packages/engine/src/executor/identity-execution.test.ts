import { accountRefSchema, type TxDraft } from "@binference/chain";
import type { IdentityRegistry } from "@binference/chain/identity";
import type { FakeIdentityRegistry } from "@binference/chain/testing";
import { BinferenceError, err, type Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { createIdentityHost } from "../identity/identity-host.js";
import {
  holdIdentityWallet,
  identityChains,
  registerRequest,
  registrySimulator,
  testRegistry,
  testVersion,
} from "../identity/test-identities.js";
import { planDocument } from "../intents/intent-documents.schema.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { expectOk, testAgent, testLimits } from "../intents/test-intents.js";
import { testAccount, testCall } from "../operations/test-engine.js";
import type { IntentStore } from "../ports.js";
import { createCardShowings } from "../surfaces/create-card-showings.js";
import { coinAfter, holdCoin } from "./test-coin.js";
import {
  type BenchOptions,
  benchChain,
  driveUntil,
  type ExecutorBench,
  eventsOf,
  startExecutorBench,
  stateOf,
  tapped,
} from "./test-executor.js";

const live = { signal: new AbortController().signal };
const done = ["reconciled", "failed_check", "failed_onchain", "expired", "cancelled"] as const;
// The agent's limits name no identity venue: the owner's opt-in is the ceiling's call.
const limits = testLimits;

// The fake registry as the engine and the executor run it: a registration lands in it under the
// hash the network gave its transaction once the executor reads it back, and `after` runs then.
// The first `lagging` reads back reject, as a node a few blocks behind holds no receipt yet.
function landingOnRead(
  registry: FakeIdentityRegistry,
  after: () => void,
  lagging = 0,
): IdentityRegistry {
  const built: TxDraft[] = [];
  const lag = { left: lagging };
  return {
    ...registry,
    build: (request) => {
      const draft = registry.build(request);
      built.push(draft);
      return draft;
    },
    landed: async (request, options) => {
      if (lag.left > 0) {
        lag.left -= 1;
        throw new BinferenceError({ code: "erc8004.read_failed", message: "No receipt yet." });
      }
      const [draft] = built;
      if (draft !== undefined) {
        registry.land(draft, request.txHash);
        after();
      }
      return registry.landed(request, options);
    },
  };
}

// The executor's intent store with another registration of the agent signed and on its way, as a
// first registration whose step no stuck rule could move leaves it.
function withRegistrationOnItsWay(store: IntentStore): IntentStore {
  return {
    ...store,
    list: async (query, options) => {
      const found = await store.list(query, options);
      if (!query.states.includes("executing")) {
        return found;
      }
      const mine = { states: ["confirmed" as const], limit: 1 };
      const [first] = await store.list({ ...query, ...mine }, options);
      return first === undefined
        ? found
        : [...found, { ...first, id: fixtureId("int", 0x99), state: "executing" as const }];
    },
  };
}

// The executor's intent store over an agent that holds an identity already: a move that stores
// another is stale and writes nothing, as the SQLite store's is (decision 0413).
function withIdentityHeld(store: IntentStore): IntentStore {
  return {
    ...store,
    transition: async (change, options) =>
      change.identity === undefined ? store.transition(change, options) : err("stale"),
  };
}

// How a bench differs: what runs once a registration lands, how many reads back lag, the
// executor's intent store and its limits.
interface BenchWith {
  readonly after?: () => void;
  readonly lagging?: number;
  readonly intents?: (store: IntentStore) => IntentStore;
  readonly limits?: BenchOptions["limits"];
  /** Whether the executor runs the registry the engine proposes through; it does when absent. */
  readonly isRegistryRun?: boolean;
}

// The executor's intent store, a registration's stored plan read back as another call.
function withPlan(draft: TxDraft): (store: IntentStore) => IntentStore {
  const plan = planDocument.encode([draft]);
  const swapped = (record: IntentRecord): IntentRecord =>
    record.kind === "registerIdentity" ? { ...record, plan } : record;
  return (store) => ({
    ...store,
    get: async (id, options) => {
      const record = await store.get(id, options);
      return record === undefined ? undefined : swapped(record);
    },
  });
}

async function benchWith(
  registry: FakeIdentityRegistry,
  given: BenchWith = {},
): Promise<ExecutorBench> {
  const { after = () => undefined, lagging = 0, intents, limits: limited } = given;
  const chains = identityChains();
  const landing = landingOnRead(registry, after, lagging);
  const bench = await startExecutorBench({
    hold: true,
    ...(intents === undefined ? {} : { intents }),
    ...(limited === undefined ? {} : { limits: limited }),
    agent: { limits },
    engine: {
      chains,
      identity: { registries: [landing], version: testVersion },
      chainSimulator: registrySimulator(registry),
    },
    routing: {
      chains,
      ...(given.isRegistryRun === false ? {} : { identity: createIdentityHost([landing], chains) }),
    },
  });
  holdIdentityWallet(bench.test, registry);
  return bench;
}

function notices(bench: ExecutorBench) {
  return bench.pushes.flatMap((push) => (push.kind === "notice/new" ? [push.data] : []));
}

async function reasonOf(bench: ExecutorBench, intent: Id<"int">) {
  return (await bench.test.stores.intents.get(intent, live))?.reason;
}

// The signed bytes of an intent's speed-up, its second stored transaction.
async function speedUpRaw(bench: ExecutorBench, intent: Id<"int">): Promise<string> {
  const [, speedUp] = await bench.test.stores.transactions.ofIntent(intent, live);
  if (speedUp === undefined) {
    throw new Error("Expected a speed-up.");
  }
  return speedUp.raw;
}

describe("an identity registration on its wallet's queue", () => {
  it("signs its one call to the registry, reads it back and stores the identity once", async () => {
    const registry = testRegistry();
    const bench = await benchWith(registry);
    const intent = await tapped(bench, registerRequest("Buys dips"));
    await bench.release();
    await expect(driveUntil(bench, intent, { states: done })).resolves.toBe("reconciled");
    expect(
      bench.signed.map(({ step, allowed }) => [step.action.kind, allowed.contracts]),
    ).toStrictEqual([["call", ["fake:1:0x000000e5"]]]);
    const [signed] = bench.signed;
    expect(signed?.allowed).toMatchObject({
      spenders: [],
      recipients: [],
      unapproved: ["fake:1:0x000000e5"],
      calls: [{ contract: "fake:1:0x000000e5", abi: { name: "register" } }],
    });
    const card = {
      name: "main",
      description: "Buys dips",
      wallet: testAccount,
      version: testVersion,
    };
    const got = expectOk(
      await bench.test.engine.handlers["identity/get"](testCall({ agent: testAgent })),
    );
    expect(got.registration).toMatchObject({
      registry: "fake:1:0x000000e5",
      onchainId: "0",
      file: registry.fileOf(card),
    });
    const showings = createCardShowings({
      ...bench.test.stores,
      chains: identityChains(),
      venues: { hasNoDeadline: () => false },
    });
    const ended = await showings.settled(intent, live);
    expect(ended?.live?.outcome).toMatchObject({ kind: "registered", agentId: "0" });
    await expect(
      bench.test.engine.handlers["identity/register"](testCall({ agent: testAgent })),
    ).resolves.toStrictEqual({ ok: false, error: "intent.identity_exists" });
  });

  it("takes the registration's gas, and nothing else, out of the coin's position", async () => {
    const registry = testRegistry();
    const bench = await benchWith(registry);
    await holdCoin(bench);
    const intent = await tapped(bench, registerRequest());
    await bench.release();
    await expect(driveUntil(bench, intent, { states: done })).resolves.toBe("reconciled");
    const { held, gas } = await coinAfter(bench, intent);
    expect(gas).toBeGreaterThan(0n);
    expect(held).toBe(10n ** 18n - gas);
  });

  it("takes a dropped registration's gas once when it landed after all, storing no identity", async () => {
    const registry = testRegistry();
    const rules = { stuckAfterBlocks: 3, replaceAfterBlocks: 6, droppedAfterBlocks: 9 };
    const bench = await benchWith(registry, { limits: rules });
    await holdCoin(bench);
    bench.network.script("relay-a", { kind: "refuse", reason: "insufficient_funds" });
    bench.network.script("relay-b", { kind: "refuse", reason: "insufficient_funds" });
    const intent = await tapped(bench, registerRequest());
    await bench.release();
    await expect(driveUntil(bench, intent, { states: done })).resolves.toBe("failed_onchain");
    bench.network.script("relay-a", { kind: "accept" });
    bench.network.script("relay-b", { kind: "accept" });
    const raw = await speedUpRaw(bench, intent);
    await bench.network.send({ chain: benchChain, raw }, live);
    await driveUntil(bench, intent, { states: [], blocks: 8 });
    const { held, gas } = await coinAfter(bench, intent);
    expect(gas).toBeGreaterThan(0n);
    expect(held).toBe(10n ** 18n - gas);
    await expect(stateOf(bench, intent)).resolves.toBe("failed_onchain");
    await expect(
      bench.test.engine.handlers["identity/get"](testCall({ agent: testAgent })),
    ).resolves.toStrictEqual({ ok: true, value: {} });
  });

  it("refuses a second registration from the identity it stored, though the token moved away", async () => {
    const registry = testRegistry();
    const bench = await benchWith(registry);
    const intent = await tapped(bench, registerRequest());
    await bench.release();
    await expect(driveUntil(bench, intent, { states: done })).resolves.toBe("reconciled");
    registry.tamper("0", { owner: accountRefSchema.parse("fake:1:0x000000ff") });
    await expect(
      bench.test.engine.handlers["identity/register"](testCall({ agent: testAgent })),
    ).resolves.toStrictEqual({ ok: false, error: "intent.identity_exists" });
  });

  it("stays finalized past the read-back's blocks, and recovery stores the identity later", async () => {
    const registry = testRegistry();
    const bench = await benchWith(registry, { lagging: 3, limits: { settleAfterBlocks: 1 } });
    const intent = await tapped(bench, registerRequest());
    await bench.release();
    await expect(driveUntil(bench, intent, { states: done, blocks: 8 })).resolves.toBe("finalized");
    expect(eventsOf(bench)).toContain("executor.settle_late:");
    await bench.executor.recover(live);
    await expect(driveUntil(bench, intent, { states: done })).resolves.toBe("reconciled");
    const got = expectOk(
      await bench.test.engine.handlers["identity/get"](testCall({ agent: testAgent })),
    );
    expect(got.registration?.onchainId).toBe("0");
  });

  it("ends with decode_mismatch when the stored call no longer registers the card's file", async () => {
    const registry = testRegistry();
    const other = registry.build({ wallet: testAccount, file: "data:,another" });
    const bench = await benchWith(registry, { intents: withPlan(other) });
    const intent = await tapped(bench, registerRequest());
    await bench.release();
    await expect(driveUntil(bench, intent, { states: done })).resolves.toBe("failed_check");
    await expect(reasonOf(bench, intent)).resolves.toBe("decode_mismatch");
    expect(bench.signed).toHaveLength(0);
  });

  it("ends with identity_exists when the wallet registered elsewhere before the queue took it", async () => {
    const registry = testRegistry();
    const bench = await benchWith(registry);
    const intent = await tapped(bench, registerRequest());
    registry.registerOutside(testAccount);
    await bench.release();
    await expect(driveUntil(bench, intent, { states: done })).resolves.toBe("failed_check");
    await expect(reasonOf(bench, intent)).resolves.toBe("identity_exists");
    expect(bench.signed).toHaveLength(0);
  });

  it("ends with identity_exists while another registration of the agent is on its way", async () => {
    const registry = testRegistry();
    const bench = await benchWith(registry, { intents: withRegistrationOnItsWay });
    const intent = await tapped(bench, registerRequest());
    await bench.release();
    await expect(driveUntil(bench, intent, { states: done })).resolves.toBe("failed_check");
    await expect(reasonOf(bench, intent)).resolves.toBe("identity_exists");
    expect(bench.signed).toHaveLength(0);
  });

  it("tells the owner of a second identity binference cannot store, and never throws on it", async () => {
    const registry = testRegistry();
    const bench = await benchWith(registry, { intents: withIdentityHeld });
    const intent = await tapped(bench, registerRequest());
    await bench.release();
    await expect(driveUntil(bench, intent, { states: done })).resolves.toBe("reconciled");
    expect(notices(bench)).toMatchObject([
      { key: "notice.identityDuplicate", values: { agent: "main" } },
    ]);
  });

  it("ends with registry_changed when the registry reports another version at the queue", async () => {
    const registry = testRegistry();
    const bench = await benchWith(registry);
    const intent = await tapped(bench, registerRequest());
    registry.setVersion("2.1.0");
    await bench.release();
    await expect(driveUntil(bench, intent, { states: done })).resolves.toBe("failed_check");
    await expect(reasonOf(bench, intent)).resolves.toBe("registry_changed");
    expect(bench.signed).toHaveLength(0);
  });

  it("ends with registry_changed when the registry's proxy runs another contract at the queue", async () => {
    const registry = testRegistry();
    const bench = await benchWith(registry);
    const intent = await tapped(bench, registerRequest());
    registry.upgrade(accountRefSchema.parse("fake:1:0x000000e7"));
    await bench.release();
    await expect(driveUntil(bench, intent, { states: done })).resolves.toBe("failed_check");
    await expect(reasonOf(bench, intent)).resolves.toBe("registry_changed");
    expect(bench.signed).toHaveLength(0);
  });

  it("waits while the registry cannot be read, then signs once it answers", async () => {
    const registry = testRegistry();
    const bench = await benchWith(registry);
    const intent = await tapped(bench, registerRequest());
    registry.down();
    await bench.release();
    await expect(driveUntil(bench, intent, { states: done, blocks: 2 })).resolves.toBe("confirmed");
    expect(eventsOf(bench)).toContain("executor.identity_unread:");
    registry.up();
    await expect(driveUntil(bench, intent, { states: done })).resolves.toBe("reconciled");
  });

  it("signs nothing and waits while the executor runs no registry the card named", async () => {
    const bench = await benchWith(testRegistry(), { isRegistryRun: false });
    const intent = await tapped(bench, registerRequest());
    await bench.release();
    await expect(driveUntil(bench, intent, { states: done, blocks: 3 })).resolves.toBe("confirmed");
    expect(eventsOf(bench)).toContain("executor.identity_unread:");
    expect(bench.signed).toStrictEqual([]);
  });

  it("reads back again while a lagging node holds no receipt, then stores the identity", async () => {
    const registry = testRegistry();
    const bench = await benchWith(registry, { lagging: 2 });
    const intent = await tapped(bench, registerRequest());
    await bench.release();
    await expect(driveUntil(bench, intent, { states: done })).resolves.toBe("reconciled");
    const got = expectOk(
      await bench.test.engine.handlers["identity/get"](testCall({ agent: testAgent })),
    );
    expect(got.registration?.onchainId).toBe("0");
    expect(notices(bench)).toStrictEqual([]);
  });

  it("stores the identity when the registry reads its holder back in another case", async () => {
    const registry = testRegistry();
    const bench = await benchWith(registry, {
      after: () => {
        registry.tamper("0", { owner: accountRefSchema.parse("fake:1:0x0000000C") });
      },
    });
    const intent = await tapped(bench, registerRequest());
    await bench.release();
    await expect(driveUntil(bench, intent, { states: done })).resolves.toBe("reconciled");
    const got = expectOk(
      await bench.test.engine.handlers["identity/get"](testCall({ agent: testAgent })),
    );
    expect(got.registration?.onchainId).toBe("0");
  });

  it("stores no identity and tells the owner when the registry finds no registration in it", async () => {
    const registry: FakeIdentityRegistry = {
      ...testRegistry(),
      landed: async () => Promise.resolve(err("not_found")),
    };
    const bench = await benchWith(registry);
    const intent = await tapped(bench, registerRequest());
    await bench.release();
    await expect(driveUntil(bench, intent, { states: done })).resolves.toBe("reconciled");
    await expect(
      bench.test.engine.handlers["identity/get"](testCall({ agent: testAgent })),
    ).resolves.toStrictEqual({ ok: true, value: {} });
    expect(notices(bench)).toMatchObject([
      { key: "notice.identityMismatch", values: { agent: "main" } },
    ]);
  });

  it("stores no identity and tells the owner when the registry reads back another file", async () => {
    const registry = testRegistry();
    const bench = await benchWith(registry, {
      after: () => {
        registry.tamper("0", { file: "data:,another" });
      },
    });
    const intent = await tapped(bench, registerRequest());
    await bench.release();
    await expect(driveUntil(bench, intent, { states: done })).resolves.toBe("reconciled");
    await expect(
      bench.test.engine.handlers["identity/get"](testCall({ agent: testAgent })),
    ).resolves.toStrictEqual({ ok: true, value: {} });
    expect(notices(bench)).toMatchObject([
      { key: "notice.identityMismatch", values: { agent: "main" } },
    ]);
    await expect(stateOf(bench, intent)).resolves.toBe("reconciled");
  });
});
