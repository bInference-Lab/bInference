import type { TestProject } from "vitest/node";
import { readAnvilVersion, startAnvilChain } from "./anvil-fork.js";
import { runsPerPoint } from "./runs-per-point.js";

// BSC's chain id: the engine signs for BSC, and anvil takes only what is signed for its own id.
const bscChainId = 56;

/**
 * The crash suite's global setup. It starts anvil on a chain of its own with BSC's chain id and
 * no fork, so no run reaches the network, and gives the tests its endpoint and the runs each kill
 * point gets as `inject("crash")`. The teardown it returns stops anvil.
 */
export async function setup(project: TestProject): Promise<() => Promise<void>> {
  const runs = runsPerPoint(process.env["BINFERENCE_CRASH_RUNS"]);
  const version = await readAnvilVersion();
  const chain = await startAnvilChain(bscChainId);
  project.provide("crash", { rpcUrl: chain.url, runs });
  project.vitest.logger.log(
    `Crash suite: anvil ${version} on chain ${String(bscChainId)}, runs per kill point: ${String(runs)}.`,
  );
  return async () => chain.stop();
}
