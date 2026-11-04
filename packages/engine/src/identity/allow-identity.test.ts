import { accountRefSchema, chainRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { setCeiling } from "../ceilings/set-ceiling.js";
import { fixtureId } from "../contracts/store-fixtures.js";
import { fakeOwnerKeyCode } from "../fakes/fake-ceiling-editor.js";
import { expectOk, testAgent, testWallet } from "../intents/test-intents.js";
import { testCall, type TestEngine } from "../operations/test-engine.js";
import { allowIdentity, type AllowIdentityOptions } from "./allow-identity.js";
import { createIdentityHost } from "./identity-host.js";
import type { IdentityRecord } from "./identity-record.js";
import { identityChains, startIdentityEngine, testRegistry } from "./test-identities.js";

const live = { signal: new AbortController().signal };
const owner = accountRefSchema.parse("fake:1:0x000000a1");
const router = accountRefSchema.parse("fake:1:0x0000000b");
const registryAccount = accountRefSchema.parse("fake:1:0x000000e5");
const policyId = `privy-policy-${testWallet.slice(-12)}`;

// The test agent's main wallet under a ceiling custody holds, calling the fake swap's router alone.
async function started(held: "call" | "none" = "none"): Promise<TestEngine> {
  const test = await startIdentityEngine(testRegistry(), {}, held);
  test.ceilings.put(policyId, [owner], { contracts: [router], perTxNativeBase: 10n ** 18n });
  return test;
}

// The opt-in's parts over the test engine's, with the identity binference holds of the agent.
function partsOf(test: TestEngine, stored?: IdentityRecord): AllowIdentityOptions {
  return {
    install: test.stores.install,
    agents: test.stores.agents,
    ceilings: test.ceilings,
    chains: identityChains(),
    clock: test.clock,
    publish: test.engineOptions.publish,
    journal: test.stores.configJournal,
    identity: createIdentityHost([testRegistry()], identityChains()),
    identities: { get: async () => Promise.resolve(stored) },
  };
}

async function contractsOf(test: TestEngine) {
  const read = await test.ceilings.read(policyId, live);
  return read.ok ? read.value.contracts : [];
}

const allowed = (test: TestEngine, ownerKey = fakeOwnerKeyCode) =>
  test.engine.handlers["identity/allow"](testCall({ agent: testAgent, ownerKey }));

describe("an agent's opt-in to an identity", () => {
  it("writes the registry's call into the main wallet's ceiling, read back, journaled and told", async () => {
    const test = await started();

    const answer = await allowed(test);

    expect(answer).toStrictEqual({ ok: true, value: { wallet: testWallet, changed: true } });
    expect(await contractsOf(test)).toStrictEqual([router, registryAccount]);
    const notices = test.pushes.filter((push) => push.topic === "notice").map((push) => push.data);
    expect(notices).toStrictEqual([
      {
        key: "notice.ceilingChange",
        agent: testAgent,
        values: { agent: "main", surface: "cli", change: "venues" },
      },
    ]);
    const changed = test.pushes.find((push) => push.kind === "config/changed");
    expect(changed?.data).toMatchObject({ path: "agents.main.ceiling", surface: "cli" });
  });

  it("leaves a ceiling that holds the call as it is, and asks custody nothing", async () => {
    const test = await started("call");

    const answer = await allowed(test, "bnok1wrong");

    expect(answer).toStrictEqual({ ok: true, value: { wallet: testWallet, changed: false } });
    expect(await contractsOf(test)).toStrictEqual([router]);
  });

  it("refuses a wrong owner key and changes nothing", async () => {
    const test = await started();

    expect(await allowed(test, "bnok1wrong")).toStrictEqual({
      ok: false,
      error: "wallet.bad_owner_key",
    });
    expect(await contractsOf(test)).toStrictEqual([router]);
  });

  it("refuses an agent binference holds an identity of, before custody hears of it", async () => {
    const test = await started();
    const stored = {
      agentId: testAgent,
      chain: chainRefSchema.parse("fake:1"),
      registry: registryAccount,
      onchainId: "7",
      txHash: `0x${"ab".repeat(32)}`,
      registeredAtMs: 1,
      file: "data:application/json;base64,e30=",
    } as IdentityRecord;
    const call = testCall({ agent: testAgent, ownerKey: fakeOwnerKeyCode });

    const answer = await allowIdentity(partsOf(test, stored), call);

    expect(answer).toStrictEqual({ ok: false, error: "intent.identity_exists" });
    expect(await contractsOf(test)).toStrictEqual([router]);
  });

  it("refuses an unknown agent, and a main wallet whose ceiling custody does not hold", async () => {
    const test = await startIdentityEngine(testRegistry(), {}, "none");
    const stranger = fixtureId("agt", 9);
    const handler = test.engine.handlers["identity/allow"];

    expect(await handler(testCall({ agent: stranger, ownerKey: fakeOwnerKeyCode }))).toStrictEqual({
      ok: false,
      error: "agent.not_found",
    });
    expect(await allowed(test)).toStrictEqual({ ok: false, error: "wallet.not_found" });
  });

  it("is kind_unavailable on an engine that runs no identity registry", async () => {
    const test = await started();
    const parts = { ...partsOf(test), identity: createIdentityHost([], identityChains()) };
    const call = testCall({ agent: testAgent, ownerKey: fakeOwnerKeyCode });

    await expect(allowIdentity(parts, call)).resolves.toStrictEqual({
      ok: false,
      error: "intent.kind_unavailable",
    });
  });

  it("lets a ceiling written after the agent registered leave the registry out", async () => {
    const test = await started();
    expectOk(await allowed(test));
    const options = {
      ...partsOf(test),
      venuesDone: async () => Promise.resolve(["fake-identity"]),
    };
    const call = testCall({
      wallet: testWallet,
      changes: { perTxNative: 5n },
      ownerKey: fakeOwnerKeyCode,
    });

    expectOk(await setCeiling(options, call));

    expect(await contractsOf(test)).toStrictEqual([router]);
  });
});
