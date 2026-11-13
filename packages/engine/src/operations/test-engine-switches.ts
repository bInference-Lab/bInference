import { noBreaker } from "../breaker/no-breaker.js";
import type { EngineOptions } from "./create-engine.js";
import type { TestEngineOptions } from "./test-engine.js";

// The config file a confirmed change writes, the agent's shell, the runtime's side of a chat
// deletion, the install's quotas and the breaker, as a test engine's options ask.
function machineSwitchesOf(
  options: TestEngineOptions,
): Partial<EngineOptions> & Pick<EngineOptions, "breaker"> {
  return {
    breaker: options.breaker ?? noBreaker,
    ...(options.configChanges === undefined ? {} : { configChanges: options.configChanges }),
    ...(options.shell === undefined ? {} : { shell: options.shell }),
    ...(options.runtimeChats === undefined ? {} : { runtimeChats: options.runtimeChats }),
    ...(options.quotas === undefined ? {} : { quotas: options.quotas }),
  };
}

/**
 * Whether live orders fill, a launch feed runs and a community plugin is on, the uploads, the
 * bot's photos, quote assets, the agent's shell and the breaker, as a test engine's options ask.
 */
export function switchesOf(
  options: TestEngineOptions,
): Partial<EngineOptions> & Pick<EngineOptions, "breaker"> {
  return {
    liveOrderFills: options.liveOrderFills === true,
    ...options.bridging,
    ...(options.stakingVenues === undefined ? {} : { stakingVenues: options.stakingVenues }),
    ...(options.identity === undefined ? {} : { identity: options.identity }),
    ...(options.destinations === undefined ? {} : { destinations: options.destinations }),
    ...(options.quoteAssets === undefined ? {} : { quoteAssets: options.quoteAssets }),
    ...(options.launchFeed === true ? { launchFeed: true } : {}),
    ...(options.uploads === undefined ? {} : { uploads: options.uploads }),
    ...(options.botImages === undefined ? {} : { botImages: options.botImages }),
    ...machineSwitchesOf(options),
    ...(options.communityPluginsOn === undefined
      ? {}
      : { communityPluginsOn: options.communityPluginsOn }),
    ...(options.listedMcpOn === undefined ? {} : { listedMcpOn: options.listedMcpOn }),
  };
}
