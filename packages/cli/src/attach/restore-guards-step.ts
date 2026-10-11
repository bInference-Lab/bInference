import { join } from "node:path";
import { BinferenceError, type Secret } from "@binference/core";
import {
  type InstallGuards,
  type RestoreChanges,
  restoreChanges,
  type StricterAgent,
} from "@binference/engine/backups";
import { fileSize } from "@binference/platform";
import { parseOwnerKeyCode } from "@binference/signer";
import {
  createRestoreGuards,
  createSqliteInstallStore,
  engineWorker,
  openDatabase,
} from "@binference/store";
import { deriveSealingKey } from "../hpke/sealing-key.js";
import { type InitContext, type InitStep, refused } from "../init/init-context.js";

/**
 * The state a restore replaces, as it reads: its guards, none when the folder holds no install,
 * or `unreadable` when its `engine.sqlite` does not open, such as a damaged one.
 */
export type ReplacedState =
  | { readonly kind: "guards"; readonly guards: InstallGuards }
  | { readonly kind: "none" }
  | { readonly kind: "unreadable" };

async function withDatabase<T>(
  context: InitContext,
  file: string,
  use: (database: Awaited<ReturnType<typeof openDatabase>>) => Promise<T>,
): Promise<T> {
  const database = await openDatabase({
    file,
    worker: engineWorker,
    readers: 0,
    execArgv: context.host.workerExecArgv ?? [],
    signal: context.signal,
  });
  try {
    return await use(database);
  } finally {
    await database.close();
  }
}

/**
 * Reads the guards of the state a restore replaces from the state folder's `engine.sqlite`, which
 * may be open in a running engine: SQLite lets this read beside it. A database of an older schema
 * than this binference is refused: start binference once, then restore. One that does not open is
 * `unreadable`; nothing is ever written to it.
 */
export async function readReplaced(context: InitContext): Promise<InitStep<ReplacedState>> {
  const file = context.platform.stateFolder.engineDatabase;
  if (!(await fileSize(file, context.signal)).ok) {
    return { ok: true, value: { kind: "none" } };
  }
  try {
    return await withDatabase(context, file, async (database) => {
      if (database.schemaVersion !== database.latestVersion) {
        return refused("backup.restore_replaced_older", "refused.restoreReplacedOlder");
      }
      const guards = await createRestoreGuards(database).read(context.host.clock.now(), context);
      return { ok: true, value: { kind: "guards", guards } };
    });
  } catch (error) {
    if (error instanceof BinferenceError && error.code.startsWith("store.")) {
      return { ok: true, value: { kind: "unreadable" } };
    }
    throw error;
  }
}

/** The guards of the restored `engine.sqlite` in `unpacked`, migrated to this build first. */
export async function readRestored(context: InitContext, unpacked: string): Promise<InstallGuards> {
  return withDatabase(context, join(unpacked, "engine.sqlite"), async (database) => {
    await database.migrate(context);
    return createRestoreGuards(database).read(context.host.clock.now(), context);
  });
}

// Keeps the sealing key the owner key derives in the restored copy, when its custody has none.
async function keepSealKey(
  install: ReturnType<typeof createSqliteInstallStore>,
  ownerKey: Secret,
  signal: AbortSignal,
): Promise<void> {
  const { custody } = await install.read({ signal });
  const pair = parseOwnerKeyCode(ownerKey);
  if (custody === undefined || custody.sealKeyPublic !== undefined || !pair.ok) {
    return;
  }
  const sealing = deriveSealingKey(pair.value.privateKey);
  await install.setSealKey({ sealKeyPublic: sealing.publicKey }, { signal });
}

/**
 * Readies the restored `engine.sqlite` in `unpacked` (keys spec, section 7.4), with no engine
 * running on the state folder: it carries in the guards of the state the restore replaces, read
 * again as the engine left it, in one transaction, and keeps the sealing key the owner key derives
 * when the restored custody has none, so the next backups are sealed to it. A state the preview
 * found unreadable carries nothing; one that read then and does not now throws, and nothing moved.
 */
