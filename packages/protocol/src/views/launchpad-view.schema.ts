import {
  type LaunchOptionType,
  type LaunchOptionValue,
  launchOptionTypes,
} from "@binference/chain";
import { z } from "zod";
import { type LaunchpadId, launchpadIdSchema } from "./launch-filter.schema.js";

/**
 * Where a launchpad takes a launch's picture: `upload`, through its own API, from an upload id of
 * the owner's (decision 0234); `create_call`, a small picture of the owner's written into its
 * create call (decision 0279); `link`, a picture link the owner hosts, given as the launchpad's
 * `link` setting, with `image: "none"` (decision 0276).
 */
type PicturePlace = "upload" | "create_call" | "link";

/**
 * What a launchpad takes as a launch's picture. `mostBytes` is the largest picture it takes: 5 MiB
 * for an upload, and for a picture written into the create call the most that fits beside a launch
 * with no description or links, since longer words leave fewer. `mostSide` is the most pixels a
 * written picture is wide or tall. A `link` launchpad takes no picture bytes.
 */
interface LaunchpadPicture {
  readonly place: PicturePlace;
  readonly mostBytes?: number;
  readonly mostSide?: number;
}

/**
 * One setting a launchpad declares for its launches, as `venueOptions` takes it by `name`: its
 * type, its bounds or words, and its default. `optional` may be left out, and the launchpad may
 * work out its value; `workedOut` only the launchpad sets, so a request never gives it;
 * `outsideOnly` is an account none of the install's own wallets may be.
 */
export interface LaunchSettingView {
  readonly name: string;
  readonly type: LaunchOptionType;
  readonly choices?: readonly string[];
  readonly min?: number;
  readonly max?: number;
  readonly default?: LaunchOptionValue;
  readonly optional?: true;
  readonly workedOut?: true;
  readonly outsideOnly?: true;
}

/**
 * A launchpad the engine runs on a chain (protocol spec, section 7.3): where it takes the picture
 * and each setting it declares, so a surface asks the owner only for what the engine takes.
 */
export interface LaunchpadView {
  readonly venue: LaunchpadId;
  readonly picture: LaunchpadPicture;
  readonly settings: readonly LaunchSettingView[];
}

const picturePlaceSchema: z.ZodType<PicturePlace> = z.enum(["upload", "create_call", "link"]);

const settingName = z.string().regex(/^[a-z][a-zA-Z0-9]{0,31}$/);

/** Parses one launchpad that the engine runs on a chain. */
export const launchpadViewSchema: z.ZodType<LaunchpadView> = z.object({
  venue: launchpadIdSchema,
  picture: z.object({
    place: picturePlaceSchema,
    mostBytes: z.int().nonnegative().exactOptional(),
    mostSide: z.int().positive().exactOptional(),
  }),
  settings: z
    .array(
      z.object({
        name: settingName,
        type: z.enum(launchOptionTypes),
        choices: z.array(settingName).max(64).exactOptional(),
        min: z.int().nonnegative().exactOptional(),
        max: z.int().nonnegative().exactOptional(),
        default: z.union([z.number(), z.boolean(), z.string().max(512)]).exactOptional(),
        optional: z.literal(true).exactOptional(),
        workedOut: z.literal(true).exactOptional(),
        outsideOnly: z.literal(true).exactOptional(),
      }),
    )
    .max(64),
});
