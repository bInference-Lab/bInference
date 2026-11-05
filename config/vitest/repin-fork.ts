import { inject } from "vitest";
import { z } from "zod";
import { pinBlock } from "./pin-block.js";
import { retryFlakes } from "./retry-flakes.js";

const repinWaitsMs = [5_000, 15_000, 30_000];
const resetTimeoutMs = 60_000;

const resetSchema = z.looseObject({ result: z.null() });

async function repin(rpcUrl: string, upstream: string): Promise<number> {
  const blockNumber = Number(await pinBlock());
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "anvil_reset",
      params: [{ forking: { jsonRpcUrl: upstream, blockNumber } }],
    }),
    signal: AbortSignal.timeout(resetTimeoutMs),
  });
  const answer: unknown = await response.json();
  if (!resetSchema.safeParse(answer).success) {
    throw new Error(`anvil did not re-pin the fork: ${JSON.stringify(answer)}`);
  }
  return blockNumber;
}

// EIP-2935's history contract (chain-evm's `holdBlockHistory` says why): before each mined block,
// anvil reads the slot `(number - 1) % 8191` from upstream, and once the public node has dropped
// the pinned block's state, an unread slot makes anvil panic on `missing trie node`.
const historyContract = "0x0000F90827F1C53a10cb7a02335B175320002935";
const historyWindow = 8_191;
const heldBlocks = 512;
const emptyWord = `0x${"0".repeat(64)}`;

function slotOf(index: number): string {
  return `0x${(index % historyWindow).toString(16).padStart(64, "0")}`;
}

async function holdHistory(rpcUrl: string, blockNumber: number): Promise<void> {
  const calls = Array.from({ length: heldBlocks }, (_, index) => ({
    jsonrpc: "2.0",
    id: index,
    method: "anvil_setStorageAt",
    params: [historyContract, slotOf(blockNumber + index), emptyWord],
  }));
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(calls),
    signal: AbortSignal.timeout(resetTimeoutMs),
  });
  const answers: unknown = await response.json();
  if (!z.array(z.looseObject({ result: z.literal(true) })).safeParse(answers).success) {
    throw new Error(`anvil did not hold the block history: ${JSON.stringify(answers)}`);
  }
}

/**
 * Pins the suite's fork again at a block moments old, and sets the history slots its next 512
 * mined blocks write: the public node drops the state of older blocks within about a minute, and
 * a later read of a slot the fork never read would fail, or make anvil panic as it mines.
 */
export async function repinFork(label: string): Promise<void> {
  const { rpcUrl, upstream } = inject("fork");
  await retryFlakes({ label, waitsMs: repinWaitsMs }, async () => {
    const blockNumber = await repin(rpcUrl, upstream);
    await holdHistory(rpcUrl, blockNumber);
  });
}
