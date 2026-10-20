import { homedir } from "node:os";
import { basename, isAbsolute, relative } from "node:path";
import type { JsonValue } from "@binference/core";
import { fileSize, removePath } from "@binference/platform";
import { agentKeyEntry } from "@binference/signer";
import { platformOf } from "../compose/engine-locations.js";
import { loadConfig } from "../config/load-config.js";
import { asJson, isObject } from "../config/shown-config.js";
import { appSecretEntry, botTokenEntry } from "../init/secret-places.js";
import type { CliHost } from "../program/cli-host.js";
import { systemDefaults } from "../program/system-defaults.js";

/**
 * Where the agent key is once the state folder is gone: it went with the folder (`file` and
 * `manual` modes), out of the OS keychain, still in the keychain because it did not answer, or
 * still where the `command` mode's program reads it, named by the program alone; `unknown` when
 * the config did not load to say the mode.
 */
export type AgentKeyLeft =
  | { readonly kind: "in_folder" | "keychain_removed" | "keychain_left" | "unknown" }
  | { readonly kind: "command"; readonly program: string };

/** What removing the state folder did, or why it did not. */
export type StateRemoval =
  | {
      readonly kind: "removed";
      readonly keychain: readonly string[];
      readonly agentKey: AgentKeyLeft;
    }
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

/** The keychain entries of an install, and where its unlock mode keeps the agent key. */
interface InstallKeys {
  readonly entries: readonly string[];
  readonly agentKey: "folder" | "keychain" | "unknown" | { readonly program: string };
}

// The keychain entries of this install: those its config names, and the agent key in the
// `keychain` unlock mode. A config that does not load names the entries init makes.
async function keysOf(host: CliHost, signal: AbortSignal): Promise<InstallKeys> {
  const platform = platformOf(host);
  const loaded = await loadConfig({
    file: platform.stateFolder.configFile,
    env: host.env,
    sets: [],
    system: systemDefaults(host.env, platform),
    signal,
  });
  if (!loaded.ok) {
    return { entries: [agentKeyEntry, appSecretEntry, botTokenEntry], agentKey: "unknown" };
  }
  const { mode, command } = loaded.config.engine.unlock;
  const named = keychainNames(asJson(loaded.config));
  if (mode === "keychain") {
    return { entries: [...new Set([agentKeyEntry, ...named])], agentKey: "keychain" };
  }
  const [program] = command?.fromCommand ?? [];
  const agentKey = mode === "command" ? { program: basename(program ?? "") } : "folder";
  return { entries: named, agentKey };
}

// Where the agent key is after the keychain entries went, by where the mode kept it.
function agentKeyLeft(keys: InstallKeys, failed: ReadonlySet<string>): AgentKeyLeft {
  if (keys.agentKey === "folder" || keys.agentKey === "unknown") {
    return { kind: keys.agentKey === "folder" ? "in_folder" : "unknown" };
  }
  if (keys.agentKey === "keychain") {
    return { kind: failed.has(agentKeyEntry) ? "keychain_left" : "keychain_removed" };
  }
  return { kind: "command", program: keys.agentKey.program };
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
 * too. A folder that holds no config and no engine database, or holds the home folder, is never
 * removed. Answers the keychain entries it removed and where the agent key is now.
 */
export async function removeState(host: CliHost, signal: AbortSignal): Promise<StateRemoval> {
  const { stateFolder, keychain } = platformOf(host);
  if (!(await isStateFolder(host, signal))) {
    return { kind: "not_state", folder: stateFolder.root };
  }
  // The entries are named before the folder goes, and removed after it, so a folder that could
  // not be removed keeps the keys that open it.
  const keys = await keysOf(host, signal);
  await removePath(stateFolder.root, signal);
  const removed: string[] = [];
  const failed = new Set<string>();
  for (const name of keys.entries) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- the keychain answers one entry at a time
    const deleted = await keychain.delete(name, signal).catch(() => undefined);
    if (deleted === undefined) {
      failed.add(name);
    } else if (deleted.ok) {
      removed.push(name);
    }
  }
  return { kind: "removed", keychain: removed, agentKey: agentKeyLeft(keys, failed) };
}
