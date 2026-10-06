import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { z } from "zod";
import { migrationsRoot, type MigrationFolder, type StoreProblem } from "./migration-files.mjs";

/** Where the hashes of migrations live. An entry on the base branch is a released migration. */
export const lockPath = "packages/store/migrations.lock.json";

const lockSchema = z.strictObject({
  migrations: z.record(
    z.string().regex(/^[a-z0-9-]+\/\d{4}_[a-z0-9_]+\.ts$/),
    z.string().regex(/^[0-9a-f]{64}$/),
  ),
});

/** Per migration file, `database/NNNN_name.ts`, the SHA-256 of its text. */
export type MigrationLock = z.infer<typeof lockSchema>;

/** Parses the lock file's text; an absent file is an empty lock. */
export function parseLock(text: string | undefined): MigrationLock {
  const parsed = lockSchema.safeParse(text === undefined ? { migrations: {} } : JSON.parse(text));
  if (parsed.success) {
    return parsed.data;
  }
  throw new Error(`${lockPath} is not a migration lock:\n${z.prettifyError(parsed.error)}`);
}

// Line endings never count, so a Windows checkout hashes like any other.
function sha256(text: string): string {
  return createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex");
}

/** The current hash of every migration file, keyed as the lock keys them. */
export function migrationHashes(
  root: string,
  folders: readonly MigrationFolder[],
): ReadonlyMap<string, string> {
  return new Map(
    folders.flatMap((folder) =>
      folder.files.map((file): [string, string] => [
        `${folder.database}/${file}`,
        sha256(readFileSync(join(root, migrationsRoot, folder.database, file), "utf8")),
      ]),
    ),
  );
}

function fileProblems(
  hashes: ReadonlyMap<string, string>,
  lock: MigrationLock,
  base: MigrationLock,
): StoreProblem[] {
  return [...hashes].flatMap(([key, hash]) => {
    const where = posix.join(migrationsRoot, key);
    const released = base.migrations[key];
    if (released !== undefined && released !== hash) {
      return [
        {
          where,
          message: "this migration is released and never changes; write a new migration instead.",
        },
      ];
    }
    const locked = lock.migrations[key];
    if (locked === undefined) {
      return [{ where, message: `not locked; run pnpm check:store --write.` }];
    }
    return locked === hash
      ? []
      : [{ where, message: "changed since it was locked; run pnpm check:store --write." }];
  });
}

function entryProblems(
  hashes: ReadonlyMap<string, string>,
  lock: MigrationLock,
  base: MigrationLock,
): StoreProblem[] {
  const gone = Object.keys(lock.migrations)
    .filter((key) => !hashes.has(key))
    .map((key) => ({
      where: lockPath,
      message:
        base.migrations[key] === undefined
          ? `${key} is locked but missing; run pnpm check:store --write.`
          : `${key} is released, so it is never renamed or deleted.`,
    }));
  const changed = Object.entries(base.migrations)
    .filter(([key, hash]) => lock.migrations[key] !== hash)
    .map(([key]) => ({
      where: lockPath,
      message: `the entry for ${key} changed or went; released entries never change.`,
    }));
  return [...gone, ...changed];
}

/** Problems between the migration files, the lock, and the lock on the base branch. */
export function lockProblems(
  hashes: ReadonlyMap<string, string>,
  lock: MigrationLock,
  base: MigrationLock,
): readonly StoreProblem[] {
  return [...fileProblems(hashes, lock, base), ...entryProblems(hashes, lock, base)];
}

/** The lock with every unreleased file at its current hash; released entries stay as they are. */
export function withCurrentHashes(
  hashes: ReadonlyMap<string, string>,
  base: MigrationLock,
): MigrationLock {
  const entries = [...hashes].map(([key, hash]): [string, string] => [
    key,
    base.migrations[key] ?? hash,
  ]);
  const released = Object.entries(base.migrations).filter(([key]) => !hashes.has(key));
  return {
    migrations: Object.fromEntries(
      [...entries, ...released].toSorted(([a], [b]) => a.localeCompare(b)),
    ),
  };
}
