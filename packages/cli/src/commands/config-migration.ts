import { ok } from "@binference/core";
import { acquireFileLock, fileSize, readTextFile, writePrivateFile } from "@binference/platform";
import { engineWorker } from "@binference/store";
import { readConfigText } from "../config/config-text.js";
import { editJson5Text } from "../config/json5-edit.js";
import { loadConfig } from "../config/load-config.js";
import type { ConfigEdit } from "../config/migrations/config-edit.js";
import { configMigrations, currentConfigVersion } from "../config/migrations/config-migrations.js";
import { fileVersion, migrateConfig } from "../config/migrations/migrate-config.js";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import { systemDefaults } from "../program/system-defaults.js";
import { backUpStoppedState, openStateLog, openStoppedDatabase } from "../state/stopped-state.js";
import type { CheckFinding } from "./check-finding.js";
import { type ConfigCheck, configFinding, type InstallCheck } from "./install-findings.js";

/** Why `check --fix` left an older `config.json5` as it was. */
type ConfigUnmoved = "engine_running" | "uneditable" | "invalid" | "unreadable" | "backup_failed";

/** How moving an older `config.json5` to this binference's version went. */
type ConfigMove =
  | { readonly kind: "current" }
  | { readonly kind: "moved"; readonly from: number; readonly to: number; readonly backup: string }
  | { readonly kind: "unmoved"; readonly from: number; readonly reason: ConfigUnmoved };

// The file as it reads: its text, its object and its version, when it is older than this build's.
async function olderFile(check: InstallCheck) {
  const read = await readTextFile(check.platform.stateFolder.configFile, check.signal);
  const parsed = read.ok ? readConfigText(read.value) : undefined;
  if (!read.ok || parsed?.ok !== true) {
    return undefined;
  }
  const version = fileVersion(parsed.value);
  return version !== undefined && version < currentConfigVersion
    ? { text: read.value, file: parsed.value, version }
    : undefined;
}

// The sealed `before_migration` backup of the stopped state (keys spec, section 7.3), through
// `engine.sqlite` at any schema this build reads; none before the first start made the database.
// An install with no owner key yet has nothing to seal, as at a start's own migration.
async function backUpFirst(
  check: InstallCheck,
  config: BinferenceConfig,
): Promise<{ readonly backup: string } | { readonly reason: ConfigUnmoved }> {
  const { host, platform, signal } = check;
  const file = platform.stateFolder.engineDatabase;
  if (!(await fileSize(file, signal)).ok) {
    return { backup: "" };
  }
  const run = { host, config, signal };
  const engine = await openStoppedDatabase(run, file, engineWorker).catch(() => undefined);
  if (engine === undefined) {
    return { reason: "unreadable" };
  }
  const logger = await openStateLog(run);
  try {
    const taken = await backUpStoppedState(run, { engine, kind: "before_migration" }, logger);
    if (taken.ok) {
      return { backup: taken.value.id };
    }
    const isSkipped = taken.error === "no_owner_key" || taken.error === "copy";
    return isSkipped ? { backup: "" } : { reason: "backup_failed" };
  } finally {
    await engine.close();
    await logger.close();
  }
}

// Moves the file under the engine lock, so no engine starts on it half way.
async function moveLocked(
  check: InstallCheck,
  older: NonNullable<Awaited<ReturnType<typeof olderFile>>>,
): Promise<ConfigMove> {
  const { host, platform, signal } = check;
  const unmoved = (reason: ConfigUnmoved): ConfigMove => ({
    kind: "unmoved",
    from: older.version,
    reason,
  });
  const migrated = migrateConfig(older.file, configMigrations);
  const edits = migrated.ok ? migrated.steps.flatMap((step) => step.edits) : [];
  const version: ConfigEdit = { kind: "set", path: ["version"], value: currentConfigVersion };
  const versioned = [...edits, version];
  const text = migrated.ok ? editJson5Text(older.text, versioned) : undefined;
  if (text === undefined) {
    return unmoved("uneditable");
  }
  const file = platform.stateFolder.configFile;
  const system = systemDefaults(host.env, platform);
  const readFile = async () => Promise.resolve(ok(text));
  const loaded = await loadConfig({ file, env: host.env, sets: [], system, signal, readFile });
  if (!loaded.ok) {
    return unmoved("invalid");
  }
  const backedUp = await backUpFirst(check, loaded.config);
  if ("reason" in backedUp) {
    return unmoved(backedUp.reason);
  }
  await writePrivateFile(file, text, { permissions: platform.permissions, signal });
  return { kind: "moved", from: older.version, to: currentConfigVersion, ...backedUp };
}

/**
 * Moves an older `config.json5` to this binference's version (config spec, section 4): every
 * config migration from its version runs in order, edited in place so comments and key order stay,
 * and the result must load before anything is written. A sealed `before_migration` backup of the
 * stopped state comes first, as before a database migration; the move runs under the engine lock
 * and is refused while an engine runs. A file of this version, or one that does not read, is left
 * to the `config.valid` finding.
 */
async function moveConfigFile(check: InstallCheck): Promise<ConfigMove> {
  const older = await olderFile(check);
  if (older === undefined) {
    return { kind: "current" };
  }
  const lock = acquireFileLock(check.platform.stateFolder.engineLock);
  if (!lock.ok) {
    return { kind: "unmoved", from: older.version, reason: "engine_running" };
  }
  try {
    return await moveLocked(check, older);
  } finally {
    lock.value.release();
  }
}

function withMore(finding: CheckFinding, more: CheckFinding["more"]): CheckFinding {
  return { ...finding, more: [...(finding.more ?? []), ...(more ?? [])] };
}

/**
 * `config.valid` as `check --fix` finds it: an older `config.json5` is moved to this version
 * first, and the finding says so, or says why it stayed.
 */
export async function fixedConfigFinding(check: InstallCheck): Promise<ConfigCheck> {
  const move = await moveConfigFile(check);
  const found = await configFinding(check);
  if (move.kind === "current") {
    return found;
  }
  if (move.kind === "unmoved") {
    const why = { key: "check.configUnmoved", values: { from: move.from, reason: move.reason } };
    return { ...found, finding: withMore(found.finding, [why]) };
  }
  const values = {
    from: move.from,
    to: move.to,
    backup: move.backup === "" ? "none" : move.backup,
  };
  return { ...found, finding: { ...found.finding, fixed: { key: "check.configMoved", values } } };
}
