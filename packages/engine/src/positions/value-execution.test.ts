import { assetRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { valueExecution } from "./value-execution.js";

const coin = assetRefSchema.parse("fake:1/slip44:1");
const token = assetRefSchema.parse("fake:1/token:a");

describe("valueExecution", () => {
  it("values the sold amount and fee at the sold price and the gas at the coin's, rounded up", () => {
    const draft = valueExecution({
      intentId: fixtureId("int", 1),
      walletId: fixtureId("wal", 1),
      isPaper: true,
      atMs: 1_000,
      sold: { asset: token, base: 10n },
      feeBase: 1n,
      bought: { asset: coin, base: 3n },
      gas: { asset: coin, base: 3n },
      soldPrice: { numerator: 1n, denominator: 3n },
      gasPrice: { numerator: 5n, denominator: 2n },
    });
    // 10/3 = 3.33 rounds up to 4; 1/3 to 1; 3 x 5/2 = 7.5 to 8.
    expect(draft).toStrictEqual({
      intentId: fixtureId("int", 1),
      walletId: fixtureId("wal", 1),
      isPaper: true,
      atMs: 1_000,
      sold: { asset: token, base: 10n },
      feeBase: 1n,
      bought: { asset: coin, base: 3n },
      gas: { asset: coin, base: 3n },
      valueUsdMicros: 4n,
      feeUsdMicros: 1n,
      gasUsdMicros: 8n,
    });
  });
});
