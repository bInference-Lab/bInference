import type { ChainRegistry, LaunchOption } from "@binference/chain";
import { err, ok } from "@binference/core";
import type { LaunchpadView, LaunchSettingView } from "@binference/protocol";
import { launchImageMaxBytes, writtenPictureMostSide } from "../money-path/launch-image.js";
import type { EngineHandler } from "../operations/engine-call.js";
import type { LaunchHost } from "../venues/launch-host.js";

/** The handler of `launchpad/list` (protocol spec, section 7.3). */
export interface LaunchpadHandlers {
  readonly "launchpad/list": EngineHandler<"launchpad/list">;
}

/** What `launchpad/list` reads: the launch side of the venue host, and the chain registry. */
export interface LaunchpadReadOptions {
  /** The launch side of the venue host; an engine without it runs no launchpad. */
  readonly launchHost?: LaunchHost;
  readonly chains: ChainRegistry;
}

function settingOf(option: LaunchOption): LaunchSettingView {
  const { name, type, choices, min, max } = option;
  return {
    name,
    type,
    ...(choices === undefined ? {} : { choices }),
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
    ...(option.default === undefined ? {} : { default: option.default }),
    ...(option.isOptional === true ? { optional: true } : {}),
    ...(option.isWorkedOut === true ? { workedOut: true } : {}),
    ...(option.isOutsideOnly === true ? { outsideOnly: true } : {}),
  };
}

// A written picture's room is what fits beside a launch with no description or links.
function pictureOf(host: LaunchHost, venue: string): LaunchpadView["picture"] | undefined {
  const place = host.picturePlace(venue);
  if (place === "upload") {
    return { place, mostBytes: launchImageMaxBytes };
  }
  if (place === "create_call") {
    const mostBytes = host.pictureBytesFor(venue, {}) ?? 0;
    return { place, mostBytes, mostSide: writtenPictureMostSide };
  }
  return place === undefined ? undefined : { place };
}

function viewOf(host: LaunchHost, venue: string): readonly LaunchpadView[] {
  const picture = pictureOf(host, venue);
  const settings = host.launchOptions(venue).map(settingOf);
  return picture === undefined ? [] : [{ venue, picture, settings }];
}

/**
 * Creates the `launchpad/list` handler. It answers every launchpad the engine runs on the chain:
 * where each takes a launch's picture and each setting it declares, so a surface asks the owner
 * for an upload, a small picture or a picture link only where the engine takes one. A chain the
 * registry does not hold is `protocol.bad_args`; an engine with no launch host runs none.
 */
export function createLaunchpadHandlers(options: LaunchpadReadOptions): LaunchpadHandlers {
  return {
    "launchpad/list": async ({ args, signal }) => {
      signal.throwIfAborted();
      const chain = options.chains.get(args.chain);
      if (!chain.ok) {
        return err("protocol.bad_args");
      }
      const host = options.launchHost;
      const venues = host?.launchpadsOn(chain.value.ref) ?? [];
      return ok({
        items: host === undefined ? [] : venues.flatMap((venue) => viewOf(host, venue)),
      });
    },
  };
}
