import type { AbiEvent, Address, GetLogsReturnType, PublicClient } from "viem";

/** One contract's logs of one event, over a block range. */
export interface LogScan<E extends AbiEvent> {
  readonly address: Address;
  readonly event: E;
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
}

/** The two nodes a scan reads, split at the block the fork was taken at. */
export interface LogSources {
  /** A public node that serves `eth_getLogs`: the chain's history, up to the fork block. */
  readonly history: PublicClient;
  /** anvil: the blocks mined on the fork after the fork block. */
  readonly fork: PublicClient;
  readonly forkBlock: bigint;
}

/** Logs whose fields all decoded against the event. */
export type ScannedLogs<E extends AbiEvent> = GetLogsReturnType<E, [E], true, bigint, bigint>;

// 48 Club's public node answers 200 blocks of one contract in about two seconds; calls over
// about 1,000 blocks often time out.
const blocksPerCall = 200n;

async function readInCalls<E extends AbiEvent>(
  client: PublicClient,
  scan: LogScan<E>,
): Promise<ScannedLogs<E>> {
  const { address, event, fromBlock, toBlock } = scan;
  if (fromBlock > toBlock) {
    return [];
  }
  const lastBlock = fromBlock + blocksPerCall - 1n;
  const callEnd = lastBlock < toBlock ? lastBlock : toBlock;
  // One call at a time: public nodes answer bursts with 403 and then refuse for a while.
  const logs = await client.getLogs<E, [E], true, bigint, bigint>({
    address,
    event,
    fromBlock,
    toBlock: callEnd,
    strict: true,
  });
  return [...logs, ...(await readInCalls(client, { ...scan, fromBlock: callEnd + 1n }))];
}

/**
 * Reads one contract's logs of one event, oldest first. Blocks up to the fork block come from a
 * public node that serves `eth_getLogs`, 200 blocks a call; later blocks come from anvil, which
 * mined them. anvil would send a history query on to its own upstream, and BNB Chain's nodes
 * refuse `eth_getLogs`.
 */
export async function scanLogs<E extends AbiEvent>(
  sources: LogSources,
  scan: LogScan<E>,
): Promise<ScannedLogs<E>> {
  const { forkBlock } = sources;
  const historyEnd = scan.toBlock < forkBlock ? scan.toBlock : forkBlock;
  const minedStart = scan.fromBlock > forkBlock ? scan.fromBlock : forkBlock + 1n;
  const history = await readInCalls(sources.history, { ...scan, toBlock: historyEnd });
  const mined = await readInCalls(sources.fork, { ...scan, fromBlock: minedStart });
  return [...history, ...mined];
}
