import type { EngineOptions } from "./create-engine.js";
import type { TestEngineOptions } from "./test-engine.js";

/**
 * Whether live orders fill, a launch feed runs and a community plugin is on, the uploads, the
 * bot's photos and quote assets, as a test engine's options ask.
 */
export function switchesOf(options: TestEngineOptions): Partial<EngineOptions> {
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
    ...(options.communityPluginsOn === undefined
      ? {}
      : { communityPluginsOn: options.communityPluginsOn }),
  };
}
