import { fitsWordLimits, type Launcher, type LaunchWords } from "@binference/chain";
import { z } from "zod";
import type { HostedVenue } from "./hosted-venue.js";
import type { LaunchHost } from "./launch-host.js";

/** Where a launchpad takes a launch's picture. */
export type PicturePlace = "upload" | "create_call" | "link";

/** A launchpad the host holds that launches tokens, with its declared contracts. */
export interface HostedLauncher {
  readonly hosted: HostedVenue;
  readonly launcher: Launcher;
}

/** Where a launcher takes its picture: through its pin, into its create call, or as a link. */
export function placeOf(launcher: Launcher): PicturePlace {
  if (launcher.pin !== undefined) {
    return "upload";
  }
  return launcher.pictureBytesFor === undefined ? "link" : "create_call";
}

const pictureBytesSchema = z.int().positive();

// Launchpad code may throw or answer outside its type: no picture fits then.
function pictureBytesOn(
  launchers: ReadonlyMap<string, HostedLauncher>,
  venue: string,
  words: LaunchWords,
): number | undefined {
  const launcher = launchers.get(venue)?.launcher;
  if (launcher?.pictureBytesFor === undefined) {
    return undefined;
  }
  try {
    const bytes = pictureBytesSchema.safeParse(
      launcher.pictureBytesFor(Object.freeze({ ...words })),
    );
    return bytes.success ? bytes.data : 0;
  } catch {
    return 0;
  }
}

/** What the host reads of each launchpad's declaration, with no call to its code but a guarded one. */
export type DeclarationReads = Pick<
  LaunchHost,
  | "fitsWords"
  | "launchOptions"
  | "outsideOnlySettings"
  | "picturePlace"
  | "pictureBytesFor"
  | "launchWalletCalls"
>;

/** The host's reads of each launchpad's declaration, over the launchpads it holds. */
export function declarationsOf(launchers: ReadonlyMap<string, HostedLauncher>): DeclarationReads {
  const launcherOf = (venue: string) => launchers.get(venue)?.launcher;
  return {
    fitsWords(venue, launch) {
      const launcher = launcherOf(venue);
      const limits = launcher?.wordLimits;
      return launcher !== undefined && (limits === undefined || fitsWordLimits(limits, launch));
    },
    launchOptions: (venue) => launcherOf(venue)?.launchOptions ?? [],
    outsideOnlySettings: (venue) =>
      (launcherOf(venue)?.launchOptions ?? [])
        .filter((option) => option.isOutsideOnly === true)
        .map((option) => option.name),
    picturePlace(venue) {
      const launcher = launcherOf(venue);
      return launcher === undefined ? undefined : placeOf(launcher);
    },
    pictureBytesFor: (venue, words) => pictureBytesOn(launchers, venue, words),
    launchWalletCalls: (venue) => launchers.get(venue)?.hosted.launchWalletCalls ?? [],
  };
}
