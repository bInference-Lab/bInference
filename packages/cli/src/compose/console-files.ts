import { Buffer } from "node:buffer";
import { join } from "node:path";
import { BinferenceError, type Logger } from "@binference/core";
import { listFolderFiles, readFilePieces } from "@binference/platform";
import type { ConsoleFiles } from "@binference/server";

// The console's build is about a megabyte; past these the folder is not the console's build.
const maxFiles = 200;
const maxBytes = 32 * 1024 * 1024;

function tooLarge(folder: string): BinferenceError {
  return new BinferenceError({
    code: "cli.console_too_large",
    message: `${folder} holds more than the console's build.`,
    details: { folder },
  });
}

async function readWhole(path: string, signal: AbortSignal): Promise<Uint8Array> {
  const pieces: Uint8Array[] = [];
  for await (const piece of readFilePieces(path, { signal })) {
    pieces.push(piece);
  }
  return Buffer.concat(pieces);
}

// Every file of the folder in memory, by its path with `/` between parts, so the server serves
// them without touching the disk again.
async function readConsoleFiles(folder: string, signal: AbortSignal): Promise<ConsoleFiles> {
  const paths = await listFolderFiles(folder, signal);
  if (paths.length > maxFiles) {
    throw tooLarge(folder);
  }
  const files = new Map<string, Uint8Array>();
  let total = 0;
  for (const path of paths) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one file at a time bounds the memory read
    const body = await readWhole(join(folder, path), signal);
    total += body.byteLength;
    if (total > maxBytes) {
      throw tooLarge(folder);
    }
    files.set(path, body);
  }
  return files;
}

/**
 * The console's built files for the engine to serve, read into memory once, or `undefined` when
 * the host names no console build or the build has no `index.html`, as before `pnpm build`; that
 * is logged, and the engine runs without the console. Throws `cli.console_too_large` past 200
 * files or 32 MiB, and `platform.file_read_failed` for a file it cannot read.
 */
export async function openConsoleFiles(
  folder: string | undefined,
  context: { readonly logger: Logger; readonly signal: AbortSignal },
): Promise<ConsoleFiles | undefined> {
  if (folder === undefined) {
    return undefined;
  }
  const files = await readConsoleFiles(folder, context.signal);
  if (!files.has("index.html")) {
    context.logger.warn("server.console_missing");
    return undefined;
  }
  return files;
}
