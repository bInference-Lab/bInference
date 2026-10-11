import { accountRefSchema, chainRefSchema } from "@binference/chain";
import { err, type Id, idSchema } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import type { CeilingChanges } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createFakeCeilingEditor, fakeOwnerKeyCode } from "../fakes/fake-ceiling-editor.js";
import type { WalletRecord } from "../install/install-record.js";
import type { CeilingEditor } from "../install/ports.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { expectOk, testAgent, testNowMs } from "../intents/test-intents.js";
import {
  startTestEngine,
  type TestEngine,
  testCall,
  testChains,
} from "../operations/test-engine.js";

const owner = accountRefSchema.parse("fake:1:0x000000a1");
const swapRouter = accountRefSchema.parse("fake:1:0x0000000b");
const otherAgent = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000009");

function wallet(n: number, agentId: Id<"agt"> = testAgent, archivedAtMs?: number): WalletRecord {
  return testWalletRecord({
    id: idSchema("wal").parse(`wal_0190f1c2-3a4b-7c5d-8e6f-0000000000c${String(n)}`),
    agentId,
    label: `wallet ${String(n)}`,
    createdAtMs: testNowMs - 1_000 + n,
    ...(archivedAtMs === undefined ? {} : { archivedAtMs }),
  });
}

const [first, second, archived, others] = [
  wallet(1),
  wallet(2),
  wallet(3, testAgent, testNowMs - 10),
  wallet(4, otherAgent),
];

// The agent's two live wallets, an archived one and another agent's, each under a ceiling that
// lets a call reach the fake swap with at most 5 base units of the coin.
async function started(): Promise<TestEngine> {
  const test = await startTestEngine({ chains: testChains(["other-swap"]) });
  for (const item of [first, second, archived, others]) {
    test.stores.install.addWallet(item);
    test.ceilings.put(item.policyId, [owner], { contracts: [swapRouter], perTxNativeBase: 5n });
  }
  return test;
}

// The agent's two live wallets under ceilings custody holds, and custody that then refuses every
// change of calls as a ceiling it no longer holds.
async function startedOverRefusingCustody(): Promise<TestEngine> {
  const chains = testChains(["other-swap"]);
  const held = createFakeCeilingEditor({ clock: createManualClock(testNowMs), chains });
  const refusing: CeilingEditor = {
    ...held,
    setCalls: async () => Promise.resolve(err("not_found")),
  };
  const test = await startTestEngine({ chains, ceilings: refusing });
  for (const item of [first, second]) {
    test.stores.install.addWallet(item);
    held.put(item.policyId, [owner], { contracts: [swapRouter], perTxNativeBase: 5n });
  }
  return test;
}

function setCeiling(test: TestEngine, changes: CeilingChanges, ownerKey = fakeOwnerKeyCode) {
  return test.engine.handlers["ceiling/set"](testCall({ wallet: first.id, changes, ownerKey }));
}

async function capOf(test: TestEngine, policyId: string): Promise<bigint | undefined> {
  const read = await test.ceilings.read(policyId, { signal: new AbortController().signal });
  return read.ok ? read.value.perTxNativeBase : undefined;
}

async function storedCaps(test: TestEngine): Promise<readonly bigint[]> {
  const { wallets } = await test.stores.install.read({ signal: new AbortController().signal });
  return wallets.map((item) => item.ceiling.perTxNativeBase);
}

function notices(test: TestEngine) {
  return test.pushes.filter((push) => push.topic === "notice").map((push) => push.data);
}

const both: CeilingChanges = { venues: ["fake-swap", "other-swap"], perTxNative: 9n };

