import type { UploadingLauncher } from "@binference/plugin-sdk";
import { buildLaunch } from "./build-launch.js";
import { decodeLaunch } from "./decode-launch.js";
import type { LaunchParts } from "./launch-parts.js";
import { flapLaunchOptions } from "./launch-settings.js";
import { pinLaunch, pinStatusOf } from "./pin-launch.js";
import { quoteLaunch } from "./quote-launch.js";

/**
 * Flap's launcher (decision 0271): tax tokens through the Portal's `newTokenV6`, with their first
 * buy in the create call, which takes no minimum for it (decision 0270). It quotes by a dry run of
 * the create call, uploads the words and picture through Flap's own API, reads the pin from Flap's
 * pin status API, and never reads an IPFS gateway.
 */
export function createFlapLauncher(parts: LaunchParts): UploadingLauncher {
  return {
    launchOptions: flapLaunchOptions,
    noFirstBuyMin: true,
    quoteLaunch: async (terms, { signal }) => quoteLaunch(terms, parts, signal),
    pin: async (request, { signal }) => pinLaunch(request, parts, signal),
    pinStatus: async (pin, { signal }) => pinStatusOf(pin, parts, signal),
    buildLaunch: async (request, { signal }) => buildLaunch(request, parts, signal),
    decodeLaunch: (draft) => decodeLaunch(draft, parts),
  };
}
