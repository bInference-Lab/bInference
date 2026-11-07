import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { BinferenceError, err, type HttpDownload, ok, type Result } from "@binference/core";
import type { ViewImageRefusal, ViewImageSource } from "@binference/engine/chat";
import { readFileBytes, realPathOf, type WalledPaths } from "@binference/platform";
import { maxImageBytes } from "@binference/protocol";
import { isInside } from "./compose-files.js";

/** What the viewed images are read through on this machine. */
export interface ViewImageParts {
  /** Outbound downloads; without them, no address is read. */
  readonly download?: HttpDownload;
  /** binference's own folder, which no viewed file may be inside, and its workspace, which may. */
  readonly walled: WalledPaths;
  readonly homeDir?: string;
}

// A path as the shell reads it: `~` and `~/` are the home folder, a relative one is under it.
function absoluteOf(path: string, home: string): string {
  const expanded = path === "~" ? home : path.replace(/^~\//u, `${home}/`);
  return isAbsolute(expanded) ? expanded : join(home, expanded);
}

async function readPath(
  parts: ViewImageParts,
  path: string,
  signal: AbortSignal,
): Promise<Result<Uint8Array, ViewImageRefusal>> {
  const real = await realPathOf(absoluteOf(path, parts.homeDir ?? homedir()), signal);
  if (real === undefined) {
    return err("not_found");
  }
  const { roots, open } = parts.walled;
  if (isInside(real, roots) && !isInside(real, open)) {
    return err("walled");
  }
  return readFileBytes(real, { maxBytes: maxImageBytes, signal });
}

async function readUrl(
  parts: ViewImageParts,
  url: string,
  signal: AbortSignal,
): Promise<Result<Uint8Array, ViewImageRefusal>> {
  if (parts.download === undefined) {
    return err("unreadable");
  }
  try {
    const answer = await parts.download.download({
      url,
      maxBytes: maxImageBytes,
      signal,
      publicOnly: true,
    });
    return answer.status >= 200 && answer.status < 300 ? ok(answer.bytes) : err("not_found");
  } catch (error) {
    signal.throwIfAborted();
    const code = error instanceof BinferenceError ? error.code : "";
    if (code === "http.private_address") {
      return err("not_public");
    }
    return code === "http.answer_too_large" ? err("too_large") : err("unreadable");
  }
}

/**
 * The images the agent views on this machine (decision 0385): a web address through the outbound
 * downloads, only to public internet addresses, at most 5 MiB; a file, absolute or under the
 * owner's home folder, read at its real path so no link leads into binference's own folder,
 * whose workspace stays readable.
 */
export function viewImagesOf(parts: ViewImageParts): ViewImageSource {
  return {
    read: async (place, { signal }) =>
      "url" in place ? readUrl(parts, place.url, signal) : readPath(parts, place.path, signal),
  };
}