export async function carryReplaced(
  context: InitContext,
  carry: {
    readonly unpacked: string;
    readonly replaced: ReplacedState["kind"];
    readonly ownerKey: Secret;
  },
): Promise<void> {
  const read = carry.replaced === "guards" ? await readReplaced(context) : undefined;
  if (read !== undefined && (!read.ok || read.value.kind !== "guards")) {
    throw new BinferenceError({
      code: "backup.restore_replaced_changed",
      message: "The state the restore replaces no longer reads as it did before the stop.",
    });
  }
  const guards = read?.ok === true && read.value.kind === "guards" ? read.value.guards : undefined;
  await withDatabase(context, join(carry.unpacked, "engine.sqlite"), async (database) => {
    await database.migrate(context);
    if (guards !== undefined) {
      await createRestoreGuards(database).carry(guards, context.host.clock.now(), context);
    }
    await keepSealKey(createSqliteInstallStore(database), carry.ownerKey, context.signal);
  });
}

function stricterLine(context: InitContext, agent: StricterAgent): string {
  const items = [
    ...agent.guards.map((guard) => context.words("restore.changes.guard", { guard })),
    ...agent.limits.map((field) => context.message("limit.name", { field })),
  ];
  return context.words("restore.changes.stricter", { agent: agent.name, items: items.join(", ") });
}

function changeLines(context: InitContext, changes: RestoreChanges, sinceMs: number): string[] {
  const { words, dateTime } = context;
  const since = dateTime(sinceMs);
  const last = changes.lastActivityAtMs;
  return [
    words("restore.changes.kept"),
    last === undefined || last <= sinceMs
      ? words("restore.changes.historyNone", { since })
      : words("restore.changes.history", { since, last: dateTime(last) }),
    ...changes.agentsGone.map((name) => words("restore.changes.agentGone", { name })),
    ...changes.agentsBack.map((name) => words("restore.changes.agentBack", { name })),
    ...changes.walletsGone.map(({ label, address }) =>
      words("restore.changes.walletGone", { label, address }),
    ),
    ...changes.walletsBack.map(({ label, address }) =>
      words("restore.changes.walletBack", { label, address }),
    ),
    ...(changes.isFrozen ? [words("restore.changes.frozen")] : []),
    ...changes.stricter.map((agent) => stricterLine(context, agent)),
  ];
}

/** The day a backup was taken as the owner types it to confirm: `yyyy-mm-dd`, in UTC. */
export function backupDay(createdAtMs: number): string {
  return new Date(createdAtMs).toISOString().slice(0, 10);
}

/** What the owner sees before a restore: the backup, and the state it replaces. */
export interface RestorePreview {
  readonly createdAtMs: number;
  readonly replaced: ReplacedState;
  /** The restored copy's guards; absent when there is no state to compare it with. */
  readonly restored?: InstallGuards;
}

/**
 * Shows the owner, before anything moves, what the restore changes (keys spec, section 7.4): what
 * it keeps as it is now, where the history ends, the agents and wallets that come or go, and the
 * backup's stricter guards that stay. The owner goes on by typing the backup's day; anything else
 * is refused and changes nothing.
 */
export async function confirmRestore(
  context: InitContext,
  preview: RestorePreview,
): Promise<InitStep<void>> {
  const { replaced, restored, createdAtMs } = preview;
  const lines: string[] = [];
  if (replaced.kind === "unreadable") {
    lines.push(context.words("restore.changes.unreadable"));
  }
  if (replaced.kind === "guards" && restored !== undefined) {
    const changes = restoreChanges(replaced.guards, restored, context.host.clock.now());
    lines.push(...changeLines(context, changes, createdAtMs));
  }
  const day = backupDay(createdAtMs);
  if (lines.length > 0) {
    context.prompter.note(lines.join("\n"), context.words("restore.changes.title"));
  }
  const typed = await context.prompter.ask({
    id: "restoreConfirm",
    message: context.words("restore.confirm", { day, when: context.dateTime(createdAtMs) }),
  });
  return typed.trim() === day
    ? { ok: true, value: undefined }
    : refused("backup.restore_not_confirmed", "refused.restoreNotConfirmed", { day });
}
