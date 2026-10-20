import {
  accountRefParts,
  accountRefSchema,
  type Amount,
  type AssetRef,
  type LaunchOptionValue,
} from "@binference/chain";
import { bpsSchema } from "@binference/core";
import { type LaunchSetting, launchSettingKey } from "../venues/launch-settings.schema.js";
import type { CardLine, CardValue } from "./card-line.js";

/** The picture a launch uploaded, as its card shows it: its format, its size and its digest. */
interface LaunchPicture {
  readonly format: "png" | "jpeg" | "webp";
  /** Its size in KiB, rounded up. */
  readonly kib: number;
  /** The first 16 hex digits of its SHA-256; the terms hash binds the whole digest. */
  readonly digest: string;
  /** The metadata address its create call names. */
  readonly uri: string;
}

/**
 * The picture a launchpad writes into the create call (decision 0279), as its card shows it: its
 * format, its size in bytes and pixels, and its digest.
 */
interface WrittenLaunchPicture {
  readonly format: "png" | "jpeg" | "webp";
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  /** The first 16 hex digits of its SHA-256; the terms hash binds the whole digest. */
  readonly digest: string;
}

/** One web link a launched token shows. */
export interface LaunchLink {
  readonly site: "website" | "x" | "telegram";
  readonly url: string;
}

/**
 * Every setting of a token launch beyond its action line (decision 0235), each from the request
 * or the launch's own quote, which the card's terms hash covers.
 */
export interface LaunchDetails {
  /** The launchpad's name, as the action line names it. */
  readonly venue: string;
  /** The token the create call makes; absent before the launch is built. */
  readonly token?: AssetRef;
  /** The least of the token the first buy accepts; absent with no first buy or no quote. */
  readonly firstBuyMinOut?: Amount;
  /** The launchpad's fee; absent before the launchpad quoted it. */
  readonly fee?: Amount;
  readonly description?: string;
  readonly links: readonly LaunchLink[];
  /**
   * The uploaded picture, the one the create call writes, or the upload id of one not read yet;
   * absent for a launchpad that takes its picture as a link setting (decision 0276).
   */
  readonly picture?: LaunchPicture | WrittenLaunchPicture | { readonly upload: string };
  /** The launchpad's own settings, every one with its value, defaults filled. */
  readonly settings: readonly LaunchSetting[];
}

const text = (value: string): CardValue => ({ type: "text", text: value });
const choice = (value: string): CardValue => ({ type: "choice", choice: value });

const numberOf = (value: LaunchOptionValue): number => (typeof value === "number" ? value : 0);
const wordOf = (value: LaunchOptionValue): string => (typeof value === "string" ? value : "");

// A setting's value as its type shows it: a share as a percent, a flag as yes or no.
const settingValues: {
  readonly [T in LaunchSetting["type"]]: (value: LaunchOptionValue) => CardValue;
} = {
  bps: (value) => ({ type: "percent", bps: bpsSchema.parse(numberOf(value)) }),
  count: (value) => ({ type: "count", count: numberOf(value) }),
  flag: (value) => choice(value === true ? "yes" : "no"),
  choice: (value) => choice(wordOf(value)),
  account: (value) => text(accountRefParts(accountRefSchema.parse(wordOf(value))).address),
  link: (value) => text(wordOf(value)),
};

// A link setting's line names its value `link`, which a card shows whole, up to 512 characters
// (decision 0276); an account setting's `address`, which a card shows whole, since it receives
// money the launch sends; every other setting's, `value`.
const argumentOf = (type: LaunchSetting["type"]): string => {
  if (type === "link") {
    return "link";
  }
  return type === "account" ? "address" : "value";
};

const count = (value: number): CardValue => ({ type: "count", count: value });

function writtenPictureLine(picture: WrittenLaunchPicture): CardLine {
  const { format, bytes, width, height, digest } = picture;
  return {
    key: "card.launch.writtenPicture",
    values: {
      format: choice(format),
      bytes: count(bytes),
      width: count(width),
      height: count(height),
      digest: text(digest),
    },
  };
}

function pictureLine(picture: NonNullable<LaunchDetails["picture"]>): CardLine {
  if ("upload" in picture) {
    return { key: "card.launch.upload", values: { upload: text(picture.upload) } };
  }
  if ("width" in picture) {
    return writtenPictureLine(picture);
  }
  const { format, kib, digest, uri } = picture;
  return {
    key: "card.launch.picture",
    values: {
      format: choice(format),
      kib: count(kib),
      digest: text(digest),
      uri: text(uri),
    },
  };
}

function optional<T>(value: T | undefined, draw: (value: T) => CardLine): readonly CardLine[] {
  return value === undefined ? [] : [draw(value)];
}

/**
 * The lines a token launch's card shows under its action line (spec 4, section 3.3): the token it
 * makes, the first buy's minimum, the launch fee, the description, each link, the picture when
 * the launchpad takes one, uploaded or written into the create call, each launchpad setting, and,
 * once the picture is uploaded, that it is public already.
 */
export function launchDetailLines(details: LaunchDetails): readonly CardLine[] {
  const { picture } = details;
  return [
    ...optional(details.token, (token) => ({
      key: "card.launch.token",
      values: { token: { type: "asset", asset: token } },
    })),
    ...optional(details.firstBuyMinOut, (minOut) => ({
      key: "card.launch.firstBuyMin",
      values: { minOut: { type: "amount", amount: minOut } },
    })),
    ...optional(details.fee, (fee) => ({
      key: "card.launch.fee",
      values: { fee: { type: "amount", amount: fee } },
    })),
    ...optional(details.description, (description) => ({
      key: "card.launch.description",
      values: { description: text(description) },
    })),
    ...details.links.map((link): CardLine => ({
      key: "card.launch.link",
      values: { site: choice(link.site), url: text(link.url) },
    })),
    ...optional(picture, pictureLine),
    ...details.settings.map((setting): CardLine => ({
      key: launchSettingKey(setting.name),
      values: { [argumentOf(setting.type)]: settingValues[setting.type](setting.value) },
    })),
    ...(picture !== undefined && "uri" in picture
      ? [{ key: "card.launch.pinned", values: { venue: text(details.venue) } } as const]
      : []),
  ];
}
