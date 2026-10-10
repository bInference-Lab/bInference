import { type AccountRef, accountRefSchema, type Amount } from "@binference/chain";
import { BinferenceError, type Id, idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { createFakeWalletFacts } from "../fakes/fake-wallet-facts.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { testAgent, testCoin, testNowMs, testWallet } from "../intents/test-intents.js";
import {
  startTestEngine,
  type TestEngine,
  testAccount,
  testChains,
  testFacts,
} from "../operations/test-engine.js";
import type { WalletFactsSource } from "../ports.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { createGasCheck } from "./check-gas.js";
import type { GasReading } from "./low-gas-alerts.js";

const live = { signal: new AbortController().signal };
// The test agent keeps 10^15 of the coin as its gas reserve on the fake chain.
const reserveBase = 10n ** 15n;
const otherWallet: Id<"wal"> = idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-000000000002");
const otherAccount: AccountRef = accountRefSchema.parse("fake:1:0x00000002");

function coins(base: bigint): readonly Amount[] {
  return [{ asset: testCoin, base }];
}

function lowGasNotices(test: TestEngine): readonly EnginePush[] {
  return test.pushes.filter((push) => JSON.stringify(push.data).includes("notice.lowGas"));
}

function record(id: Id<"wal">, address: string) {
  return {
    ...testWalletRecord({ id, agentId: testAgent, label: "main", createdAtMs: testNowMs }),
    address,
  };
}

// The test wallet stored at the test account's address, and another at its own.
function storeWallets(test: TestEngine, other: Partial<{ readonly archivedAtMs: number }> = {}) {
  test.stores.install.addWallet(record(testWallet, "0x0000000c"));
  test.stores.install.addWallet({ ...record(otherWallet, "0x00000002"), ...other });
}

// Balances that read from a table the test changes, as a chain would between two checks.
function heldTable(): { readonly held: Map<AccountRef, readonly Amount[]> } {
  return { held: new Map([[testAccount, coins(10n ** 18n)]]) };
}

// Balances of nothing for every account but one, whose read times out.
function failingFor(failed: AccountRef): WalletFactsSource {
  return {
    ...createFakeWalletFacts(new Map(), testFacts),
    balances: async ({ account, assets }) =>
      account === failed
        ? Promise.reject(new BinferenceError({ code: "rpc.timeout", message: "No answer." }))
        : Promise.resolve(assets.map((asset) => ({ asset, base: 0n }))),
  };
}

describe("the gas check", () => {
  it("tells the owner once a live wallet holds less than twice its reserve", async () => {
    const table = heldTable();
    table.held.set(otherAccount, coins(2n * reserveBase - 1n));
    const test = await startTestEngine({ agent: { mode: "live" }, held: table.held });
    storeWallets(test);
    await test.engine.checkGas(live);
    await test.engine.checkGas(live);
    expect(lowGasNotices(test)).toStrictEqual([
      {
        topic: "notice",
        kind: "notice/new",
        data: {
          key: "notice.lowGas",
          agent: testAgent,
          values: { wallet: "0x00000002" },
          amounts: { balance: { asset: testCoin, base: String(2n * reserveBase - 1n) } },
        },
      },
    ]);
  });

  it("tells the owner again once a wallet was topped up and ran low again", async () => {
    const table = heldTable();
    const test = await startTestEngine({ agent: { mode: "live" }, held: table.held });
    storeWallets(test);
    table.held.set(otherAccount, coins(reserveBase));
    await test.engine.checkGas(live);
    table.held.set(otherAccount, coins(2n * reserveBase));
    await test.engine.checkGas(live);
    table.held.set(otherAccount, coins(reserveBase));
    await test.engine.checkGas(live);
    expect(lowGasNotices(test)).toHaveLength(2);
  });

  it("reads no wallet of a paper agent, nor an archived wallet", async () => {
    const paper = await startTestEngine({ held: new Map() });
    storeWallets(paper);
    await paper.engine.checkGas(live);
    const archived = await startTestEngine({ agent: { mode: "live" }, held: heldTable().held });
    storeWallets(archived, { archivedAtMs: testNowMs });
    await archived.engine.checkGas(live);
    expect([...lowGasNotices(paper), ...lowGasNotices(archived)]).toStrictEqual([]);
  });

  it("reads a wallet only on the chains of its own family", async () => {
    const test = await startTestEngine({ agent: { mode: "live" }, held: new Map() });
    test.stores.install.addWallet({ ...record(otherWallet, "0x00000002"), family: "evm" });
    await test.engine.checkGas(live);
    expect(lowGasNotices(test)).toStrictEqual([]);
  });

  it("checks every wallet when one read fails, then throws that failure", async () => {
    const test = await startTestEngine({ agent: { mode: "live" } });
    storeWallets(test);
    const wallets = failingFor(testAccount);
    const checked: GasReading[] = [];
    const check = createGasCheck({
      agents: test.stores.agents,
      install: test.stores.install,
      wallets,
      chains: testChains(),
      lowGas: { check: (reading) => checked.push(reading) },
    });
    await expect(check(live)).rejects.toMatchObject({ code: "rpc.timeout" });
    expect(checked.map((reading) => reading.account)).toStrictEqual([otherAccount]);
  });
});
