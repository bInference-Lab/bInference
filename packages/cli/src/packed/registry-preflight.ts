import { type JsonValue, jsonValueSchema } from "@binference/core";
import { z } from "zod";
import { isOlderVersion } from "../plugins/version-order.js";

/**
 * What npm's registry answered for one package, read from
 * `npm view <name> versions dist-tags --json`: the versions and dist-tags it holds, `new` for a
 * package it never held, or `unread` with why.
 */
export type RegistryAnswer =
  | {
      readonly kind: "published";
      readonly versions: readonly string[];
      readonly distTags: Readonly<Record<string, string>>;
    }
  | { readonly kind: "new" }
  | { readonly kind: "unread"; readonly reason: string };

// npm prints a lone version as a string, more than one as a list.
const publishedSchema = z.looseObject({
  versions: z.union([z.string(), z.array(z.string())]),
  "dist-tags": z.record(z.string(), z.string()).optional(),
});

const errorSchema = z.looseObject({
  error: z.looseObject({ code: z.string().optional(), summary: z.string().optional() }),
});

function parsedJson(output: string): JsonValue | undefined {
  try {
    return jsonValueSchema.parse(JSON.parse(output.trim()));
  } catch {
    return undefined;
  }
}

/**
 * Reads what `npm view <name> versions dist-tags --json --loglevel=silent` printed and how it
 * ended. npm prints an error as JSON too: E404 means npm never held the package, and any other
 * error, or an answer that does not read, leaves it unread.
 */
export function readRegistryAnswer(status: number, output: string): RegistryAnswer {
  const json = parsedJson(output);
  const published = publishedSchema.safeParse(json);
  if (status === 0 && published.success) {
    const { versions, "dist-tags": distTags = {} } = published.data;
    return { kind: "published", versions: [versions].flat(), distTags };
  }
  const failure = errorSchema.safeParse(json);
  if (failure.success && failure.data.error.code === "E404") {
    return { kind: "new" };
  }
  const reason = failure.success
    ? (failure.data.error.code ?? failure.data.error.summary ?? "an error with no code")
    : `exit ${String(status)} with no answer that reads`;
  return { kind: "unread", reason };
}

/** One package a release publishes, with what npm answered for it. */
export interface PackageOnRegistry {
  readonly name: string;
  readonly answer: RegistryAnswer;
}

/** What a release asks of npm: its version, and whether its tag names the commit already. */
export interface PreflightAsk {
  readonly version: string;
  /**
   * The tag exists and names the commit, as on the release workflow's runs: a version npm holds
   * then is a publish that stopped halfway, which the npm job skips, not a mistake.
   */
  readonly tagged: boolean;
}

/** What the preflight found, one line each: what to print, what to warn of, what refuses. */
export interface RegistryPreflight {
  readonly lines: readonly string[];
  readonly warnings: readonly string[];
  readonly problems: readonly string[];
}

function tagsText(distTags: Readonly<Record<string, string>>): string {
  const tags = Object.entries(distTags).map(([tag, version]) => `${tag} is ${version}`);
  return tags.length === 0 ? "no dist-tags" : tags.join(", ");
}

// The newest of the versions npm holds that this release is not newer than, other than its own.
function newestNotOlder(version: string, versions: readonly string[]): string | undefined {
  return versions
    .filter((held) => held !== version && !isOlderVersion(held, version))
    .toSorted((a, b) => (isOlderVersion(a, b) ? -1 : 1))
    .at(-1);
}

function publishedFinding(
  name: string,
  ask: PreflightAsk,
  answer: Extract<RegistryAnswer, { kind: "published" }>,
): RegistryPreflight {
  const release = `${name}@${ask.version}`;
  const held = answer.versions.includes(ask.version);
  const newer = newestNotOlder(ask.version, answer.versions);
  const line = `${name}: on npm, ${tagsText(answer.distTags)}; it publishes through trusted publishing.`;
  const problems = [
    ...(held && !ask.tagged
      ? [`${release} is on npm already, which never takes a version twice.`]
      : []),
    ...(newer === undefined
      ? []
      : [`${release} is not newer than ${newer} on npm; pick a newer version.`]),
  ];
  const lines =
    held && ask.tagged ? [line, `${release}: on npm already; the npm job skips it.`] : [line];
  return { lines, warnings: [], problems };
}

function packageFinding(ask: PreflightAsk, { name, answer }: PackageOnRegistry): RegistryPreflight {
  if (answer.kind === "published") {
    return publishedFinding(name, ask, answer);
  }
  if (answer.kind === "new") {
    const line =
      `${name}: not on npm yet; its first publish needs NPM_BOOTSTRAP_TOKEN in the release ` +
      "environment (decision 0451).";
    return { lines: [line], warnings: [], problems: [] };
  }
  const warning =
    `${name}: npm could not be read (${answer.reason}); its version and first publish are ` +
    "unchecked.";
  return { lines: [], warnings: [warning], problems: [] };
}

/**
 * Checks a release's version against what npm holds for each package it publishes, before
 * anything is built: a version npm holds already, unless the tag names the commit, or one not
 * newer than every version npm holds refuses. Names the packages whose first publish needs the
 * bootstrap token (decision 0451), prints each package's dist-tags, and warns of each package
 * npm did not answer for.
 */
export function registryPreflight(
  ask: PreflightAsk,
  packages: readonly PackageOnRegistry[],
): RegistryPreflight {
  const findings = packages.map((item) => packageFinding(ask, item));
  return {
    lines: findings.flatMap((finding) => finding.lines),
    warnings: findings.flatMap((finding) => finding.warnings),
    problems: findings.flatMap((finding) => finding.problems),
  };
}
