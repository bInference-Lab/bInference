// Release numbers of the running Node, for working around behaviour a given release fixed.

/** A Node release as `major.minor.patch`. */
export interface NodeRelease {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const decimal = /^(?:0|[1-9]\d*)$/;
const buildMetadata = /^[\dA-Za-z-]+(?:\.[\dA-Za-z-]+)*$/;

/** Build metadata after `+` is ignored, but must be well formed and appear at most once. */
function validMetadata(metadata: readonly string[]): boolean {
  return metadata.length === 0 || (metadata.length === 1 && buildMetadata.test(metadata[0] ?? ""));
}

/**
 * Reads a release such as `26.10.0`, `v26.10.0` or `26.10.0+build.1`. Pre-releases, partial
 * numbers and numbers with leading zeros give `undefined`.
 */
export function parseNodeRelease(text: string | undefined): NodeRelease | undefined {
  if (text === undefined) {
    return undefined;
  }
  const [numbers = "", ...metadata] = text.replace(/^v/, "").split("+");
  if (!validMetadata(metadata)) {
    return undefined;
  }
  const fields = numbers.split(".");
  if (fields.length !== 3 || !fields.every((field) => decimal.test(field))) {
    return undefined;
  }
  const [major = 0, minor = 0, patch = 0] = fields.map(Number);
  return { major, minor, patch };
}

/** Whether `release` is `minimum` or later. An unknown release counts as older than any. */
export function isNodeReleaseAtLeast(
  release: NodeRelease | undefined,
  minimum: NodeRelease,
): boolean {
  if (release === undefined) {
    return false;
  }
  const difference =
    release.major - minimum.major || release.minor - minimum.minor || release.patch - minimum.patch;
  return difference >= 0;
}
