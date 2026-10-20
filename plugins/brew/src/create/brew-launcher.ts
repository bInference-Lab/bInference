import type { Launcher } from "@binference/plugin-sdk";
import { buildLaunch } from "./build-launch.js";
import { decodeLaunch } from "./decode-launch.js";
import { pictureBytesFor } from "./launch-metadata.js";
import type { LaunchParts } from "./launch-parts.js";
import { brewLaunchOptions, brewOptionsGoTogether, brewWordLimits } from "./launch-settings.js";
import { quoteLaunch } from "./quote-launch.js";

/**
 * Brew's launcher (decision 0283): a token through BrewFactory's `launch`, with its first buy in
 * the same call at the host's minimum. Brew has no picture API: the create call's metadata address
 * carries the card's words and the owner's small picture (decision 0279), so it uploads nothing
 * and has no pin. Every card says that Brew's site is not available to U.S. citizens (decision
 * 0281).
 */
export function createBrewLauncher(parts: LaunchParts): Launcher {
  return {
    launchOptions: brewLaunchOptions,
    wordLimits: brewWordLimits,
    pictureBytesFor,
    checkOptions: brewOptionsGoTogether,
    cardWarnings: ["notForUsCitizens"],
    quoteLaunch: async (terms, { signal }) => quoteLaunch(terms, parts, signal),
    buildLaunch: async (request, { signal }) => buildLaunch(request, parts, signal),
    decodeLaunch: (draft) => decodeLaunch(draft, parts),
  };
}
