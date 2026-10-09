import { performance } from "node:perf_hooks";
import type { TestProject } from "vitest/node";
import { type AnvilFork, readAnvilVersion, startAnvilFork } from "./anvil-fork.js";
import { serveLogsNode } from "./logs-node.js";
import { forkUpstream, logsUpstream, pinBlock } from "./pin-block.js";
import { retryFlakes } from "./retry-flakes.js";

const startWaitsMs = [5_000, 15_000, 30_000];

async function startFork(): Promise<AnvilFork> {
  return retryFlakes({ label: "Starting the BSC fork", waitsMs: startWaitsMs }, async () =>
    startAnvilFork({ upstream: forkUpstream, block: await pinBlock() }),
  );
}

/**
 * The fork suite's global setup. It starts anvil forked from BNB Chain's node at a recent block
 * and a loopback logs node, and gives both to the tests as `inject("fork")`; each test file's
 * setup (./fork-file-setup.ts) re-pins the fork before its tests. The teardown it returns stops
 * them.
 */
export async function setup(project: TestProject): Promise<() => Promise<void>> {
  const startedMs = performance.now();
  const version = await readAnvilVersion();
  const logsNode = await serveLogsNode(logsUpstream);
  let fork: AnvilFork;
  try {
    fork = await startFork();
  } catch (error) {
    await logsNode.close();
    throw error;
  }
  project.provide("fork", {
    rpcUrl: fork.url,
    upstream: forkUpstream,
    logsRpcUrl: logsNode.url,
  });
  const readyMs = Math.round(performance.now() - startedMs);
  project.vitest.logger.log(
    `Fork suite: anvil ${version} forked BSC at block ${fork.block.toString()} from ${new URL(forkUpstream).host}, ready in ${String(readyMs)} ms.`,
  );
  return async () => {
    await Promise.all([fork.stop(), logsNode.close()]);
  };
}
