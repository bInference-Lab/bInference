import { accountRefSchema, assetRefSchema } from "@binference/chain";
import { err, idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { testAgent, testNowMs } from "../intents/test-intents.js";
import { startTestEngine, type TestEngine, testCall } from "./test-engine.js";

const owner = accountRefSchema.parse("fake:1:0x000000a1");
const router = accountRefSchema.parse("fake:1:0x0000000b");
const wallet = testWalletRecord({
  id: idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-0000000000c1"),
  agentId: testAgent,
  label: "main",
  createdAtMs: testNowMs - 1_000,
});

function read(test: TestEngine, id = wallet.id) {
  return test.engine.handlers["ceiling/get"](testCall({ wallet: id }));
}

describe("reading a wallet's ceiling", () => {
  it("answers what custody holds now, with each venue whose contracts it lists", async () => {
    const test = await startTestEngine();
    test.stores.install.addWallet(wallet);
    const dayCap = {
      asset: assetRefSchema.parse("fake:1/slip44:1"),
      limit: 10n,
      windowSeconds: 86_400,
      floorUsdMicros: 1_000n,
    };
    const calls = { contracts: [router], perTxNativeBase: 5n, dayCaps: [dayCap] };
    test.ceilings.put(wallet.policyId, [owner], calls);

    expect(await read(test)).toStrictEqual({
      ok: true,
      value: {
        wallet: wallet.id,
        chains: ["fake:1"],
        venues: ["fake-swap"],
        perTxNative: 5n,
        recipients: [owner],
        dayCaps: [dayCap],
        readAt: testNowMs,
      },
    });
  });

  it("names no venue whose contracts the ceiling leaves out", async () => {
    const test = await startTestEngine();
    test.stores.install.addWallet(wallet);
    test.ceilings.put(wallet.policyId, [owner]);

    expect(await read(test)).toMatchObject({ ok: true, value: { venues: [] } });
  });

  it("refuses a wallet the install or custody does not hold", async () => {
    const test = await startTestEngine();
    test.stores.install.addWallet(wallet);
    const unknown = idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-0000000000c9");

    expect(await read(test, unknown)).toStrictEqual(err("wallet.not_found"));
    expect(await read(test)).toStrictEqual(err("wallet.not_found"));
  });
});
