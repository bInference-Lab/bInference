import { basename, dirname, resolve } from "node:path";
import { BinferenceError, type Secret, type SecretStore } from "@binference/core";
import { createFileSecretStore } from "@binference/platform";
import type { SecretSource } from "../config/schema/secret-source.schema.js";
import type { InitContext } from "../init/init-context.js";
import { takeSecret } from "../init/take-secret.js";

/** A secret config.json5 names: its key, its source and the question that asks for it. */
export interface HeldSecretSpec {
  /** The config key, such as `custody.privy.appSecret`. */
  readonly path: string;
  readonly source: SecretSource;
  readonly question: { readonly id: string; readonly message: string };
}

// Where a typed secret is kept so the source config.json5 names finds it: a keychain entry, or a
// file in this folder's `keys/`. Any other source is the owner's to fill.
function storeOf(
  context: InitContext,
  source: SecretSource,
): { readonly store: SecretStore; readonly name: string } | undefined {
  const { keychain, stateFolder, permissions } = context.platform;
  if ("fromKeychain" in source) {
    return { store: keychain, name: source.fromKeychain };
  }
  if ("fromFile" in source && dirname(resolve(source.fromFile)) === resolve(stateFolder.keys)) {
    const store = createFileSecretStore({ folder: stateFolder.keys, permissions });
    return { store, name: basename(source.fromFile) };
  }
  return undefined;
}

async function readSecret(context: InitContext, spec: HeldSecretSpec): Promise<Secret | undefined> {
  try {
    return await context.secrets.read(spec.path, spec.source, context.signal);
  } catch (error) {
    if (error instanceof BinferenceError && error.code === "config.secret_unavailable") {
      return undefined;
    }
    throw error;
  }
}

/**
 * A secret from the source config.json5 names, or typed by the person, hidden, and kept where that
 * source reads it: a keychain entry or a file in `keys/`. `undefined` when the source holds none
 * and nobody can fill it here: no person at the terminal, or a source of another kind.
 */
export async function heldSecret(
  context: InitContext,
  spec: HeldSecretSpec,
): Promise<Secret | undefined> {
  const held = await readSecret(context, spec);
  const place = storeOf(context, spec.source);
  if (held !== undefined || place === undefined || !context.isInteractive) {
    return held;
  }
  // A person answers here; the flag is never read, so no flag names the secret.
  const typed = await takeSecret(context, {
    flag: "",
    flagText: undefined,
    path: spec.path,
    question: spec.question,
  });
  if (!typed.ok) {
    return undefined;
  }
  await place.store.write(place.name, typed.value.value, context.signal);
  return typed.value.value;
}
