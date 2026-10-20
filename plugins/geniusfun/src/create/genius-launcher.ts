import type { Launcher } from "@binference/plugin-sdk";
import { buildLaunch } from "./build-launch.js";
import { decodeLaunch } from "./decode-launch.js";
import type { LaunchParts } from "./launch-parts.js";
import { geniusfunLaunchOptions, geniusfunWordLimits } from "./launch-settings.js";
import { quoteLaunch } from "./quote-launch.js";

/**
 * Genius.fun's launcher (decision 0277): tokens on the m4.2 stack, with their first buy through the
 * launch-and-buy router and its minimum, or alone through the factory. Genius.fun has no API for a
 * launch's metadata: the create call carries the words and the owner's picture link (decision
 * 0276), so the launcher uploads nothing and has no pin, and declares the bytes the launch deployer
 * takes for each word (decision 0275). It quotes and names the token by dry runs of the create
 * call.
 */
export function createGeniusfunLauncher(parts: LaunchParts): Launcher {
  return {
    launchOptions: geniusfunLaunchOptions,
    wordLimits: geniusfunWordLimits,
    quoteLaunch: async (terms, { signal }) => quoteLaunch(terms, parts, signal),
    buildLaunch: async (request, { signal }) => buildLaunch(request, parts, signal),
    decodeLaunch: (draft) => decodeLaunch(draft, parts),
  };
}
