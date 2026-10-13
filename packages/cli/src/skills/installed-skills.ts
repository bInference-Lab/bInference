import { join } from "node:path";
import type { FilePermissions } from "@binference/platform";
import { readTextFile, writePrivateFile } from "@binference/platform";
import { z } from "zod";

/** Where an installed skill came from, and when (decision 0207). */
interface InstalledSkill {
  /** `git:<url>` or `npm:<name>@<version>`, with `#<folder>` when the skill sat below the top. */
  readonly source: string;
  /** The commit id or the published integrity the install checked. */
  readonly hash: string;
  readonly installedAt: number;
}

/** The record of the installed skills, by name. */
export type InstalledSkills = ReadonlyMap<string, InstalledSkill>;

/** The record's file in the installed skills' folder. */
const installedRecordName = "installed.json";

const recordSchema = z.object({
  skills: z.record(
    z.string(),
    z.object({ source: z.string(), hash: z.string(), installedAt: z.int().nonnegative() }),
  ),
});

function parsed(text: string): InstalledSkills {
  try {
    const record = recordSchema.safeParse(JSON.parse(text));
    return new Map(record.success ? Object.entries(record.data.skills) : []);
  } catch {
    return new Map();
  }
}

/**
 * Reads the record of the installed skills from their folder. A missing or unreadable record holds
 * none, so a skill whose record is gone is left out rather than trusted.
 */
export async function readInstalledSkills(
  folder: string,
  signal: AbortSignal,
): Promise<InstalledSkills> {
  const read = await readTextFile(join(folder, installedRecordName), signal);
  return read.ok ? parsed(read.value) : new Map();
}

/** Writes the record of the installed skills in place of the one there, owner-only. */
export async function writeInstalledSkills(
  folder: string,
  skills: InstalledSkills,
  options: { readonly permissions: FilePermissions; readonly signal: AbortSignal },
): Promise<void> {
  const entries = [...skills.entries()].toSorted(([one], [two]) => one.localeCompare(two));
  const text = `${JSON.stringify({ skills: Object.fromEntries(entries) }, undefined, 2)}\n`;
  await writePrivateFile(join(folder, installedRecordName), text, options);
}
