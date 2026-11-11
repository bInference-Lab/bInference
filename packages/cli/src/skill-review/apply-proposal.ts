import { dirname, join } from "node:path";
import { BinferenceError, err, ok, type Random, type Result } from "@binference/core";
import {
  ensurePrivateFolder,
  type FilePermissions,
  listFolderFiles,
  movePath,
  removePath,
  writePrivateFile,
} from "@binference/platform";
import type { AcceptedSkills } from "../skills/accepted-skills.js";
import { skillLimits } from "../skills/fetch-skill.js";
import { skillFolderHash } from "../skills/skill-folder-hash.js";
import { readSkillBytes, type SkillFolder, skillFolderUnder } from "../skills/skill-folder.js";
import type { SkillShelf } from "../skills/skill-shelf.js";
import type { ProposalRecord } from "./proposal-record.js";

/** What an apply reads and writes. */
export interface ApplyParts {
  /** The state folder's `workspace/`. */
  readonly workspace: string;
  /** The state folder's `skill-review/`, where an apply builds the skill's folder first. */
  readonly review: string;
  readonly shelf: Pick<SkillShelf, "list" | "waiting">;
  readonly accepted: Pick<AcceptedSkills, "accept">;
  readonly permissions: FilePermissions;
  readonly random: Random;
}

/** The folder hashes an apply moved the skill between: none before for a new skill. */
export interface Applied {
  readonly before?: string;
  readonly after: string;
}

/** A file to write: its path inside the skill's folder and its bytes or text. */
interface FileToWrite {
  readonly path: string;
  readonly data: string | Uint8Array;
}

async function writeAll(
  folder: string,
  files: readonly FileToWrite[],
  options: { readonly permissions: FilePermissions; readonly signal: AbortSignal },
): Promise<void> {
  await ensurePrivateFolder(folder, options);
  for (const file of files) {
    const path = join(folder, file.path);
    // oxlint-disable-next-line eslint/no-await-in-loop -- one file after another keeps the order of the writes
    await ensurePrivateFolder(dirname(path), options);
    // oxlint-disable-next-line eslint/no-await-in-loop -- as above
    await writePrivateFile(path, file.data, options);
  }
}

// The skill's files as they are now, each read whole inside the folder's real path, within a
// skill's size; a file that led elsewhere is left out, so the copy no longer hashes as the base.
async function filesOf(skill: SkillFolder, signal: AbortSignal): Promise<readonly FileToWrite[]> {
  const files: FileToWrite[] = [];
  let room = skillLimits.bytes;
  for (const path of await listFolderFiles(skill.folder, signal)) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one file after another bounds the bytes read
    const read = await readSkillBytes(skill, path, { maxBytes: room, signal });
    if (read.ok) {
      room -= read.value.byteLength;
      files.push({ path, data: read.value });
    }
  }
  return files;
}

// Whether the skill the proposal is made on is still as it was: for a change, its files copied
// into the work folder hash as the proposal's base; for a new skill, no skill holds the name.
async function standsAsProposed(
  parts: ApplyParts,
  record: ProposalRecord,
  place: { readonly target: SkillFolder; readonly work: SkillFolder; readonly signal: AbortSignal },
): Promise<boolean> {
  const { target, work, signal } = place;
  const options = { permissions: parts.permissions, signal };
  if (record.base !== undefined) {
    await writeAll(work.folder, await filesOf(target, signal), options);
    return (await skillFolderHash(work, signal)) === record.base.hash;
  }
  const names = [
    ...(await parts.shelf.list(record.agent, signal)),
    ...(await parts.shelf.waiting(record.agent, signal)),
  ].map(({ name }) => name);
  return (
    !names.includes(record.name) && (await listFolderFiles(target.folder, signal)).length === 0
  );
}

// Puts the work folder in place of the skill's folder, the old one moved aside and removed.
async function putInPlace(
  place: { readonly target: string; readonly work: string; readonly aside: string },
  options: { readonly permissions: FilePermissions; readonly signal: AbortSignal },
): Promise<void> {
  await ensurePrivateFolder(dirname(place.target), options);
  await movePath(place.target, place.aside, options.signal);
  await movePath(place.work, place.target, options.signal);
}

/**
 * Applies a skill proposal (decision 0408): builds the skill's folder in `skill-review/` from the
 * skill as it is now, which for a change must hash as the proposal's base, and for a new skill must
 * not exist; writes the proposal's `SKILL.md` and support files over it; puts it in place of the
 * agent's workspace skill; and accepts its new folder hash, so the skill loads from the agent's
 * next turn. Built where the agent's tools cannot reach, the folder the owner accepts is the one
 * binference wrote. A skill that moved is `stale`, and nothing changes.
 */
export async function applyProposal(
  parts: ApplyParts,
  record: ProposalRecord,
  signal: AbortSignal,
): Promise<Result<Applied, "stale">> {
  const hex = Buffer.from(parts.random.bytes(8)).toString("hex");
  const work = await skillFolderUnder(parts.review, join("work", `apply-${hex}`), signal);
  const aside = join(parts.review, "work", `old-${hex}`);
  const target = await skillFolderUnder(
    parts.workspace,
    join(record.agent, "skills", record.name),
    signal,
  );
  const options = { permissions: parts.permissions, signal };
  try {
    if (!(await standsAsProposed(parts, record, { target, work, signal }))) {
      return err("stale");
    }
    const support = record.supportFiles.map(({ path, text }) => ({ path, data: text }));
    await writeAll(work.folder, [{ path: "SKILL.md", data: record.text }, ...support], options);
    const after = await skillFolderHash(work, signal);
    if (after === undefined) {
      throw new BinferenceError({
        code: "skill.invalid",
        message: "The applied skill's folder is over a skill's size; nothing was put in place.",
      });
    }
    await putInPlace({ target: target.folder, work: work.folder, aside }, options);
    const before = await parts.accepted.accept(
      { agent: record.agent, name: record.name, hash: after },
      signal,
    );
    return ok(before === undefined ? { after } : { before, after });
  } finally {
    // The work folders go even when the apply was stopped.
    await removePath(work.folder, AbortSignal.timeout(30_000));
    await removePath(aside, AbortSignal.timeout(30_000));
  }
}
