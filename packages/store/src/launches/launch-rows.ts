// The rows of the launch feed, read into their records.
import { type NewLaunch, type StoredLaunch, storedLaunchSchema } from "@binference/engine/market";
import type { Insertable, Selectable } from "kysely";
import type { LaunchTables } from "../databases/launch-tables.js";
import { decimalText, field, jsonText, orNull, readJson } from "../rows/column-values.js";

type LaunchesTable = LaunchTables["launches"];

/** Reads one `launches` row, with its creator's launches in the 30 days before, into its record. */
export function toStoredLaunch(
  row: Selectable<LaunchesTable> & { readonly creator_launches: number },
): StoredLaunch {
  return storedLaunchSchema.parse({
    chain: row.chain,
    token: row.token,
    launchpad: row.launchpad,
    creator: row.creator,
    quoteToken: row.quote_token,
    ...field("symbol", row.symbol),
    ...field("name", row.name),
    ...field("decimals", row.decimals),
    ...field("taxBps", row.tax_bps),
    ...field("snipeTaxBps", row.snipe_tax_bps),
    ...field("curveProgressBps", row.curve_progress_bps),
    graduated: row.graduated === 1,
    insiders: readJson(row.insiders),
    block: row.block,
    blockHash: row.block_hash,
    txHash: row.tx_hash,
    logIndex: row.log_index,
    launchedAtMs: row.launched_at,
    changedAtMs: row.changed_at,
    creatorLaunches30d: row.creator_launches,
  });
}

/** The `launches` row of a launch the feed read on a chain, written at `atMs`. */
export function launchRowOf(
  chain: string,
  launch: NewLaunch,
  atMs: number,
): Insertable<LaunchesTable> {
  return {
    chain,
    token: launch.token,
    launchpad: launch.launchpad,
    creator: launch.creator,
    quote_token: launch.quoteToken,
    symbol: orNull(launch.symbol),
    name: orNull(launch.name),
    decimals: orNull(launch.decimals),
    tax_bps: orNull(launch.taxBps),
    snipe_tax_bps: orNull(launch.snipeTaxBps),
    curve_progress_bps: orNull(launch.curveProgressBps),
    graduated: launch.graduated ? 1 : 0,
    insiders: jsonText([...launch.insiders]),
    block: decimalText(launch.block),
    block_hash: launch.blockHash,
    tx_hash: launch.txHash,
    log_index: launch.logIndex,
    launched_at: launch.launchedAtMs,
    changed_at: atMs,
  };
}
