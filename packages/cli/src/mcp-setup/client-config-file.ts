import { dirname } from "node:path";
import { BinferenceError } from "@binference/core";
import { ensurePrivateFolder, readTextFile, writePrivateFile } from "@binference/platform";
import { platformOf } from "../compose/engine-locations.js";
import type { ClientPlaces } from "./client-places.js";
import type { SetupRun } from "./setup-change.js";

/** A client's config file as read: its text, or `undefined` when there is no file yet. */
export interface ConfigText {
  readonly file: string;
  readonly text?: string;
}

/** Reads a client's config file; a missing file is no text. */
export async function readConfigText(file: string, signal: AbortSignal): Promise<ConfigText> {
  const read = await readTextFile(file, signal);
  return read.ok ? { file, text: read.value } : { file };
}

/** A client config the setup cannot read, so it leaves the file as it is. */
export function unreadableConfig(file: string): BinferenceError {
  return new BinferenceError({
    code: "cli.client_config_unreadable",
    message: `${file} could not be read, so it was left as it is.`,
    details: { file },
  });
}

/**
 * Writes a client's config file, owner-only. A new file's folder is made first, unless it is the
 * home folder, whose access the setup never changes.
 */
export async function writeConfigText(
  run: SetupRun,
  config: ConfigText & { readonly next: string },
  places: ClientPlaces,
): Promise<void> {
  const files = { permissions: platformOf(run.host).permissions, signal: run.signal };
  const folder = dirname(config.file);
  if (config.text === undefined && folder !== places.home) {
    await ensurePrivateFolder(folder, files);
  }
  await writePrivateFile(config.file, config.next, files);
}
