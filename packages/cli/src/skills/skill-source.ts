import { err, ok, type Result } from "@binference/core";
import { isInsidePath } from "./read-skill-file.js";

/**
 * Where `skill/add` installs from (decision 0207): a git repository at one commit, or an npm
 * package at one version with its published integrity; `folder` is the skill's folder inside it.
 */
export type SkillSource =
  | {
      readonly kind: "git";
      readonly url: string;
      readonly commit: string;
      readonly folder?: string;
    }
  | {
      readonly kind: "npm";
      readonly spec: string;
      readonly integrity: string;
      readonly folder?: string;
    };

// A full commit id: SHA-1 or SHA-256 object names.
const commitId = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
// npm's published integrity for a tarball: SHA-512 in base64 (Subresource Integrity).
const sha512Integrity = /^sha512-[A-Za-z0-9+/]{86}==$/;
// A URL git clones over a transport that runs no command of its own.
const gitUrl = /^(?:https|ssh|file):\/\/[^\s#]+$/;
// A package name as npm publishes it, scoped or not, at an exact version.
const npmSpec =
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]{0,213}@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function split(rest: string): { readonly where: string; readonly folder?: string } | undefined {
  const at = rest.indexOf("#");
  if (at === -1) {
    return { where: rest };
  }
  const folder = rest.slice(at + 1);
  return isInsidePath(folder) ? { where: rest.slice(0, at), folder } : undefined;
}

/**
 * Reads `skill/add`'s source and hash: `git:<url>` (`https://`, `ssh://` or `file://`) with a
 * full commit id, or `npm:<name>@<version>` (an exact version) with a `sha512-` integrity, each
 * with an optional `#<folder>` inside the repository or package. Anything else is `bad_source`.
 */
export function readSkillSource(source: string, hash: string): Result<SkillSource, "bad_source"> {
  const parts = split(source.replace(/^(?:git|npm):/, ""));
  if (parts === undefined) {
    return err("bad_source");
  }
  const folder = parts.folder === undefined ? {} : { folder: parts.folder };
  if (source.startsWith("git:") && gitUrl.test(parts.where) && commitId.test(hash)) {
    return ok({ kind: "git", url: parts.where, commit: hash, ...folder });
  }
  if (source.startsWith("npm:") && npmSpec.test(parts.where) && sha512Integrity.test(hash)) {
    return ok({ kind: "npm", spec: parts.where, integrity: hash, ...folder });
  }
  return err("bad_source");
}
