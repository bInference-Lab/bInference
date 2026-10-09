import { z } from "zod";

/** BNB Chain's own node: publicnode balances load across servers that lag, and forks flaked on it. */
export const forkUpstream = "https://bsc-dataseed1.bnbchain.org";
/** BNB Chain's nodes refuse eth_getLogs; 48 Club's public node serves it. */
export const logsUpstream = "https://rpc-bsc.48.club";

// Public nodes keep about 128 blocks of state, under a minute of BSC, and flake at the head, so
// the fork sits 20 behind it and is pinned again for each test file.
const blocksBehindHead = 20n;
const headTimeoutMs = 10_000;

const headSchema = z.looseObject({ result: z.string().regex(/^0x[0-9a-fA-F]{1,16}$/) });

async function readHead(url: string): Promise<bigint> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
    signal: AbortSignal.timeout(headTimeoutMs),
  });
  if (!response.ok) {
    throw new Error(`${new URL(url).host} answered HTTP ${String(response.status)}.`);
  }
  return BigInt(headSchema.parse(await response.json()).result);
}

/**
 * A block 20 behind the lower of the two nodes' heads. Both must hold it: anvil reads state at
 * it, and scans read history up to it.
 */
export async function pinBlock(): Promise<bigint> {
  const [forkHead, logsHead] = await Promise.all([readHead(forkUpstream), readHead(logsUpstream)]);
  return (forkHead < logsHead ? forkHead : logsHead) - blocksBehindHead;
}
