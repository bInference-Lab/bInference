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

/** One read's signal and the most bytes it takes. */
interface ReadLimits {
  readonly signal: AbortSignal;
  readonly maxBytes: number;
}

const fileRefusals: Readonly<Record<FileRefusal, ViewImageRefusal>> = {
  not_found: "not_found",
  walled: "walled",
  skill_folder: "walled",
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
  read: ReadLimits,
): Promise<Result<Uint8Array, ViewImageRefusal>> {
  const { files, settings } = parts.files;
  const { signal, maxBytes } = read;
  const call = { signal, workspaceOnly: settings().workspaceOnly, maxBytes };
  const file = await files.read(path, call);
  return file.ok ? ok(file.value.bytes) : err(fileRefusals[file.error]);
}

async function readUrl(
  parts: ViewImageParts,
  url: string,
  read: ReadLimits,
): Promise<Result<Uint8Array, ViewImageRefusal>> {
  const { signal, maxBytes } = read;
  if (parts.download === undefined) {
    return err("unreadable");
  }
  try {
    const answer = await parts.download.download({
      url,
      maxBytes,
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
 * downloads, only to public internet addresses, at most 5 MiB unless the read allows more (a PDF,
 * decision 0402); a file through the agent's file
 * adapter, as the file tools read it: relative paths in the workspace, binference's own folder
 * walled off, and the workspace alone when `files.workspaceOnly` says so.
 */
export function viewImagesOf(parts: ViewImageParts): ViewImageSource {
  return {
    read: async (place, { signal, maxBytes = maxImageBytes }) =>
      "url" in place
        ? readUrl(parts, place.url, { signal, maxBytes })
        : readPath(parts, place.path, { signal, maxBytes }),
  };
}
