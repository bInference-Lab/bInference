import { beforeAll, inject } from "vitest";
import { z } from "zod";
import { pinBlock } from "./pin-block.js";
import { retryFlakes } from "./retry-flakes.js";

const repinWaitsMs = [5_000, 15_000, 30_000];
const resetTimeoutMs = 60_000;

const resetSchema = z.looseObject({ result: z.null() });

async function repin(rpcUrl: string, upstream: string): Promise<void> {
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
}

// Each test file starts on a fork pinned moments ago: the public node drops the state of older
// blocks within about a minute, and a run's later files would otherwise read past it.
beforeAll(async () => {
  const { rpcUrl, upstream } = inject("fork");
  await retryFlakes({ label: "Pinning the BSC fork for this file", waitsMs: repinWaitsMs }, () =>
    repin(rpcUrl, upstream),
  );
});
