import type { TxDraft } from "@binference/chain";
import type { IdentityRegistry } from "@binference/chain/identity";
import type { FakeIdentityRegistry } from "@binference/chain/testing";
import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { createIdentityHost } from "../identity/identity-host.js";
import {
  holdIdentityWallet,
  identityChains,
  registerRequest,
  registrySimulator,
  testIdentityVenue,
  testRegistry,
  testVersion,
} from "../identity/test-identities.js";
import { expectOk, testAgent, testLimits } from "../intents/test-intents.js";
import { testAccount, testCall } from "../operations/test-engine.js";
import { createCardShowings } from "../surfaces/create-card-showings.js";
import {
  driveUntil,
  type ExecutorBench,
  eventsOf,
  startExecutorBench,
  stateOf,
  tapped,
} from "./test-executor.js";

const live = { signal: new AbortController().signal };
const done = ["reconciled", "failed_check", "failed_onchain", "expired", "cancelled"] as const;
const limits = { ...testLimits, venues: [...testLimits.venues, testIdentityVenue] };

// The fake registry as the engine and the executor run it: a registration lands in it under the
// hash the network gave its transaction once the executor reads it back, and `after` runs then.
function landingOnRead(registry: FakeIdentityRegistry, after: () => void): IdentityRegistry {
  const built: TxDraft[] = [];
  return {
    ...registry,
    build: (request) => {
      const draft = registry.build(request);
      built.push(draft);
      return draft;
    },
    landed: async (request, options) => {
      const [draft] = built;
      if (draft !== undefined) {
        registry.land(draft, request.txHash);
        after();
      }
      return registry.landed(request, options);
    },
  };
}

async function benchWith(
  registry: FakeIdentityRegistry,
  after: () => void = () => undefined,
): Promise<ExecutorBench> {
  const chains = identityChains();
  const landing = landingOnRead(registry, after);
  const bench = await startExecutorBench({
    hold: true,
    agent: { limits },
    engine: {
      chains,
      identity: { registries: [landing], version: testVersion },
      chainSimulator: registrySimulator(registry),
    },
    routing: { chains, identity: createIdentityHost([landing]) },
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

  it("stores no identity and tells the owner when the registry reads back another file", async () => {
    const registry = testRegistry();
    const bench = await benchWith(registry, () => {
      registry.tamper("0", { file: "data:,another" });
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
