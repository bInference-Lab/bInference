// Adapted from MIT-licensed code; NOTICES.md holds its notice. Changed: TypeScript types, and
// the version text is a string or absent.

/** A Node release version, `major.minor.patch`. */
export interface NodeRelease {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const releasePattern =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

/** Parses `process.versions.node`; `undefined` for anything that is not a plain release. */
export function parseNodeRelease(text: string | undefined): NodeRelease | undefined {
  const match = releasePattern.exec(text?.trim() ?? "");
  if (match === null) {
    return undefined;
  }
  const release = { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
  return Object.values(release).every(Number.isSafeInteger) ? release : undefined;
}

/** Whether `release` is `minimum` or later. An unknown release is never late enough. */
export function isNodeReleaseAtLeast(
  release: NodeRelease | undefined,
  minimum: NodeRelease,
): boolean {
  if (release === undefined) {
    return false;
  }
  if (release.major !== minimum.major) {
    return release.major > minimum.major;
  }
  if (release.minor !== minimum.minor) {
    return release.minor > minimum.minor;
  }
  return release.patch >= minimum.patch;
}
