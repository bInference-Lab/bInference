import { randomBytes } from "node:crypto";
import { basename, join } from "node:path";
import { BinferenceError, createIdSource, err, ok, type Result } from "@binference/core";
import type { BackupFailure, BackupKind, BackupRecord } from "@binference/engine/backups";
import type { InstallFacts } from "@binference/engine/install";
import {
  ensurePrivateFolder,
  fileSize,
  readFilePieces,
  removePath,
  writePrivateStream,
} from "@binference/platform";
import { backupFileName } from "./backup-file-name.js";
import type { BackupParts } from "./backup-parts.js";
import type { BackupsKept } from "./backup-retention.js";
import { gatherSources, type GatheredSources } from "./gather-sources.js";
import { pruneBackups } from "./prune-backups.js";
import { pruneReplaced } from "./state-swap.js";
import { verifyBackup } from "./verify-backup.js";
import { type BackupPlan, writeBackup } from "./write-backup.js";

/** One backup to take: its kind, what it says about the install, and where its copy goes. */
export interface BackupRun {
  readonly kind: BackupKind;
  /** The schema version `engine.sqlite` holds now: before a migration, the one it opened with. */
  readonly engineSchemaVersion: number;
  /** The shape of `config.json5`, its `version`. */
  readonly configVersion: number;
  /** `backups.copyTo`: the folder that gets a second copy, if any. */
  readonly copyTo?: string;
  readonly kept: BackupsKept;
  readonly signal: AbortSignal;
}

/** One backup under way: what it is taken with, and the record it becomes. */
interface Taking {
  readonly parts: BackupParts;
  readonly run: BackupRun;
  readonly facts: InstallFacts & { readonly custody: NonNullable<InstallFacts["custody"]> };
  readonly record: BackupRecord;
  readonly installId: Parameters<typeof backupFileName>[0]["installId"];
}

const failures: readonly BackupFailure[] = ["no_owner_key", "snapshot", "write", "check", "copy"];

function failed(failure: BackupFailure, options: ErrorOptions = {}): BinferenceError {
  return new BinferenceError({
    code: `backup.${failure}_failed`,
    message: `A backup stopped at its ${failure} step.`,
    ...options,
    details: { failure },
  });
}

// The failure a fault of a step names, if it came from one.
function namedFailure(error: Error): BackupFailure | undefined {
  const named = error instanceof BinferenceError ? error.details["failure"] : undefined;
  return failures.find((failure) => failure === named);
}

// Runs one step of a backup; any fault in it becomes the failure the notice names for that step.
async function step<Output>(failure: BackupFailure, work: () => Promise<Output>): Promise<Output> {
  try {
    return await work();
  } catch (error) {
    throw error instanceof Error && namedFailure(error) !== undefined
      ? error
      : failed(failure, { cause: error });
  }
}

async function freeTarget(taking: Omit<Taking, "record">, createdAtMs: number): Promise<string> {
  const folder = join(taking.parts.stateFolder.root, "backups");
  const named = { installId: taking.installId, createdAtMs, kind: taking.run.kind };
  for (let taken = 1; ; taken += 1) {
    const target = join(folder, backupFileName(named, taken));
    // oxlint-disable-next-line eslint/no-await-in-loop -- names are tried in order
    if (!(await fileSize(target, taking.run.signal)).ok) {
      return target;
    }
  }
}

function planOf(taking: Taking, sources: GatheredSources): BackupPlan {
  const { parts, run, facts, record } = taking;
  const { agentSchemaVersion } = sources;
  return {
    target: record.path,
    installId: taking.installId,
    createdAt: record.createdAtMs,
    kind: run.kind,
    binferenceVersion: parts.binferenceVersion,
    ownerKeyPublic: facts.custody.ownerKeyPublic,
    files: sources.files,
    schemaVersions: {
      engine: run.engineSchemaVersion,
      ...(agentSchemaVersion === undefined ? {} : { agent: agentSchemaVersion }),
      config: run.configVersion,
    },
    privy: {
      appId: facts.custody.appId,
      wallets: facts.wallets
        .filter((wallet) => wallet.archivedAtMs === undefined)
        .map((wallet) => wallet.custodyWalletId),
    },
  };
}

