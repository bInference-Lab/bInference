import { extname, isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { type RealPathStep, readJudgedFile, type WalledPaths } from "@binference/platform";

/** A `file:` page, or a part of one, that the browser gets as bytes instead of opening its path. */
export interface FilePage {
  readonly bytes: Uint8Array;
  /** The type its name's extension gives; without one, the browser reads the bytes as it would. */
  readonly contentType?: string;
}

// The most a `file:` page or part may hold: it is read whole into the engine first.
const maxFilePageBytes = 20 * 1024 * 1024;

const contentTypes: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".xhtml": "application/xhtml+xml",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".csv": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

function isInside(folder: string, path: string): boolean {
  const between = relative(folder, path);
  return between === "" || (!between.startsWith("..") && !isAbsolute(between));
}

// The path a `file:` address names, or none for one that names a host this OS cannot reach.
function pathOf(url: string): string | undefined {
  try {
    return fileURLToPath(url);
  } catch {
    return undefined;
  }
}

/** Whether a path is inside binference's own folder and outside the folders it leaves open. */
export function isWalledPath(walled: WalledPaths, path: string): boolean {
  return (
    walled.roots.some((root) => isInside(root, path)) &&
    !walled.open.some((folder) => isInside(folder, path))
  );
}

/**
 * The bytes a `file:` address serves (decision 0410): its file read whole through the one handle
 * whose real path, and the path asked, lie outside binference's own folder, at most 20 MiB. A path
 * that leads elsewhere by then, a folder, a walled file and anything unreadable serve nothing.
 */
export async function readFilePage(
  parts: { readonly walled: WalledPaths; readonly realPath: RealPathStep },
  url: string,
  signal: AbortSignal,
): Promise<FilePage | undefined> {
  const path = pathOf(url);
  if (path === undefined || isWalledPath(parts.walled, path)) {
    return undefined;
  }
  const read = await readJudgedFile(path, {
    maxBytes: maxFilePageBytes,
    signal,
    judge: (real) => (isWalledPath(parts.walled, real) ? "walled" : undefined),
    realPath: parts.realPath,
  });
  if (read.kind !== "read") {
    return undefined;
  }
  const contentType = contentTypes[extname(path).toLowerCase()];
  return contentType === undefined ? { bytes: read.bytes } : { bytes: read.bytes, contentType };
}
