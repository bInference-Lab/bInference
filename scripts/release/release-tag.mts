/** The two release channels (decision 0063): `stable`, and `beta` ahead of it. */
export type ReleaseChannel = "stable" | "beta";

/** A release tag read as its calver version, its channel and where the channel publishes. */
export interface ReleaseTag {
  readonly tag: string;
  readonly version: string;
  readonly channel: ReleaseChannel;
  /** The npm dist-tag the channel publishes to: `latest` for stable, which `npm i` reads. */
  readonly npmTag: "latest" | "beta";
  /** The image tags: the version and the channel's moving tag. */
  readonly imageTags: readonly string[];
}

interface CalverParts {
  readonly year: number;
  readonly month: number;
  readonly patch: number;
  /** The beta number, or undefined on the stable channel. */
  readonly beta: number | undefined;
}

// vYYYY.M.PATCH, or vYYYY.M.PATCH-beta.N: no leading zeros, a month from 1 to 12.
const tagPattern = /^v(20\d\d)\.([1-9]|1[0-2])\.(0|[1-9]\d*)(?:-beta\.(0|[1-9]\d*))?$/;

const tagForms =
  "A release tag is vYYYY.M.PATCH on the stable channel or vYYYY.M.PATCH-beta.N on the beta " +
  "channel, such as v2026.11.0 or v2026.11.0-beta.1, with no leading zeros.";

function partsOf(tag: string): CalverParts | undefined {
  const match = tagPattern.exec(tag);
  if (match === null) {
    return undefined;
  }
  const [, year = "", month = "", patch = "", beta] = match;
  return {
    year: Number(year),
    month: Number(month),
    patch: Number(patch),
    beta: beta === undefined ? undefined : Number(beta),
  };
}

/** Reads a release tag, or returns why it is not one. */
export function parseReleaseTag(tag: string): ReleaseTag | string {
  const parts = partsOf(tag);
  if (parts === undefined) {
    return `${tag} is not a release tag. ${tagForms}`;
  }
  const version = tag.slice(1);
  const channel: ReleaseChannel = parts.beta === undefined ? "stable" : "beta";
  return {
    tag,
    version,
    channel,
    npmTag: channel === "stable" ? "latest" : "beta",
    imageTags: [version, channel === "stable" ? "latest" : "beta"],
  };
}

// Semver order: year, month and patch, then a beta before the release it leads to.
function compareParts(a: CalverParts, b: CalverParts): number {
  const order =
    a.year - b.year ||
    a.month - b.month ||
    a.patch - b.patch ||
    (a.beta ?? Number.POSITIVE_INFINITY) - (b.beta ?? Number.POSITIVE_INFINITY);
  return Number.isNaN(order) ? 0 : order;
}

// Orders two release tags as npm orders their versions; tags that are not releases sort first.
function compareReleaseTags(a: string, b: string): number {
  const left = partsOf(a);
  const right = partsOf(b);
  if (left === undefined || right === undefined) {
    return Number(left !== undefined) - Number(right !== undefined);
  }
  return compareParts(left, right);
}

// YYYY.M.PATCH-nightly.N: a prerelease no release tag names, so no release publishes it.
const nightlyPattern = /^(20\d\d)\.([1-9]|1[0-2])\.(0|[1-9]\d*)-nightly\.(0|[1-9]\d*)$/;

/**
 * Checks a nightly pack's version (decision 0354), `YYYY.M.PATCH-nightly.N` such as
 * `2026.11.0-nightly.42`. Returns why it is not one, or nothing.
 */
export function nightlyVersionProblem(version: string): string | undefined {
  return nightlyPattern.test(version)
    ? undefined
    : `${version} is not a nightly version. A nightly pack takes YYYY.M.PATCH-nightly.N, such ` +
        "as 2026.11.0-nightly.42, which no release publishes.";
}

/** The release tags among `tags`, other than `tag`, whose version is not older than its own. */
export function tagsNotOlder(tag: string, tags: readonly string[]): readonly string[] {
  return tags.filter(
    (other) => other !== tag && partsOf(other) !== undefined && compareReleaseTags(other, tag) >= 0,
  );
}

/** The newest release tag among `tags` that is older than `tag`, if any. */
export function previousTag(tag: string, tags: readonly string[]): string | undefined {
  return tags
    .filter((other) => partsOf(other) !== undefined && compareReleaseTags(other, tag) < 0)
    .toSorted(compareReleaseTags)
    .at(-1);
}
