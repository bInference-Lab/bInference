import { homedir } from "node:os";
import { relative, isAbsolute } from "node:path";
import type { JsonValue } from "@binference/core";
import { fileSize, removePath } from "@binference/platform";
import { agentKeyEntry } from "@binference/signer";
import { platformOf } from "../compose/engine-locations.js";
import { loadConfig } from "../config/load-config.js";
import { asJson, isObject } from "../config/shown-config.js";
import { appSecretEntry, botTokenEntry } from "../init/secret-places.js";
import type { CliHost } from "../program/cli-host.js";
import { systemDefaults } from "../program/system-defaults.js";

/** What removing the state folder did, or why it did not. */
export type StateRemoval =
  | { readonly kind: "removed"; readonly keychain: readonly string[] }
  /** The folder is no state folder of binference, or holds the home folder: nothing was removed. */
  | { readonly kind: "not_state"; readonly folder: string };

// Every keychain entry a config names, in every secret source it holds.
function keychainNames(value: JsonValue): readonly string[] {
  if (Array.isArray(value)) {
    const items: readonly JsonValue[] = value;
    return items.flatMap(keychainNames);
  }
  if (!isObject(value)) {
    return [];
  }
  const named = value["fromKeychain"];
  return typeof named === "string" ? [named] : Object.values(value).flatMap(keychainNames);
}

// The keychain entries of this install: those its config names, and the agent key in the
// `keychain` unlock mode. A config that does not load names the entries init makes.
async function entriesOf(host: CliHost, signal: AbortSignal): Promise<readonly string[]> {
  const platform = platformOf(host);
  const loaded = await loadConfig({
    file: platform.stateFolder.configFile,
    env: host.env,
    sets: [],
    system: systemDefaults(host.env, platform),
    signal,
  });
  if (!loaded.ok) {
    return [agentKeyEntry, appSecretEntry, botTokenEntry];
  }
  const isKeychain = loaded.config.engine.unlock.mode === "keychain";
  const named = keychainNames(asJson(loaded.config));
  return [...new Set([...(isKeychain ? [agentKeyEntry] : []), ...named])];
}

// A folder binference may remove whole: it holds the config or the engine database, and it is
// neither the home folder nor a folder that holds it.
async function isStateFolder(host: CliHost, signal: AbortSignal): Promise<boolean> {
  const { stateFolder } = platformOf(host);
  const home = host.homeDir ?? homedir();
  const fromRoot = relative(stateFolder.root, home);
  const holdsHome = fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));
  if (holdsHome) {
    return false;
  }
  const marks = [stateFolder.configFile, stateFolder.engineDatabase];
  const found = await Promise.all(marks.map(async (file) => (await fileSize(file, signal)).ok));
  return found.includes(true);
}

/**
 * Removes the install's state folder and the OS keychain entries it named (keys spec, section 3),
 * with the engine stopped: the config, the databases, the keys, the logs and the backups kept in
 * it. A second copy in `backups.copyTo` stays; an entry the keychain does not answer for stays
 * too. A folder that holds no config and no engine
 * database, or holds the home folder, is never removed. Answers the keychain entries it removed.
 */
export async function removeState(host: CliHost, signal: AbortSignal): Promise<StateRemoval> {
  const { stateFolder, keychain } = platformOf(host);
  if (!(await isStateFolder(host, signal))) {
    return { kind: "not_state", folder: stateFolder.root };
  }
  // The entries are named before the folder goes, and removed after it, so a folder that could
  // not be removed keeps the keys that open it.
  const entries = await entriesOf(host, signal);
  await removePath(stateFolder.root, signal);
  const removed: string[] = [];
  for (const name of entries) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- the keychain answers one entry at a time
    const deleted = await keychain.delete(name, signal).catch(() => undefined);
    if (deleted?.ok === true) {
      removed.push(name);
    }
  }
  return { kind: "removed", keychain: removed };
}
