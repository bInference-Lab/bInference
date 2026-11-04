import {
  type Clock,
  err,
  type Http,
  type JsonValue,
  jsonValueSchema,
  ok,
  type Result,
} from "@binference/core";
import { type ReleaseNotes, releaseNotesSchema } from "@binference/protocol";
import { z } from "zod";
import { isOlderVersion } from "../plugins/version-order.js";

/** The release channels of decision 0063: `stable`, and `beta` ahead of it. */
export type ReleaseChannel = "stable" | "beta";

/** The npm package owners install, whose versions and notes the update check reads. */
export const releasePackage = "binference";

/**
 * Reads binference's releases from npm's registry (decision 0355): the newest version on a channel
 * from the package's dist-tags, and a version's notes for owners from its manifest.
 */
export interface ReleaseFeed {
  /** The newest release on the channel, if any; `unreachable` when the registry gave nothing to use. */
  newest(
    channel: ReleaseChannel,
    signal: AbortSignal,
  ): Promise<Result<string | undefined, "unreachable">>;
  /** The version's notes for owners, as its manifest carries them; none when they do not read. */
  notes(version: string, signal: AbortSignal): Promise<ReleaseNotes | undefined>;
}

/** What the feed reads through. */
export interface ReleaseFeedParts {
  readonly http: Http;
  /** The registry's origin: npm's public one, or a test's stand-in on loopback. */
  readonly registry: string;
  /** The user agent each request names, binference's own followed by what the check adds. */
  readonly userAgent: string;
  /**
   * With a clock, the newest release of a channel is read at most once a minute and shared by
   * every caller meanwhile, so clients that ask often reach npm once.
   */
  readonly clock?: Clock;
}

type Newest = Result<string | undefined, "unreachable">;

// How long one read of the dist-tags answers every caller.
const newestReuseMs = 60_000;

const kibibyte = 1024;
const tagsBound = { maxBytes: 16 * kibibyte, ms: 10_000 } as const;
const manifestBound = { maxBytes: 1024 * kibibyte, ms: 10_000 } as const;

// A stable or beta version of decision 0353: no leading zeros, a month from 1 to 12.
const releaseForm = /^20\d\d\.(?:[1-9]|1[0-2])\.(?:0|[1-9]\d*)(?:-beta\.(?:0|[1-9]\d*))?$/;

const distTagsSchema = z.record(z.string(), z.string());
const manifestSchema = z.object({
  binference: z.object({ releaseNotes: z.unknown() }).optional(),
});

/** Whether `version` is a stable or beta release of decision 0353, such as `2026.11.0-beta.1`. */
export function isReleaseForm(version: string): boolean {
  return releaseForm.test(version);
}

/** Whether `version` comes after `than` in SemVer's order. */
export function isNewerVersion(version: string, than: string): boolean {
  return version !== than && isOlderVersion(than, version);
}

// One bounded GET of JSON: its value on a 200 that reads, else nothing.
async function getJson(
  parts: ReleaseFeedParts,
  request: { readonly path: string; readonly bound: typeof tagsBound | typeof manifestBound },
  signal: AbortSignal,
): Promise<JsonValue | undefined> {
  const answer = await parts.http.request({
    method: "GET",
    url: `${new URL(parts.registry).origin}${request.path}`,
    headers: { accept: "application/json", "user-agent": parts.userAgent },
    signal: AbortSignal.any([signal, AbortSignal.timeout(request.bound.ms)]),
  });
  const size = new TextEncoder().encode(answer.body).byteLength;
  if (answer.status !== 200 || size > request.bound.maxBytes) {
    return undefined;
  }
  try {
    const parsed = jsonValueSchema.safeParse(JSON.parse(answer.body));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

// The channel's newest release among the dist-tags: `latest` on stable, the newer of `beta` and
// `latest` on beta, so a beta owner also gets a newer stable release.
function newestOf(
  tags: Readonly<Record<string, string>>,
  channel: ReleaseChannel,
): string | undefined {
  const named = channel === "stable" ? [tags["latest"]] : [tags["beta"], tags["latest"]];
  const releases = named.filter(
    (version): version is string => version !== undefined && isReleaseForm(version),
  );
  return releases.reduce<string | undefined>(
    (newest, version) =>
      newest === undefined || isNewerVersion(version, newest) ? version : newest,
    undefined,
  );
}

/**
 * The release feed over npm's registry: `GET /-/package/binference/dist-tags` in 10 seconds and
 * 16 KiB, and `GET /binference/<version>` in 10 seconds and 1 MiB, each through the `Http` port
 * with the user agent given. A dist-tag that names no stable or beta form is left out. A request
 * that fails, or an answer that is not a 200 or does not read, is `unreachable` for the dist-tags
 * and no notes for a manifest. With a clock, a channel's dist-tags are read at most once a minute.
 */
export function createReleaseFeed(parts: ReleaseFeedParts): ReleaseFeed {
  const read = async (channel: ReleaseChannel, signal: AbortSignal): Promise<Newest> => {
    try {
      const path = `/-/package/${releasePackage}/dist-tags`;
      const tags = distTagsSchema.safeParse(
        await getJson(parts, { path, bound: tagsBound }, signal),
      );
      return tags.success ? ok(newestOf(tags.data, channel)) : err("unreachable");
    } catch {
      signal.throwIfAborted();
      return err("unreachable");
    }
  };
  const recent = new Map<
    ReleaseChannel,
    { readonly atMs: number; readonly newest: Promise<Newest> }
  >();
  return {
    async newest(channel, signal) {
      const { clock } = parts;
      if (clock === undefined) {
        return read(channel, signal);
      }
      const seen = recent.get(channel);
      if (seen !== undefined && clock.now() - seen.atMs < newestReuseMs) {
        return seen.newest;
      }
      const newest = read(channel, signal);
      recent.set(channel, { atMs: clock.now(), newest });
      return newest;
    },
    async notes(version, signal) {
      try {
        const path = `/${releasePackage}/${version}`;
        const manifest = manifestSchema.safeParse(
          await getJson(parts, { path, bound: manifestBound }, signal),
        );
        const notes = releaseNotesSchema.safeParse(manifest.data?.binference?.releaseNotes);
        return notes.success ? notes.data : undefined;
      } catch {
        signal.throwIfAborted();
        return undefined;
      }
    },
  };
}
