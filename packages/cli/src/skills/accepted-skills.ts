import { join } from "node:path";
import { type Clock, type Id, idSchema, type Logger } from "@binference/core";
import {
  ensurePrivateFolder,
  type FilePermissions,
  listFolderFiles,
  readTextFile,
  writePrivateFile,
} from "@binference/platform";
import { z } from "zod";
import { skillFolderHash } from "./skill-folder-hash.js";
import { skillFolderUnder } from "./skill-folder.js";

/** One skill's accepted folder hash. */
interface AcceptedEntry {
  readonly hash: string;
  readonly acceptedAt: number;
}

/** The record: each agent's accepted skills by name, and the waiting hashes already told. */
interface AcceptedRecord {
  readonly agents: Readonly<Record<string, Readonly<Record<string, AcceptedEntry>>>>;
  readonly told: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const recordSchema: z.ZodType<AcceptedRecord> = z.object({
  agents: z.record(
    z.string(),
    z.record(z.string(), z.object({ hash: hashSchema, acceptedAt: z.int().nonnegative() })),
  ),
  told: z.record(z.string(), z.record(z.string(), hashSchema)),
});

const empty: AcceptedRecord = { agents: {}, told: {} };

/** The record's file in the skill review folder (decision 0408). */
const recordName = "accepted.json";

// A workspace skill: `<agent>/skills/<name>/SKILL.md` under the workspace.
const workspaceSkillPath = /^(agt_[^/]+)\/skills\/([^/.][^/]*)\/SKILL\.md$/;

/** What the accepted skills read and write. */
export interface AcceptedSkillsOptions {
  /** The state folder's `skill-review/`, which holds the record. */
  readonly folder: string;
  /** The state folder's `workspace/`, read once to accept what is there at the first run. */
  readonly workspace: string;
  readonly permissions: FilePermissions;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** A workspace skill of an agent at one folder hash. */
interface SkillAtHash {
  readonly agent: Id<"agt">;
  readonly name: string;
  readonly hash: string;
}

/**
 * The workspace skills the owner accepted, by agent, name and folder hash (decision 0408), kept in
 * `skill-review/accepted.json`, and the waiting hashes the owner was already told of.
 */
export interface AcceptedSkills {
  /**
   * Waits until the record is read, or at the first run made from the workspace skills there; a
   * list of the skills waits for it before it judges any, so nothing written later counts as there.
   */
  ready(signal: AbortSignal): Promise<void>;
  /** Whether the agent's skill of this name loads with this folder hash. */
  isAccepted(skill: SkillAtHash, signal: AbortSignal): Promise<boolean>;
  /** Accepts the skill at this hash, so it loads, and answers the hash it had before, if any. */
  accept(skill: SkillAtHash, signal: AbortSignal): Promise<string | undefined>;
  /** Whether a waiting skill at this hash is told for the first time; it is marked told. */
  tellOnce(skill: SkillAtHash, signal: AbortSignal): Promise<boolean>;
}

/** One change of the record: the record it leaves, when it changes it, and what it answers. */
interface RecordChange<T> {
  readonly next?: AcceptedRecord;
  readonly answer: T;
}

/** The record as it stands, and each change of it, run one after another. */
interface RecordCell {
  ready(signal: AbortSignal): Promise<void>;
  read(signal: AbortSignal): Promise<AcceptedRecord>;
  change<T>(signal: AbortSignal, step: (now: AcceptedRecord) => RecordChange<T>): Promise<T>;
}

// Every workspace skill there is now, each accepted at its folder hash.
async function seeded(
  options: AcceptedSkillsOptions,
  signal: AbortSignal,
): Promise<AcceptedRecord> {
  const at = options.clock.now();
  const agents: Record<string, Record<string, AcceptedEntry>> = {};
  for (const path of await listFolderFiles(options.workspace, signal)) {
    const [, agent, name] = workspaceSkillPath.exec(path) ?? [];
    if (agent !== undefined && name !== undefined && idSchema("agt").safeParse(agent).success) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- once, at the first run of this version
      const folder = await skillFolderUnder(options.workspace, join(agent, "skills", name), signal);
      // oxlint-disable-next-line eslint/no-await-in-loop -- as above
      const hash = await skillFolderHash(folder, signal);
      if (hash !== undefined) {
        agents[agent] = { ...agents[agent], [name]: { hash, acceptedAt: at } };
      }
    }
  }
  return { agents, told: {} };
}

function parsed(text: string): AcceptedRecord | undefined {
  try {
    const record = recordSchema.safeParse(JSON.parse(text));
    return record.success ? record.data : undefined;
  } catch {
    return undefined;
  }
}

async function writeRecord(
  options: AcceptedSkillsOptions,
  next: AcceptedRecord,
  signal: AbortSignal,
): Promise<void> {
  const files = { permissions: options.permissions, signal };
  await ensurePrivateFolder(options.folder, files);
  const text = `${JSON.stringify(next, undefined, 2)}\n`;
  await writePrivateFile(join(options.folder, recordName), text, files);
}

async function loadRecord(
  options: AcceptedSkillsOptions,
  signal: AbortSignal,
): Promise<AcceptedRecord> {
  const read = await readTextFile(join(options.folder, recordName), signal);
  if (!read.ok) {
    const first = await seeded(options, signal);
    await writeRecord(options, first, signal);
    return first;
  }
  const kept = parsed(read.value);
  if (kept === undefined) {
    options.logger.warn("skill.accepted_unread", { errorCode: "skill.invalid" });
  }
  return kept ?? empty;
}

// The record is read once and kept, as the engine is its one writer; a change waits for the one
// before it and writes the whole record before it answers.
function recordCell(options: AcceptedSkillsOptions): RecordCell {
  let record: Promise<AcceptedRecord> | undefined;
  let queue: Promise<void> = Promise.resolve();
  const current = async (signal: AbortSignal): Promise<AcceptedRecord> => {
    record ??= loadRecord(options, signal);
    return record;
  };
  return {
    async ready(signal) {
      await current(signal);
    },
    async read(signal) {
      await queue;
      return current(signal);
    },
    async change(signal, step) {
      const run = queue.then(async () => {
        const made = step(await current(signal));
        if (made.next !== undefined) {
          await writeRecord(options, made.next, signal);
          record = Promise.resolve(made.next);
        }
        return made.answer;
      });
      queue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

/**
 * Creates the {@link AcceptedSkills}. With no record file, which is the first run of this version,
 * every workspace skill there when the shelf first lists skills, before any turn of the agent can
 * run a tool, is accepted at its hash and the file written. A file that does not
 * read accepts nothing, logged as `skill.accepted_unread`, until the next accept writes it again.
 */
export function createAcceptedSkills(options: AcceptedSkillsOptions): AcceptedSkills {
  const cell = recordCell(options);
  return {
    async ready(signal) {
      await cell.ready(signal);
    },
    async isAccepted({ agent, name, hash }, signal) {
      return (await cell.read(signal)).agents[agent]?.[name]?.hash === hash;
    },
    async accept({ agent, name, hash }, signal) {
      return cell.change(signal, (now) => {
        const entry = { hash, acceptedAt: options.clock.now() };
        const agents = { ...now.agents, [agent]: { ...now.agents[agent], [name]: entry } };
        return { next: { ...now, agents }, answer: now.agents[agent]?.[name]?.hash };
      });
    },
    async tellOnce({ agent, name, hash }, signal) {
      return cell.change(signal, (now) => {
        if (now.told[agent]?.[name] === hash) {
          return { answer: false };
        }
        const told = { ...now.told, [agent]: { ...now.told[agent], [name]: hash } };
        return { next: { ...now, told }, answer: true };
      });
    },
  };
}
