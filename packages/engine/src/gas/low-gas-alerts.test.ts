import { type AccountRef, type AssetRef, accountRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { testAgent, testCoin, testSwap, testWallet } from "../intents/test-intents.js";
import { startTestEngine, type TestEngine, testCall } from "../operations/test-engine.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { createLowGasAlerts, type GasReading } from "./low-gas-alerts.js";

const account: AccountRef = accountRefSchema.parse("fake:1:0x0000000c");
const reading: GasReading = {
  agent: testAgent,
  wallet: testWallet,
  account,
  nativeAsset: testCoin,
  balanceBase: 3n,
  reserveBase: 2n,
};

function alerts(): { readonly pushes: EnginePush[]; readonly check: (r: GasReading) => void } {
  const pushes: EnginePush[] = [];
  const low = createLowGasAlerts({ publish: (push) => pushes.push(push) });
  return { pushes, check: (r) => low.check(r) };
}

function lowGasNotice(balance: bigint, asset: AssetRef = testCoin): EnginePush {
  return {
    topic: "notice",
    kind: "notice/new",
    data: {
      key: "notice.lowGas",
      agent: testAgent,
      values: { wallet: "0x0000000c" },
      amounts: { balance: { asset, base: String(balance) } },
    },
  };
}

function walletAccount(n: number): AccountRef {
  return accountRefSchema.parse(`fake:1:0x${n.toString(16).padStart(8, "0")}`);
}

function notices(test: TestEngine): readonly EnginePush[] {
  return test.pushes.filter((push) => push.topic === "notice");
}

describe("the low-gas alert", () => {
  it("tells the owner once a wallet holds less than twice its reserve", () => {
    const { pushes, check } = alerts();
    check({ ...reading, balanceBase: 4n });
    check(reading);
    check({ ...reading, balanceBase: 1n });

    expect(pushes).toStrictEqual([lowGasNotice(3n)]);
  });

  it("tells the owner again after the wallet was topped up and ran low once more", () => {
    const { pushes, check } = alerts();
    check(reading);
    check({ ...reading, balanceBase: 4n });
    check({ ...reading, balanceBase: 2n });

    expect(pushes).toStrictEqual([lowGasNotice(3n), lowGasNotice(2n)]);
  });

  it("stays quiet for a chain where the wallet keeps no reserve", () => {
    const { pushes, check } = alerts();
    check({ ...reading, balanceBase: 0n, reserveBase: 0n });

    expect(pushes).toStrictEqual([]);
  });

  it("forgets the oldest low wallet past a thousand, at worst telling the owner again", () => {
    const { pushes, check } = alerts();
    for (let n = 0; n <= 1_000; n += 1) {
      check({ ...reading, account: walletAccount(n) });
    }
    check({ ...reading, account: walletAccount(0) });
    check({ ...reading, account: walletAccount(1_000) });

    expect(pushes).toHaveLength(1_002);
  });
});

describe("the money path's gas check", () => {
  it("alerts the owner when a live wallet's balance it reads is low", async () => {
    const test = await startTestEngine({
      agent: { mode: "live" },
      facts: { nativeBalanceBase: 15n * 10n ** 14n },
    });
    await test.engine.handlers["intent/propose"](testCall(testSwap()));

    expect(notices(test)).toStrictEqual([lowGasNotice(15n * 10n ** 14n)]);
  });

  it("never alerts for a paper wallet", async () => {
    const test = await startTestEngine({ paper: [{ asset: testCoin, base: 10n ** 15n }] });
    await test.engine.handlers["intent/propose"](testCall(testSwap()));

    expect(notices(test)).toStrictEqual([]);
  });
});
