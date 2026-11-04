import type { BridgeRoute } from "../bridges/hosted-bridge.js";
import {
  type BridgeFakes,
  bridgeEngineOptions,
  bridgeFakes,
  readyBridges,
} from "../bridges/test-bridges.js";
import { testToken } from "../intents/test-intents.js";
import type { ExecutorLimits } from "./executor-options.js";
import { type ExecutorBench, startExecutorBench } from "./test-executor.js";

/** An executor bench that bridges through the fake bridge, with the fakes a test drives. */
export interface BridgeBench extends ExecutorBench {
  readonly fakes: BridgeFakes;
}

/**
 * A bench whose engine and executor bridge through the fake bridge on its routes, the fake
 * bridge's one route by default, ready to bridge: the rescue address set, the destination entry
 * saved, and the wallet's ceiling paying both there.
 */
export async function bridgeBench(
  options: {
    readonly routes?: readonly BridgeRoute[];
    readonly limits?: Partial<ExecutorLimits>;
    /** Draft payloads whose transactions revert once a block holds them. */
    readonly reverting?: readonly string[];
    /** Leaves the executor no reader of code on the wallet's own chain, or on the destination. */
    readonly withoutCodes?: "home" | "there";
  } = {},
): Promise<BridgeBench> {
  const fakes = bridgeFakes(options.routes === undefined ? {} : { routes: options.routes });
  const engine = bridgeEngineOptions(fakes);
  const { agent, ...rest } = engine;
  const bench = await startExecutorBench({
    hold: true,
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    ...(options.reverting === undefined ? {} : { network: { reverting: options.reverting } }),
    agent: agent ?? {},
    engine: rest,
    prices: new Map([[testToken, { numerator: 1_000_000n, denominator: 1_000_000n }]]),
    routing: {
      chains: fakes.chains,
      bridging: {
        bridges: [fakes.bridge],
        destinations:
          options.withoutCodes === "there"
            ? (engine.destinations ?? []).map(({ codes: _codes, ...destination }) => destination)
            : (engine.destinations ?? []),
        codeReaders: options.withoutCodes === "home" ? [] : [fakes.codesHere],
      },
    },
  });
  await readyBridges(bench.test);
  return { ...bench, fakes };
}
