import { createHash } from "node:crypto";
import { join } from "node:path";
import { err, type Id, type Logger, ok, type Result } from "@binference/core";
import { listFolderFiles } from "@binference/platform";
import { lintSkill } from "@binference/plugin-sdk";
import type { AcceptedSkills } from "./accepted-skills.js";
import { type InstalledSkills, readInstalledSkills } from "./installed-skills.js";
import { readSkillFile } from "./skill-file.js";
import { skillFolderHash } from "./skill-folder-hash.js";
import { readSkillTextFile, type SkillFolder, skillFolderUnder } from "./skill-folder.js";

/** Where a skill lives (decision 0207). */
type SkillPlace = "bundled" | "installed" | "workspace";

/** One skill an agent's index holds, or one installed for every agent. */
export interface ShelfSkill {
  /** Its name when installed, else `bundled:<name>` or `workspace:<name>`. */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly place: SkillPlace;
  /** `<place>/<name>/SKILL.md`, what the agent's index names it by. */
  readonly location: string;
  /** Its folder on this machine; never shown to the agent. */
  readonly folder: string;
  /** Its folder's real path, reached from its place's root with no link on the way (decision 0410). */
  readonly realFolder: string;
  readonly source: string;
  readonly hash: string;
  readonly installedAt: number;
  /** The agent whose workspace holds it. */
  readonly agent?: Id<"agt">;
}

/** Where the skills are. */
interface SkillFolders {
  /** The folders the package's own `skills/` may be in; the first that holds a skill is used. */
  readonly bundled: readonly string[];
  /** The state folder's `skills/`. */
  readonly installed: string;
  /** The state folder's `workspace/`, one folder per agent. */
  readonly workspace: string;
}

/** What the shelf reads. */
export interface SkillShelfOptions {
  readonly folders: SkillFolders;
  /** When this engine started: when a bundled or workspace skill counts as installed. */
  readonly startedAtMs: number;
  readonly logger: Logger;
  /** Which workspace skills load: those whose folder hash the owner accepted (decision 0408). */
  readonly accepted: Pick<AcceptedSkills, "ready" | "isAccepted">;
  /** Told of each workspace skill that waits for the owner, each time a list finds it. */
  readonly onWaiting?: (skill: ShelfSkill) => Promise<void>;
}

/** One skill folder found in a place, before its `SKILL.md` is read. */
interface Found extends SkillFolder {
  readonly place: SkillPlace;
  readonly folderName: string;
  readonly agent?: Id<"agt">;
}

/** Where a place's skill folders are listed: below `root`, which no agent can change, at `inner`. */
interface Listed {
  readonly root: string;
  readonly inner: string;
}

// A skill is a folder of its own, its name not starting with a dot, holding `SKILL.md`.
const skillMdPath = /^([^/.][^/]*)\/SKILL\.md$/;

/** The SHA-256 of a text, in hex. */
function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function foldersIn(
  listed: Listed,
  where: Pick<Found, "place" | "agent">,
  signal: AbortSignal,
): Promise<readonly Found[]> {
  const files = await listFolderFiles(join(listed.root, listed.inner), signal);
  const names = files.flatMap((file) => skillMdPath.exec(file)?.[1] ?? []);
  return Promise.all(
    names.map(async (folderName): Promise<Found> => {
      const { folder, realFolder } = await skillFolderUnder(
        listed.root,
        join(listed.inner, folderName),
        signal,
      );
      const { place, agent } = where;
      return agent === undefined
        ? { place, folderName, folder, realFolder }
        : { place, folderName, folder, realFolder, agent };
    }),
  );
}

async function bundledFolders(roots: readonly string[], signal: AbortSignal) {
  for (const root of roots) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- the first root that holds a skill wins
    const found = await foldersIn({ root, inner: "" }, { place: "bundled" }, signal);
    if (found.length > 0) {
      return found;
    }
  }
  return [];
}

/** What a found skill becomes once its `SKILL.md` is read, or why it is left out. */
type Read = Result<ShelfSkill, string>;

/** What a list reads besides the folders: the installed record and when the engine started. */
interface ReadContext {
  readonly installed: InstalledSkills;
  readonly startedAtMs: number;
}

// A workspace skill's hash covers its whole folder (decision 0408); a bundled one's its text.
async function provenance(
  found: Found,
  context: ReadContext & { readonly text: string },
  signal: AbortSignal,
): Promise<Pick<ShelfSkill, "source" | "hash" | "installedAt"> | undefined> {
  if (found.place === "installed") {
    return context.installed.get(found.folderName);
  }
  const hash =
    found.place === "workspace" ? await skillFolderHash(found, signal) : sha256Text(context.text);
  return hash === undefined
    ? undefined
    : { source: found.place, hash, installedAt: context.startedAtMs };
}

async function readFound(found: Found, context: ReadContext, signal: AbortSignal): Promise<Read> {
  const read = await readSkillTextFile(found, "SKILL.md", signal);
  if (!read.ok) {
    return err("skill.not_found");
  }
  const front = readSkillFile(read.value);
  if (!front.ok || front.value.name !== found.folderName) {
    return err("skill.invalid");
  }
  if (lintSkill(read.value).length > 0) {
    return err("skill.refused");
  }
  const from = await provenance(found, { ...context, text: read.value }, signal);
  if (from === undefined || front.value.audience === "mcp") {
    return err(from === undefined ? "skill.not_found" : "skill.mcp_only");
  }
  const { name, description } = front.value;
  const id = found.place === "installed" ? name : `${found.place}:${name}`;
  const location = `${found.place}/${name}/SKILL.md`;
  const agent = found.agent === undefined ? {} : { agent: found.agent };
  return ok({
    id,
    name,
    description,
    place: found.place,
    location,
    folder: found.folder,
    realFolder: found.realFolder,
    ...from,
    ...agent,
  });
}

