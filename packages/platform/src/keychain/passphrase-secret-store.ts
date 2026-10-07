import { join } from "node:path";
import {
  BinferenceError,
  checkSecretName,
  type Result,
  type Secret,
  type SecretStore,
} from "@binference/core";
import type { FilePermissions } from "../ports.js";
import { ensurePrivateFolder, writePrivateFile } from "../private-files.js";
import { readTextFile } from "../read-text-file.js";
import { removeEntryFile } from "./remove-entry-file.js";
import { openSealedSecret, sealSecret } from "./sealed-secret.js";
import { parseSealedSecret, type SealedSecret } from "./sealed-secret.schema.js";

/** Where the passphrase store keeps its files, and what opens them. */
export interface PassphraseSecretStoreOptions {
  /** The state folder's `keys/` folder; it is made owner-only on the first write. */
  readonly folder: string;
  /** The install's id; each file is bound to it, so a file copied from another install never opens. */
  readonly installId: string;
  /** The owner's passphrase. */
  readonly passphrase: Secret;
  readonly permissions: FilePermissions;
  /** The scrypt cost of new files; 131072 when left out. Tests pass 1024. */
  readonly scryptCost?: number;
}

const defaultCost = 131_072;

interface EntryFile {
  readonly path: string;
  readonly format: string;
  readonly aad: string;
}

function fileFrom(options: PassphraseSecretStoreOptions, name: string): EntryFile {
  checkSecretName(name);
  return {
    path: join(options.folder, `${name}.json`),
    format: `binference-${name}`,
    aad: `binference-${name}-v1:${options.installId}`,
  };
}

// The format and the associated data name the entry and the install, so a file renamed from
// another entry or copied from another install is refused before any key is derived.
function parseSealed(file: EntryFile, text: string): SealedSecret {
  const sealed = parseSealedSecret(text);
  if (sealed === undefined || sealed.format !== file.format || sealed.aad !== file.aad) {
    throw new BinferenceError({
      code: "platform.secret_file_invalid",
      message: `${file.path} is not a sealed secret of this install; restore it or write it again.`,
      details: { path: file.path },
    });
  }
  return sealed;
}

async function readEntry(
  options: PassphraseSecretStoreOptions,
  file: EntryFile,
  signal: AbortSignal,
): Promise<Result<Secret, "not_found">> {
  const text = await readTextFile(file.path, signal);
  if (!text.ok) {
    return text;
  }
  const opened = await openSealedSecret(parseSealed(file, text.value), options.passphrase);
  if (!opened.ok) {
    throw new BinferenceError({
      code: "platform.passphrase_rejected",
      message: `The passphrase does not open ${file.path}; check it, or restore the file.`,
      details: { path: file.path },
    });
  }
  return opened;
}

/**
 * Secrets in owner-only files sealed with the owner's passphrase, for machines where no OS keychain
 * answers, such as headless Linux and Docker. Each entry is `<folder>/<name>.json`: scrypt with a
 * cost of 131072, then AES-256-GCM bound to the entry and the install, written to a temporary file
 * and renamed into place. Throws `platform.passphrase_rejected` when the passphrase does not open a
 * file and `platform.secret_file_invalid` when a file is not a sealed secret of this entry and
 * install. Throws `platform.passphrase_empty` at once for an empty passphrase.
 */
export function createPassphraseSecretStore(options: PassphraseSecretStoreOptions): SecretStore {
  if (options.passphrase.reveal() === "") {
    throw new BinferenceError({
      code: "platform.passphrase_empty",
      message: "The passphrase is empty; type one to seal the secrets with.",
    });
  }
  const cost = options.scryptCost ?? defaultCost;
  return {
    read: async (name, signal) => {
      const file = fileFrom(options, name);
      signal.throwIfAborted();
      return readEntry(options, file, signal);
    },
    write: async (name, value, signal) => {
      const file = fileFrom(options, name);
      signal.throwIfAborted();
      const sealed = await sealSecret(value, options.passphrase, {
        format: file.format,
        aad: file.aad,
        cost,
      });
      const files = { permissions: options.permissions, signal };
      await ensurePrivateFolder(options.folder, files);
      await writePrivateFile(file.path, `${JSON.stringify(sealed, null, 2)}\n`, files);
    },
    delete: async (name, signal) => {
      const file = fileFrom(options, name);
      signal.throwIfAborted();
      return removeEntryFile(file.path);
    },
  };
}
