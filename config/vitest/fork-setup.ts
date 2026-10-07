import { performance } from "node:perf_hooks";
import type { TestProject } from "vitest/node";
import { z } from "zod";
import { type AnvilFork, readAnvilVersion, startAnvilFork } from "./anvil-fork.js";
import { retryFlakes } from "./retry-flakes.js";

// BNB Chain's own node: publicnode balances load across servers that lag, and forks flaked on it.
const forkUpstream = "https://bsc-dataseed1.bnbchain.org";
// Public nodes keep about 120 blocks of state and flake at the head, so the fork sits 20 behind.
const blocksBehindHead = 20n;
const startWaitsMs = [5_000, 15_000, 30_000];
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

async function startFork(): Promise<AnvilFork> {
  return retryFlakes({ label: "Starting the BSC fork", waitsMs: startWaitsMs }, async () =>
    startAnvilFork({
      upstream: forkUpstream,
      block: (await readHead(forkUpstream)) - blocksBehindHead,
    }),
  );
}

/**
 * The fork suite's global setup. It pins a block 20 behind the head of BSC, starts anvil forked
 * there and gives it to the tests as `inject("fork")`. The teardown it returns stops anvil.
 */
export async function setup(project: TestProject): Promise<() => Promise<void>> {
  const startedMs = performance.now();
  const version = await readAnvilVersion();
  const fork = await startFork();
  project.provide("fork", { rpcUrl: fork.url, block: fork.block.toString() });
  const readyMs = Math.round(performance.now() - startedMs);
  project.vitest.logger.log(
    `Fork suite: anvil ${version} forked BSC at block ${fork.block.toString()} from ${new URL(forkUpstream).host}, ready in ${String(readyMs)} ms.`,
  );
  return async () => fork.stop();
}