// Writes the file in a fresh work folder of snapshots, records it, and reads it back with the
// data key, which is zeroed once the check ends, whatever its outcome. JavaScript cannot promise
// that no copy of the key outlives this: OpenSSL's cipher contexts and freed buffers hold their
// own, until the garbage collector and the allocator reuse them.
async function writeAndCheck(taking: Taking): Promise<BackupRecord> {
  const { parts, run } = taking;
  const { signal } = run;
  const work = join(parts.stateFolder.root, "backups", `.taking-${randomBytes(8).toString("hex")}`);
  await step("write", async () =>
    ensurePrivateFolder(work, { permissions: parts.permissions, signal }),
  );
  try {
    const sources = await step("snapshot", async () => gatherSources(parts, work, signal));
    const plan = planOf(taking, sources);
    const written = await step("write", async () =>
      writeBackup(plan, { permissions: parts.permissions, signal }),
    );
    if (!written.ok) {
      throw failed("no_owner_key");
    }
    try {
      const { bytes, fileSha256, headerSha256 } = written.value;
      const record = { ...taking.record, bytes, fileSha256, headerSha256 };
      await step("write", async () => parts.backups.record(record, { signal }));
      const checked = await step("check", async () =>
        verifyBackup(record.path, written.value, signal),
      );
      if (!checked.ok) {
        await removePath(record.path, signal);
        await parts.backups.forget([record.id], { signal });
        throw failed("check");
      }
      return record;
    } finally {
      written.value.dataKey.fill(0);
    }
  } finally {
    await removePath(work, signal);
  }
}

async function copyTo(taking: Taking, record: BackupRecord): Promise<boolean> {
  const { run, parts } = taking;
  if (run.copyTo === undefined) {
    return true;
  }
  const options = { permissions: parts.permissions, signal: run.signal };
  try {
    await ensurePrivateFolder(run.copyTo, options);
    const pieces = readFilePieces(record.path, { signal: run.signal });
    await writePrivateStream(join(run.copyTo, basename(record.path)), pieces, options);
    return true;
  } catch (error) {
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    parts.logger.warn("backup.copy_failed", { errorCode });
    return false;
  }
}

// The states restores moved aside go once they are 7 days old; a failure is only logged.
async function pruneAside(parts: BackupParts, nowMs: number, signal: AbortSignal): Promise<void> {
  try {
    await pruneReplaced(parts.stateFolder, nowMs, signal);
  } catch (error) {
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    parts.logger.warn("backup.prune_failed", { errorCode });
  }
}

async function begin(parts: BackupParts, run: BackupRun): Promise<Taking | undefined> {
  const { signal } = run;
  const facts = await parts.install.read({ signal });
  const { custody } = facts;
  if (custody === undefined) {
    return undefined;
  }
  const ids = createIdSource({ clock: parts.clock, random: parts.random });
  const createdAtMs = parts.clock.now();
  const installId = await parts.install.installId(
    { id: ids.next("ins"), atMs: createdAtMs },
    { signal },
  );
  await ensurePrivateFolder(join(parts.stateFolder.root, "backups"), {
    permissions: parts.permissions,
    signal,
  });
  const named = { parts, run, facts: { ...facts, custody }, installId };
  const path = await freeTarget(named, createdAtMs);
  const record = { id: ids.next("bkp"), path, bytes: 0, kind: run.kind, createdAtMs };
  return { ...named, record };
}

/**
 * Takes one backup (keys spec, section 7): snapshots and files into an encrypted `.bnfbak` in the
 * state folder's `backups/`, recorded in `engine.sqlite`, read back and checked at once with its
 * data key, which is then zeroed; only then copied to `backups.copyTo` and marked verified. Then
 * retention removes what it no longer keeps. Needs no owner key: the install's public half seals
 * it. Answers the record, or the failure a notice names: an install with no owner key yet is
 * `no_owner_key`, and a copy that failed is `copy` though the backup itself is kept and verified.
 */
export async function takeBackup(
  parts: BackupParts,
  run: BackupRun,
): Promise<Result<BackupRecord, BackupFailure>> {
  const startedMs = parts.clock.now();
  try {
    const taking = await step("write", async () => begin(parts, run));
    if (taking === undefined) {
      return err("no_owner_key");
    }
    const record = await writeAndCheck(taking);
    const isCopied = await copyTo(taking, record);
    const verifiedAtMs = parts.clock.now();
    await step("write", async () =>
      parts.backups.markVerified({ id: record.id, atMs: verifiedAtMs }, { signal: run.signal }),
    );
    await pruneBackups(parts, run);
    await pruneAside(parts, verifiedAtMs, run.signal);
    parts.logger.info("backup.taken", { durationMs: parts.clock.now() - startedMs });
    return isCopied ? ok({ ...record, verifiedAtMs }) : err("copy");
  } catch (error) {
    if (!(error instanceof Error) || run.signal.aborted) {
      throw error;
    }
    const failure = namedFailure(error) ?? "write";
    const cause = error.cause instanceof BinferenceError ? error.cause.code : `backup.${failure}`;
    parts.logger.warn("backup.failed", { errorCode: cause });
    return err(failure);
  }
}