/** The skills of an install, read from their folders each time they are asked for. */
export interface SkillShelf {
  /**
   * With an agent, the skills its index holds: its workspace skills, then the bundled and the
   * installed ones it does not shadow, by name. Without, the bundled and installed skills.
   */
  list(agent: Id<"agt"> | undefined, signal: AbortSignal): Promise<readonly ShelfSkill[]>;
  /** The names of the bundled skills' folders, every one of them, which no install may take. */
  bundledNames(signal: AbortSignal): Promise<ReadonlySet<string>>;
  /**
   * The agent's workspace skills that wait for the owner to accept their files as they are now
   * (decision 0408): none of them loads, and a bundled or installed skill of the same name does.
   */
  waiting(agent: Id<"agt">, signal: AbortSignal): Promise<readonly ShelfSkill[]>;
}

// The places in the order a name wins: the owner's own, then binference's, then installed.
const rank: Readonly<Record<SkillPlace, number>> = { workspace: 0, bundled: 1, installed: 2 };

function byName(skills: readonly ShelfSkill[]): readonly ShelfSkill[] {
  const kept = new Map<string, ShelfSkill>();
  for (const skill of skills.toSorted((one, two) => rank[one.place] - rank[two.place])) {
    if (!kept.has(skill.name)) {
      kept.set(skill.name, skill);
    }
  }
  return [...kept.values()].toSorted((one, two) => (one.name < two.name ? -1 : 1));
}

/** What one list found: the skills that load, and the workspace skills that wait. */
interface ShelfRead {
  readonly skills: readonly ShelfSkill[];
  readonly waiting: readonly ShelfSkill[];
}

async function foundFor(
  folders: SkillFolders,
  agent: Id<"agt"> | undefined,
  signal: AbortSignal,
): Promise<readonly Found[]> {
  // A workspace skill's real path starts at the workspace, which the agent cannot change, so an
  // agent's folder or skills folder that became a link moves its files' real paths out of it.
  const workspace =
    agent === undefined
      ? []
      : await foldersIn(
          { root: folders.workspace, inner: join(agent, "skills") },
          { place: "workspace", agent },
          signal,
        );
  const installed = { root: folders.installed, inner: "" };
  return [
    ...workspace,
    ...(await bundledFolders(folders.bundled, signal)),
    ...(await foldersIn(installed, { place: "installed" }, signal)),
  ];
}

// Splits what loads from the workspace skills whose folder hash the owner has not accepted.
async function gated(
  options: SkillShelfOptions,
  skills: readonly ShelfSkill[],
  signal: AbortSignal,
): Promise<ShelfRead> {
  const judged = await Promise.all(
    skills.map(async (skill) => ({
      skill,
      loads:
        skill.place !== "workspace" ||
        skill.agent === undefined ||
        (await options.accepted.isAccepted({ ...skill, agent: skill.agent }, signal)),
    })),
  );
  const waiting = judged.filter(({ loads }) => !loads).map(({ skill }) => skill);
  await Promise.all(waiting.map(async (skill) => options.onWaiting?.(skill)));
  return { skills: judged.filter(({ loads }) => loads).map(({ skill }) => skill), waiting };
}

/**
 * Creates the {@link SkillShelf} over the bundled, installed and workspace folders (decision
 * 0207). A skill whose `SKILL.md` is missing, fails its frontmatter, names another folder, has a
 * lint finding, is for MCP clients alone, or is installed without a record, is left out; each is
 * logged once by its location. A workspace skill loads only while `accepted` holds its folder hash
 * (decision 0408); one that waits is handed to `onWaiting` each time a list finds it.
 */
export function createSkillShelf(options: SkillShelfOptions): SkillShelf {
  const { folders, startedAtMs, logger } = options;
  const logged = new Set<string>();
  const leaveOut = (found: Found, code: string): void => {
    const sourceId = `${found.place}/${found.folderName}/SKILL.md`;
    if (code !== "skill.mcp_only" && !logged.has(`${sourceId} ${code}`)) {
      logged.add(`${sourceId} ${code}`);
      logger.warn("skill.left_out", { sourceId, errorCode: code, ...agentField(found) });
    }
  };
  const read = async (agent: Id<"agt"> | undefined, signal: AbortSignal): Promise<ShelfRead> => {
    await options.accepted.ready(signal);
    const found = await foundFor(folders, agent, signal);
    const installed = await readInstalledSkills(folders.installed, signal);
    const reads = await Promise.all(
      found.map(async (each) => ({
        each,
        read: await readFound(each, { installed, startedAtMs }, signal),
      })),
    );
    const skills = reads.flatMap(({ each, read: result }) => {
      if (!result.ok) {
        leaveOut(each, result.error);
        return [];
      }
      return [result.value];
    });
    return gated(options, skills, signal);
  };
  return {
    async list(agent, signal) {
      return byName((await read(agent, signal)).skills);
    },
    async bundledNames(signal) {
      const found = await bundledFolders(folders.bundled, signal);
      return new Set(found.map(({ folderName }) => folderName));
    },
    async waiting(agent, signal) {
      return (await read(agent, signal)).waiting;
    },
  };
}

function agentField(found: Found): { readonly agentId?: string } {
  return found.agent === undefined ? {} : { agentId: found.agent };
}