describe("changing a ceiling with the owner key", () => {
  it("changes every live wallet of the agent, their stored copies, and answers the named one", async () => {
    const test = await started();

    const view = expectOk(await setCeiling(test, both));

    expect(view).toStrictEqual({
      wallet: first.id,
      chains: ["fake:1"],
      venues: ["fake-swap", "other-swap"],
      perTxNative: 9n,
      recipients: [owner],
      dayCaps: [],
      readAt: testNowMs,
    });
    const caps = await Promise.all(
      [first, second, archived, others].map(async (item) => capOf(test, item.policyId)),
    );
    expect(caps).toStrictEqual([9n, 9n, 5n, 5n]);
    expect(await storedCaps(test)).toStrictEqual([9n, 9n, 10n ** 18n, 10n ** 18n]);
  });

  it("is journaled and announced on every surface with what moved", async () => {
    const test = await started();

    expectOk(await setCeiling(test, { perTxNative: 7n }));
    expectOk(await setCeiling(test, { venues: ["fake-swap", "other-swap"] }));
    expectOk(await setCeiling(test, { venues: ["fake-swap"], perTxNative: 8n }));

    expect(notices(test)).toStrictEqual(
      ["cap", "venues", "both"].map((change) => ({
        key: "notice.ceilingChange",
        agent: testAgent,
        values: { agent: "main", surface: "cli", change },
      })),
    );
    const changed = test.pushes.filter((push) => push.kind === "config/changed");
    expect(changed).toHaveLength(3);
    expect(changed[0]?.data).toMatchObject({ path: "agents.main.ceiling", surface: "cli" });
  });

  it("lets the agent's limits add a venue only once its ceiling holds it", async () => {
    const test = await started();
    const addVenue = async () =>
      test.engine.handlers["limit/set"](
        testCall({ agent: testAgent, changes: { venues: ["fake-swap", "other-swap"] } }),
      );

    expect(await addVenue()).toStrictEqual(err("limit.over_ceiling"));
    expectOk(await setCeiling(test, { venues: ["fake-swap", "other-swap"] }));
    expect((await addVenue()).ok).toBe(true);
  });

  it("refuses other chains, no venue, an unknown venue and a venue the limits name", async () => {
    const test = await started();
    const chains = [chainRefSchema.parse("fake:1"), chainRefSchema.parse("fake:2")];

    const answers = [
      await setCeiling(test, { chains }),
      await setCeiling(test, { venues: [] }),
      await setCeiling(test, { venues: ["no-such-venue"] }),
      await setCeiling(test, { venues: ["other-swap"] }),
    ];

    expect(answers).toStrictEqual([
      err("protocol.bad_args"),
      err("protocol.bad_args"),
      err("protocol.bad_args"),
      err("limit.venue_in_use"),
    ]);
    expect(await capOf(test, first.policyId)).toBe(5n);
    expect(notices(test)).toStrictEqual([]);
  });

  it("takes the chains the ceiling enables, and the same calls twice without a notice", async () => {
    const test = await started();
    const same = {
      chains: [chainRefSchema.parse("fake:1")],
      venues: ["fake-swap"],
      perTxNative: 5n,
    };

    expect(expectOk(await setCeiling(test, same)).perTxNative).toBe(5n);
    expect(notices(test)).toStrictEqual([]);
  });

  it("refuses another key, an archived wallet and one the install does not hold", async () => {
    const test = await started();
    const named = (id: Id<"wal">) =>
      test.engine.handlers["ceiling/set"](
        testCall({ wallet: id, changes: both, ownerKey: fakeOwnerKeyCode }),
      );

    expect(await setCeiling(test, both, "bnok1aaaaa bbbbb ccccc ddddd eeeee")).toStrictEqual(
      err("wallet.bad_owner_key"),
    );
    expect(await named(archived.id)).toStrictEqual(err("wallet.not_found"));
    expect(await named(wallet(9).id)).toStrictEqual(err("wallet.not_found"));
    expect(await capOf(test, first.policyId)).toBe(5n);
  });

  it("refuses a wallet of an agent the engine does not hold", async () => {
    const test = await started();
    const call = { wallet: others.id, changes: both, ownerKey: fakeOwnerKeyCode };

    expect(await test.engine.handlers["ceiling/set"](testCall(call))).toStrictEqual(
      err("agent.not_found"),
    );
    expect(await capOf(test, others.policyId)).toBe(5n);
  });

  it("changes no ceiling while custody holds none for one of the agent's live wallets", async () => {
    const test = await started();
    const unheld = wallet(5);
    test.stores.install.addWallet(unheld);

    expect(await setCeiling(test, both)).toStrictEqual(err("wallet.not_found"));
    expect([await capOf(test, first.policyId), await capOf(test, second.policyId)]).toStrictEqual([
      5n,
      5n,
    ]);
  });

  it("answers custody's refusal of the change, and announces nothing that did not move", async () => {
    const test = await startedOverRefusingCustody();

    expect(await setCeiling(test, both)).toStrictEqual(err("wallet.not_found"));
    expect(notices(test)).toStrictEqual([]);
    expect(await storedCaps(test)).toStrictEqual([5n, 5n]);
  });
});
