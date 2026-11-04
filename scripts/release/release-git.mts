import { commitOf, gitOutput as git } from "../git-base.mjs";
import type { ReleaseCommit } from "./release-notes.mjs";
import { previousTag, type ReleaseTag, tagsNotOlder } from "./release-tag.mjs";

/** Where a release is cut from: the commit, and whether its tag exists yet. */
export interface ReleasePoint {
  readonly commit: string;
  readonly tagged: boolean;
  /** The release tag its notes start after, if any. */
  readonly previous: string | undefined;
}

// The release tags whose commit HEAD holds, so a tag cut on another line never starts the notes.
function tagsInHistory(root: string): readonly string[] {
  return (git(root, ["tag", "--list", "v*", "--merged", "HEAD"]) ?? "").split("\n").filter(Boolean);
}

/**
 * Checks that a release may be cut from HEAD: the tree is clean, the tag (when it exists) names
 * HEAD, and no release tag in the repository is as new as this one. Returns the problem, or the
 * point the release is cut from.
 */
export function releasePoint(root: string, release: ReleaseTag): ReleasePoint | string {
  if ((git(root, ["status", "--porcelain"]) ?? "x").length > 0) {
    return "The working tree has changes. A release builds from a clean tree: commit or drop them.";
  }
  const head = commitOf(root, "HEAD") ?? "";
  const tagged = commitOf(root, `refs/tags/${release.tag}`);
  if (tagged !== undefined && tagged !== head) {
    return `${release.tag} names ${tagged}, not HEAD (${head}). Check out the tag first.`;
  }
  const all = (git(root, ["tag", "--list", "v*"]) ?? "").split("\n").filter(Boolean);
  const newer = tagsNotOlder(release.tag, all);
  if (newer.length > 0) {
    return `${release.tag} is not newer than ${newer.join(", ")}. A release version only grows.`;
  }
  return {
    commit: head,
    tagged: tagged !== undefined,
    previous: previousTag(release.tag, tagsInHistory(root)),
  };
}

const fieldEnd = "\u001F";
const recordEnd = "\u001E";

/** The commits after `since` up to HEAD, or all of HEAD's, newest first, without merges. */
export function commitsSince(root: string, since: string | undefined): readonly ReleaseCommit[] {
  const range = since === undefined ? "HEAD" : `${since}..HEAD`;
  const log = git(root, ["log", "--no-merges", `--format=%s${fieldEnd}%b${recordEnd}`, range]);
  if (log === undefined) {
    throw new Error(`git log ${range} failed; is ${since ?? "HEAD"} a commit here?`);
  }
  return log
    .split(recordEnd)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [subject = "", body = ""] = record.split(fieldEnd);
      return { subject, body };
    });
}
