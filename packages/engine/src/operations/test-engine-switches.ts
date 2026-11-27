import { noBreaker } from "../breaker/no-breaker.js";
import type { EngineOptions } from "./create-engine.js";
import type { TestEngineOptions } from "./test-engine.js";

// The config file a confirmed change writes, the agent's shell, the runtime's side of a chat
// deletion, the install's quotas, the breaker and the log, as a test engine's options ask, and the
// owner's language, the test agent's own.
function machineSwitchesOf(
  options: TestEngineOptions,
): Partial<EngineOptions> & Pick<EngineOptions, "breaker" | "ownerLocale"> {
  return {
    breaker: options.breaker ?? noBreaker,
    ownerLocale: () => options.agent?.locale ?? "en",
    ...(options.configChanges === undefined ? {} : { configChanges: options.configChanges }),
    ...(options.shell === undefined ? {} : { shell: options.shell }),
    ...(options.runtimeChats === undefined ? {} : { runtimeChats: options.runtimeChats }),
    ...(options.quotas === undefined ? {} : { quotas: options.quotas }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  };
}

/**
 * Whether live orders fill, a launch feed runs and a community plugin is on, the uploads, the
 * bot's photos, quote assets, the agent's shell, the breaker and the owner's language, as a test
 * engine's options ask.
 */
export function switchesOf(
  options: TestEngineOptions,
): Partial<EngineOptions> & Pick<EngineOptions, "breaker" | "ownerLocale"> {
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
