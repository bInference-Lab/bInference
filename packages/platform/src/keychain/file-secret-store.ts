import { join } from "node:path";
import { checkSecretName, createSecret, ok, type SecretStore } from "@binference/core";
import type { FilePermissions } from "../ports.js";
import { ensurePrivateFolder, writePrivateFile } from "../private-files.js";
import { readTextFile } from "../read-text-file.js";
import { removeEntryFile } from "./remove-entry-file.js";

/** Where the file store keeps its entries. */
export interface FileSecretStoreOptions {
  /** The state folder's `keys/` folder; it is made owner-only on the first write. */
  readonly folder: string;
  readonly permissions: FilePermissions;
}

/**
 * The `file` unlock mode's store, for headless machines and Docker where no OS keychain answers
 * and the engine must start on its own: each entry is the file `<folder>/<name>` holding the
 * secret as text, readable only by its owner, written to a temporary file and renamed into place.
 * A read gives the file's content trimmed, as a `{ fromFile }` secret source reads it. Anyone who
 * reads the folder holds the secrets, so `binference check` warns about this mode.
 */
export function createFileSecretStore(options: FileSecretStoreOptions): SecretStore {
  const pathOf = (name: string): string => {
    checkSecretName(name);
    return join(options.folder, name);
  };
  return {
    read: async (name, signal) => {
      const path = pathOf(name);
      const read = await readTextFile(path, signal);
      return read.ok ? ok(createSecret(read.value.trim())) : read;
    },
    write: async (name, value, signal) => {
      const path = pathOf(name);
      const files = { permissions: options.permissions, signal };
      await ensurePrivateFolder(options.folder, files);
      await writePrivateFile(path, `${value.reveal()}\n`, files);
    },
    delete: async (name, signal) => {
      const path = pathOf(name);
      signal.throwIfAborted();
      return removeEntryFile(path);
    },
  };
}
