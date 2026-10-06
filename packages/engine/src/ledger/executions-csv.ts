import type { Amount } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import { decimalText } from "@binference/i18n";
import type { AssetInfos } from "@binference/protocol";
import type { ExecutionRecord } from "../positions/execution-record.js";

/**
 * The columns of the CSV export, in order: Koinly's universal import layout, which other tax tools
 * also read. It is a machine format: tax tools match the header by these exact English names, so
 * the header is the same in every language, as API error codes are.
 */
export const executionsCsvColumns: readonly string[] = [
  "Date",
  "Sent Amount",
  "Sent Currency",
  "Received Amount",
  "Received Currency",
  "Fee Amount",
  "Fee Currency",
  "Net Worth Amount",
  "Net Worth Currency",
  "Label",
  "Description",
  "TxHash",
];

const usdDecimals = 6;
const quoted = /[",\r\n]/;
// A spreadsheet runs a cell that starts with one of these as a formula; a token symbol is set by
// whoever deployed the token, so it never reaches a cell able to run.
const formulaStart = /^[=+\-@\t\r]/;

function field(text: string): string {
  const inert = formulaStart.test(text) ? `'${text}` : text;
  return quoted.test(inert) ? `"${inert.replaceAll('"', '""')}"` : inert;
}

// ISO 8601 date and time in UTC with a space before the time, the form the layout reads.
function utcTime(atMs: number): string {
  const iso = new Date(atMs).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

function amountCells(amount: Amount, assets: AssetInfos): readonly [string, string] {
  const info = assets[amount.asset];
  if (info === undefined) {
    throw new BinferenceError({
      code: "ledger.unknown_asset",
      message: "The CSV export needs the decimals and symbol of every asset it writes.",
      details: { asset: amount.asset },
    });
  }
  return [decimalText(amount.base, info.decimals), info.symbol];
}

function row(execution: ExecutionRecord, assets: AssetInfos): readonly string[] {
  const { sold, bought, gas } = execution;
  const gasCells = gas.base === 0n ? ["", ""] : amountCells(gas, assets);
  return [
    utcTime(execution.atMs),
    // What left the wallet in the sold token, the fee with it; the gas is the row's fee.
    ...amountCells({ asset: sold.asset, base: sold.base + execution.feeBase }, assets),
    ...amountCells(bought, assets),
    ...gasCells,
    decimalText(execution.valueUsdMicros + execution.feeUsdMicros, usdDecimals),
    "USD",
    "",
    execution.intentId,
    execution.txHash ?? "",
  ];
}

/**
 * Writes executions as a CSV file for tax tools (decision 0058), in the layout of
 * {@link executionsCsvColumns}: a header row, then one row per execution in the order given, with
 * CRLF line ends (RFC 4180).
 *
 * - Amounts are exact decimals of whole tokens from base units, never floats: what left the wallet
 *   in the sold token (the fee with it), what arrived, and the gas in the native coin as the fee.
 * - The net worth is what left in the sold token, in US dollars at the time.
 * - Times are UTC as `2026-10-07 09:30:00`; the description holds the intent id.
 *
 * Paper and live executions never share a file: a mix throws `ledger.mixed_modes`. An asset
 * missing from `assets` throws `ledger.unknown_asset`.
 */
export function executionsCsv(executions: readonly ExecutionRecord[], assets: AssetInfos): string {
  if (new Set(executions.map((execution) => execution.isPaper)).size > 1) {
    throw new BinferenceError({
      code: "ledger.mixed_modes",
      message: "A CSV export holds paper or live executions, never both.",
    });
  }
  const lines = [executionsCsvColumns, ...executions.map((execution) => row(execution, assets))];
  return lines.map((cells) => `${cells.map(field).join(",")}\r\n`).join("");
}
