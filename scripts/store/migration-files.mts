import { readFileSync } from "node:fs";
import { join, posix } from "node:path";

/** A check:store finding: where, and what to do. */
export interface StoreProblem {
  readonly where: string;
  readonly message: string;
}

/** The folder whose subfolders hold each database's migrations. */
export const migrationsRoot = "packages/store/src/migrations";

const migrationName = /^(\d{4})_[a-z0-9]+(?:_[a-z0-9]+)*\.ts$/;
const registryImport = /from\s+["']\.\/(\d{4}_[^"']*)\.js["']/g;

/** One database's migration folder: its files, by name, and its registry file. */
export interface MigrationFolder {
  readonly database: string;
  readonly files: readonly string[];
}

/** The migration files of each database folder, from the repo's file list, sorted by name. */
export function migrationFolders(files: readonly string[]): readonly MigrationFolder[] {
  const byDatabase = new Map<string, string[]>();
  for (const file of files) {
    const parts = file.split("/");
    const name = parts.at(-1) ?? "";
    if (
      file.startsWith(`${migrationsRoot}/`) &&
      parts.length === 6 &&
      /^\d/.test(name) &&
      !name.endsWith(".test.ts")
    ) {
      const database = parts[4] ?? "";
      byDatabase.set(database, [...(byDatabase.get(database) ?? []), name]);
    }
  }
  return [...byDatabase]
    .map(([database, names]) => ({ database, files: names.toSorted() }))
    .toSorted((a, b) => a.database.localeCompare(b.database));
}

function nameProblems(folder: MigrationFolder): StoreProblem[] {
  return folder.files.flatMap((file, index) => {
    const where = posix.join(migrationsRoot, folder.database, file);
    const match = migrationName.exec(file);
    if (match === null) {
      return [{ where, message: "name a migration NNNN_name.ts, its name in snake_case." }];
    }
    const expected = String(index + 1).padStart(4, "0");
    return match[1] === expected
      ? []
      : [
          {
            where,
            message: `migrations are numbered from 0001 with no gap; this one should be ${expected}.`,
          },
        ];
  });
}

function contentProblems(root: string, folder: MigrationFolder): StoreProblem[] {
  return folder.files.flatMap((file) => {
    const where = posix.join(migrationsRoot, folder.database, file);
    const text = readFileSync(join(root, where), "utf8");
    const name = file.replace(/\.ts$/, "");
    return text.includes(`name: "${name}"`)
      ? []
      : [{ where, message: `its migration's name must be "${name}", the file's name.` }];
  });
}

function registryProblems(root: string, folder: MigrationFolder): StoreProblem[] {
  const where = posix.join(migrationsRoot, folder.database, `${folder.database}-migrations.ts`);
  let text: string;
  try {
    text = readFileSync(join(root, where), "utf8");
  } catch {
    return [{ where, message: "each migration folder has a registry that lists its migrations." }];
  }
  const listed = [...text.matchAll(registryImport)].map((match) => `${match[1] ?? ""}.ts`);
  return listed.join(",") === folder.files.join(",")
    ? []
    : [
        {
          where,
          message: `import every migration of ${folder.database}, in order: ${folder.files.join(", ")}.`,
        },
      ];
}

// The suffix of the folder that holds a database's migrations in their Postgres form.
const postgresForm = "-postgres";

// Every SQLite migration has its Postgres form under the same file name, and every Postgres form
// mirrors a SQLite migration; a folder of Postgres forms with no SQLite twin, such as the shared
// schema's, stands alone.
function postgresFormProblems(folders: readonly MigrationFolder[]): StoreProblem[] {
  const byName = new Map(folders.map((folder) => [folder.database, folder.files]));
  return folders
    .filter((folder) => !folder.database.endsWith(postgresForm))
    .flatMap((folder) => {
      const twin = `${folder.database}${postgresForm}`;
      const forms = new Set(byName.get(twin) ?? []);
      const sqlite = new Set(folder.files);
      const missing = folder.files
        .filter((file) => !forms.has(file))
        .map((file) => ({
          where: posix.join(migrationsRoot, folder.database, file),
          message: `write its Postgres form, ${posix.join(migrationsRoot, twin, file)}, in the same change.`,
        }));
      const extra = [...forms]
        .filter((file) => !sqlite.has(file))
        .map((file) => ({
          where: posix.join(migrationsRoot, twin, file),
          message: `no SQLite migration ${posix.join(migrationsRoot, folder.database, file)} has this form; give it the same number and name.`,
        }));
      return missing.concat(extra);
    });
}

/**
 * Names, numbering, each file's declared name, each registry's order, and a Postgres form for every
 * SQLite migration.
 */
export function migrationProblems(
  root: string,
  folders: readonly MigrationFolder[],
): readonly StoreProblem[] {
  return [
    ...folders.flatMap((folder) => [
      ...nameProblems(folder),
      ...contentProblems(root, folder),
      ...registryProblems(root, folder),
    ]),
    ...postgresFormProblems(folders),
  ];
}
