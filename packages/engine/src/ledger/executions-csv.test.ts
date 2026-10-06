import { assetRefSchema, type TxHash } from "@binference/chain";
import type { AssetInfos } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import type { ExecutionRecord } from "../positions/execution-record.js";
import { executionsCsv, executionsCsvColumns } from "./executions-csv.js";

const coin = assetRefSchema.parse("fake:1/slip44:1");
const token = assetRefSchema.parse("fake:1/token:a");
const stable = assetRefSchema.parse("fake:1/token:b");
const whole = 10n ** 18n;
const txHash = `0x${"ab".repeat(32)}` as TxHash;

const info = (symbol: string, decimals: number) =>
  ({ symbol, name: symbol, decimals, verified: true }) as const;
const assets: AssetInfos = {
  [coin]: info("BNB", 18),
  [token]: info("TKN", 18),
  [stable]: info("USDT", 6),
};

function execution(id: number, fields: Partial<ExecutionRecord>): ExecutionRecord {
  return {
    id,
    intentId: fixtureId("int", id),
    walletId: fixtureId("wal", 1),
    isPaper: false,
    atMs: 1_791_365_400_000,
    sold: { asset: coin, base: whole },
    feeBase: 2_500_000_000_000_000n,
    bought: { asset: token, base: 1_000n * whole },
    gas: { asset: coin, base: 500_000_000_000_000n },
    txHash,
    valueUsdMicros: 600_000_000n,
    feeUsdMicros: 1_500_000n,
    gasUsdMicros: 300_000n,
    ...fields,
  };
}

// The hand-worked example's first and third trades (see create-positions.test.ts).
const executions: readonly ExecutionRecord[] = [
  execution(1, {}),
  execution(3, {
    atMs: 1_791_381_909_250,
    sold: { asset: token, base: 700n * whole },
    feeBase: 1_750_000_000_000_000_000n,
    bought: { asset: stable, base: 558_600_000n },
    gas: { asset: coin, base: 400_000_000_000_000n },
    valueUsdMicros: 560_000_000n,
    feeUsdMicros: 1_400_000n,
    gasUsdMicros: 260_000n,
  }),
];

const header =
  "Date,Sent Amount,Sent Currency,Received Amount,Received Currency,Fee Amount,Fee Currency," +
  "Net Worth Amount,Net Worth Currency,Label,Description,TxHash\r\n";

describe("executionsCsv", () => {
  it("writes a header and one row per execution, in exact decimals and UTC times", () => {
    expect(executionsCsv(executions, assets)).toBe(
      header +
        `2026-10-07 09:30:00,1.0025,BNB,1000,TKN,0.0005,BNB,601.5,USD,,${fixtureId("int", 1)},${txHash}\r\n` +
        `2026-10-07 14:05:09,701.75,TKN,558.6,USDT,0.0004,BNB,561.4,USD,,${fixtureId("int", 3)},${txHash}\r\n`,
    );
  });

  it("keeps the columns of the tax tools' import layout in a fixed order", () => {
    expect(executionsCsvColumns.join(",")).toBe(header.trimEnd());
  });

  it("writes only the header when there is nothing to export", () => {
    expect(executionsCsv([], {})).toBe(header);
  });

  it("leaves the fee cells empty for a paper fill that paid no gas and has no transaction", () => {
    const { txHash: _txHash, ...paperFill } = execution(1, {
      isPaper: true,
      gas: { asset: coin, base: 0n },
      gasUsdMicros: 0n,
    });
    expect(executionsCsv([paperFill], assets)).toBe(
      `${header}2026-10-07 09:30:00,1.0025,BNB,1000,TKN,,,601.5,USD,,${fixtureId("int", 1)},\r\n`,
    );
  });

  it("quotes a symbol with a comma or quote, and keeps a spreadsheet from running it", () => {
    const tricky: AssetInfos = {
      ...assets,
      [token]: info('=HYPERLINK("x"),1', 18),
      [coin]: info("-BNB", 18),
    };
    const [, row] = executionsCsv([execution(1, {})], tricky).split("\r\n");
    expect(row).toBe(
      `2026-10-07 09:30:00,1.0025,'-BNB,1000,"'=HYPERLINK(""x""),1",0.0005,'-BNB,601.5,USD,,` +
        `${fixtureId("int", 1)},${txHash}`,
    );
  });

  it("refuses to mix paper and live executions in one file", () => {
    expect(() =>
      executionsCsv([execution(1, {}), execution(2, { isPaper: true })], assets),
    ).toThrow(expect.objectContaining({ code: "ledger.mixed_modes" }));
  });

  it("refuses an asset it has no decimals for", () => {
    expect(() => executionsCsv([execution(1, {})], { [coin]: info("BNB", 18) })).toThrow(
      expect.objectContaining({ code: "ledger.unknown_asset", details: { asset: token } }),
    );
  });
});
