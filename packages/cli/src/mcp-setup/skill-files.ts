import { dirname, join } from "node:path";
import {
  ensurePrivateFolder,
  listFolderFiles,
  readTextFile,
  removePath,
  writePrivateFile,
} from "@binference/platform";
import { platformOf } from "../compose/engine-locations.js";
import type { BundledSkill } from "./bundled-skill.js";
import type { SetupChange, SetupRun } from "./setup-change.js";

async function isSame(folder: string, skill: BundledSkill, signal: AbortSignal): Promise<boolean> {
  const names = await listFolderFiles(folder, signal);
  if (names.join("\n") !== skill.files.map((file) => file.name).join("\n")) {
    return false;
  }
  const texts = await Promise.all(
    skill.files.map(async (file) => readTextFile(join(folder, file.name), signal)),
  );
  return texts.every((read, index) => read.ok && read.value === skill.files[index]?.text);
}

/**
 * Puts the bundled skill in the client's skills folder, replacing a copy that differs, so a second
 * run changes nothing. With `--dry-run` it only says what it would do.
 */
export async function installSkill(
  run: SetupRun,
  skill: BundledSkill,
  folder: string,
): Promise<SetupChange> {
  const { signal } = run;
  const isNew = (await listFolderFiles(folder, signal)).length === 0;
  if (!isNew && (await isSame(folder, skill, signal))) {
    return { part: "skill", action: "unchanged", path: folder };
  }
  if (!run.isDryRun) {
    const files = { permissions: platformOf(run.host).permissions, signal };
    await removePath(folder, signal);
    const folders = [...new Set(skill.files.map((file) => dirname(join(folder, file.name))))];
    await Promise.all(folders.map(async (path) => ensurePrivateFolder(path, files)));
    await Promise.all(
      skill.files.map(async (file) => writePrivateFile(join(folder, file.name), file.text, files)),
    );
  }
  return { part: "skill", action: isNew ? "created" : "updated", path: folder };
}

/** Removes the skill's folder from the client's skills folder. */
export async function removeSkill(run: SetupRun, folder: string): Promise<SetupChange> {
  const isThere = (await listFolderFiles(folder, run.signal)).length > 0;
  if (isThere && !run.isDryRun) {
    await removePath(folder, run.signal);
  }
  return { part: "skill", action: isThere ? "removed" : "absent", path: folder };
}
