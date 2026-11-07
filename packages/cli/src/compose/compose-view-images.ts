import { BinferenceError, err, type HttpDownload, ok, type Result } from "@binference/core";
import type { ViewImageRefusal, ViewImageSource } from "@binference/engine/chat";
import type { EngineFiles, FileRefusal } from "@binference/engine/shell";
import { maxImageBytes } from "@binference/protocol";

/** What the viewed images are read through on this machine. */
export interface ViewImageParts {
  /** Outbound downloads; without them, no address is read. */
  readonly download?: HttpDownload;
  /** The agent's files, which a viewed file is read through, under the same rules. */
  readonly files: EngineFiles;
}

const fileRefusals: Readonly<Record<FileRefusal, ViewImageRefusal>> = {
  not_found: "not_found",
  walled: "walled",
  outside_workspace: "outside_workspace",
  too_large: "too_large",
  is_folder: "unreadable",
  unreadable: "unreadable",
  unwritable: "unreadable",
  exists: "unreadable",
};

// A file read as the file tools read it: relative paths in the workspace, the state folder
// walled off, and the workspace alone when the owner's setting says so.
async function readPath(
  parts: ViewImageParts,
  path: string,
  signal: AbortSignal,
): Promise<Result<Uint8Array, ViewImageRefusal>> {
  const { files, settings } = parts.files;
  const call = { signal, workspaceOnly: settings().workspaceOnly, maxBytes: maxImageBytes };
  const read = await files.read(path, call);
  return read.ok ? ok(read.value.bytes) : err(fileRefusals[read.error]);
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
 * downloads, only to public internet addresses, at most 5 MiB; a file through the agent's file
 * adapter, as the file tools read it: relative paths in the workspace, binference's own folder
 * walled off, and the workspace alone when `files.workspaceOnly` says so.
 */
export function viewImagesOf(parts: ViewImageParts): ViewImageSource {
  return {
    read: async (place, { signal }) =>
      "url" in place ? readUrl(parts, place.url, signal) : readPath(parts, place.path, signal),
  };
}
