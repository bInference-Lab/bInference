import { basename, dirname, join } from "node:path";
import {
  ensurePrivateFolder,
  type FilePermissions,
  movePath,
  type RealPathStep,
  realPathOf,
} from "@binference/platform";
import type { SkillFolder } from "../skills/skill-folder.js";

/** Where an applied skill goes, and the apply's own folders in `skill-review/`. */
export interface SkillPlacement {
  /** The skill's folder in the agent's skills folder, with its real path from the workspace. */
  readonly target: SkillFolder;
  /** The folder the apply built. */
  readonly work: string;
  /** Where the skill's old folder goes. */
  readonly aside: string;
  /** The apply's random tag, which names each step's passing folder. */
  readonly tag: string;
}

/** What a placement takes besides its folders. */
export interface PlacementOptions {
  readonly permissions: FilePermissions;
  readonly signal: AbortSignal;
  /** The platform's real-path step unless a test passes its own. */
  readonly realPath?: RealPathStep;
}

/** A placement's folders as the moves use them: the skills folder, its judged real path, a name. */
interface Places {
  readonly skills: string;
  readonly judged: string;
  readonly name: string;
}

function placesOf(placement: SkillPlacement): Places {
  const { folder, realFolder } = placement.target;
  return { skills: dirname(folder), judged: dirname(realFolder), name: basename(folder) };
}

async function realOf(options: PlacementOptions, path: string): Promise<string | undefined> {
  return (options.realPath ?? realPathOf)(path, options.signal);
}

// Whether the skills folder is the one judged, before and after it is made: a folder that leads
// elsewhere already is never made through or restricted.
async function holdsJudged(places: Places, options: PlacementOptions): Promise<boolean> {
  const before = await realOf(options, places.skills);
  if (before !== undefined && before !== places.judged) {
    return false;
  }
  await ensurePrivateFolder(places.skills, options);
  return (await realOf(options, places.skills)) === places.judged;
}

// Moves the old skill out to `aside` only from the folder judged. It is renamed in its folder
// first, under a name only this step uses, and that folder is checked after the step: one that
// led elsewhere gets the entry back, by the real path of the folder it went to.
async function moveOut(
  placement: SkillPlacement,
  places: Places,
  options: PlacementOptions,
): Promise<"moved" | "none" | "refused"> {
  const passing = `${places.name}.${placement.tag}.out`;
  const step = await movePath(
    join(places.skills, places.name),
    join(places.skills, passing),
    options.signal,
  );
  if (!step.ok) {
    return "none";
  }
  const landed = await realOf(options, places.skills);
  if (landed !== places.judged) {
    if (landed !== undefined) {
      await movePath(join(landed, passing), join(landed, places.name), options.signal);
    }
    return "refused";
  }
  await movePath(join(places.judged, passing), placement.aside, options.signal);
  return "moved";
}

// Moves a folder into the folder judged as the skill: in under a name only this step uses, the
// folder checked after the step, then renamed by that name, which a folder that moves after the
// check cannot take. A folder that led elsewhere sends it back where it came from.
async function moveIn(
  from: string,
  places: Places,
  options: PlacementOptions & { readonly tag: string },
): Promise<boolean> {
  const passing = `${places.name}.${options.tag}.in`;
  await movePath(from, join(places.skills, passing), options.signal);
  const landed = await realOf(options, places.skills);
  if (landed !== places.judged) {
    await movePath(join(landed ?? places.skills, passing), from, options.signal);
    return false;
  }
  await movePath(join(places.judged, passing), join(places.judged, places.name), options.signal);
  return true;
}

/**
 * Puts an applied skill's folder in place of the agent's workspace skill (decisions 0408 and
 * 0410): the old folder moves aside and the new one in, each only in the skills folder judged,
 * whose real path is reached from the workspace with no link on the way. A skills folder that
 * leads elsewhere by then receives nothing and gives nothing up; the old skill goes back, and the
 * answer is `false`, which the apply reads as stale.
 */
export async function putSkillInPlace(
  placement: SkillPlacement,
  options: PlacementOptions,
): Promise<boolean> {
  const places = placesOf(placement);
  if (!(await holdsJudged(places, options))) {
    return false;
  }
  const old = await moveOut(placement, places, options);
  if (old === "refused") {
    return false;
  }
  const moves = { ...options, tag: placement.tag };
  if (await moveIn(placement.work, places, moves)) {
    return true;
  }
  if (old === "moved") {
    await moveIn(placement.aside, places, moves);
  }
  return false;
}
