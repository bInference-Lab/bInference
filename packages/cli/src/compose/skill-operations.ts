import { join } from "node:path";
import {
  BinferenceError,
  type Clock,
  createIdSource,
  err,
  idSchema,
  jsonValueSchema,
  type Logger,
  ok,
  type Random,
} from "@binference/core";
import type { PublishPush } from "@binference/engine";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import { type FilePermissions, removePath } from "@binference/platform";
import type { JobDonePush, JobFailedPush, ProtocolId, ResultOf } from "@binference/protocol";
import { bundledSkillRoots } from "../skills/bundled-roots.js";
import {
  type InstallFailure,
  type InstallParts,
  type InstallRequest,
  type InstalledView,
  installSkill,
} from "../skills/install-skill.js";
import { readInstalledSkills, writeInstalledSkills } from "../skills/installed-skills.js";
import { readSkillText } from "../skills/read-skill-file.js";
import type { ShelfSkill, SkillShelf } from "../skills/skill-shelf.js";
import { createSkillShelf } from "../skills/skill-shelf.js";
import { readSkillSource } from "../skills/skill-source.js";
import type { Closers } from "./closers.js";
import type { Opened, Opening } from "./open-engine-parts.js";

type SkillView = ResultOf<"skill/list">["items"][number];

/** What the skill operations read, write and announce. */
export interface SkillOperationsOptions {
  readonly shelf: SkillShelf;
  /** The state folder's `skills/`, and the folder beside it where installs work. */
  readonly folders: InstallParts["folders"];
  readonly permissions: FilePermissions;
  readonly clock: Clock;
  readonly random: Random;
  /** The engine's one publish; an install's end goes to the `job` topic. */
  readonly publish: PublishPush;
  /** Where the operations add what stops an install under way. */
  readonly closers: Closers;
  readonly logger: Logger;
  /** `npm pack` unless a test passes another packer. */
  readonly pack?: InstallParts["pack"];
}

function viewOf(skill: ShelfSkill): SkillView {
  const view = {
    skill: skill.id,
    name: skill.name,
    source: skill.source,
    hash: skill.hash,
    installedAt: skill.installedAt,
    description: skill.description,
    place: skill.place,
    location: skill.location,
  };
  return skill.agent === undefined ? view : { ...view, agent: skill.agent };
}

const add = "skill/add";

const readCodes = {
  not_found: "skill.not_found",
  bad_path: "protocol.bad_args",
  refused: "skill.refused",
} as const;

function failedPush(job: ProtocolId<"longJob">, failure: InstallFailure): JobFailedPush {
  const retryable = failure.code === "skill.fetch_failed";
  if (failure.code !== "skill.refused") {
    return {
      job,
      op: add,
      error: { code: failure.code, message: "The skill was not installed.", retryable },
    };
  }
  // The message names every finding by file, line and rule; the details name the first.
  const lines = failure.findings.map(({ file, line, code }) => `${file}:${String(line)} ${code}`);
  const [first] = failure.findings;
  const details =
    first === undefined ? {} : { file: first.file, line: first.line, rule: first.code };
  const message = `The skill was refused: ${lines.join("; ")}.`;
  const error = {
    code: failure.code,
    message,
    retryable,
    details: { ...details, findings: lines.length },
  };
  return { job, op: add, error };
}

// A skill's view holds strings and numbers alone, so it is its own JSON.
function donePush(job: ProtocolId<"longJob">, view: SkillView): JobDonePush {
  return { job, op: add, result: jsonValueSchema.parse(view) };
}

function installedView(installed: InstalledView): SkillView {
  const { name, description, source, hash, installedAt } = installed;
  const shown = {
    description,
    place: "installed" as const,
    location: `installed/${name}/SKILL.md`,
  };
  return { skill: name, name, source, hash, installedAt, ...shown };
}

function installParts(options: SkillOperationsOptions): InstallParts {
  const { shelf, folders, permissions, clock, random } = options;
  const parts = { folders, shelf, permissions, clock, random };
  return options.pack === undefined ? parts : { ...parts, pack: options.pack };
}

/** The install under way, if any, and the promise that settles when it ends. */
interface Running {
  job: ProtocolId<"longJob"> | undefined;
  ended: Promise<void>;
}

// Installs one skill and publishes how it ended; a stop of the engine ends it unannounced.
async function runInstall(
  options: SkillOperationsOptions,
  install: { readonly job: ProtocolId<"longJob">; readonly request: InstallRequest },
  stop: AbortSignal,
): Promise<void> {
  const { publish } = options;
  const failed = (failure: InstallFailure): void => {
    const data = jsonValueSchema.parse(failedPush(install.job, failure));
    publish({ topic: "job", kind: "job/failed", data });
  };
  try {
    const outcome = await installSkill(installParts(options), install.request, stop);
    if (stop.aborted) {
      return;
    }
    if (!outcome.ok) {
      failed(outcome.failure);
      return;
    }
    const data = jsonValueSchema.parse(donePush(install.job, installedView(outcome.value)));
    publish({ topic: "job", kind: "job/done", data });
  } catch (error) {
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    options.logger.warn("skill.install_stopped", { errorCode });
    if (!stop.aborted) {
      failed({ code: "skill.fetch_failed" });
    }
  }
}

async function removeInstalled(
  options: SkillOperationsOptions,
  name: string,
  signal: AbortSignal,
): Promise<boolean> {
  const { installed } = options.folders;
  const record = new Map(await readInstalledSkills(installed, signal));
  if (!record.has(name)) {
    return false;
  }
  record.delete(name);
  await writeInstalledSkills(installed, record, { permissions: options.permissions, signal });
  await removePath(join(installed, name), signal);
  return true;
}

/**
 * The skill operations (protocol spec, section 7.8; decision 0207). `skill/list` answers the
 * skills an agent's index holds, or with no agent the bundled and installed ones. `skill/read`
 * answers one file of a skill the agent's index holds: `skill.not_found`, `protocol.bad_args`
 * for a path outside the skill, `skill.refused` for a file the agent may not read. `skill/add`
 * reads its source and hash (`protocol.bad_args` otherwise), answers a job at once and installs
 * one skill at a time; while one runs, it answers that job. The job ends on the `job` topic with
 * the skill, or with a `skill` code. `skill/remove` removes an installed skill and its record, or
 * fails `skill.not_found`; bundled and workspace skills are not removed here.
 */
export function createSkillOperations(options: SkillOperationsOptions): EngineHandlerTable {
  const { shelf } = options;
  const ids = createIdSource({ clock: options.clock, random: options.random });
  const stop = new AbortController();
  const running: Running = { job: undefined, ended: Promise.resolve() };
  options.closers.add("skill installs", async () => {
    stop.abort();
    await running.ended;
  });
  return {
    "skill/list": async ({ args, signal }) => {
      const agent = args.agent === undefined ? undefined : idSchema("agt").parse(args.agent);
      const skills = await shelf.list(agent, signal);
      return ok({ items: skills.map(viewOf) });
    },
    "skill/read": async ({ args, signal }) => {
      const agent = idSchema("agt").parse(args.agent);
      const request =
        args.file === undefined
          ? { agent, skill: args.skill }
          : { agent, skill: args.skill, file: args.file };
      const read = await readSkillText(shelf, request, signal);
      if (!read.ok) {
        return err(readCodes[read.error]);
      }
      const { skill, file, text } = read.value;
      return ok({ skill: skill.name, place: skill.place, location: skill.location, file, text });
    },
    "skill/add": async ({ args }) => {
      const from = readSkillSource(args.source, args.hash);
      if (!from.ok) {
        return err("protocol.bad_args");
      }
      if (running.job !== undefined) {
        return ok({ job: running.job });
      }
      const job = ids.next("job");
      running.job = job;
      const request = { source: args.source, hash: args.hash, from: from.value };
      running.ended = runInstall(options, { job, request }, stop.signal).finally(() => {
        running.job = undefined;
      });
      return ok({ job });
    },
    "skill/remove": async ({ args, signal }) =>
      (await removeInstalled(options, args.skill, signal)) ? ok({}) : err("skill.not_found"),
  };
}

/**
 * The skill operations of the self-hosted engine: the package's bundled skills, the state folder's
 * `skills/` with installs worked on in `skill-work/` beside it, and each agent's
 * `workspace/<agent>/skills/`; an install's end goes to `publish`.
 */
export function composeSkillOperations(
  opening: Opening,
  opened: Opened,
  publish: PublishPush,
): EngineHandlerTable {
  const { platform, host, closers } = opening;
  const { root, workspace } = platform.stateFolder;
  const logger = opened.log.logger.child("skills");
  const folders = { installed: join(root, "skills"), staging: join(root, "skill-work") };
  const shelf = createSkillShelf({
    folders: { bundled: bundledSkillRoots, installed: folders.installed, workspace },
    startedAtMs: host.clock.now(),
    logger,
  });
  return createSkillOperations({
    shelf,
    folders,
    permissions: platform.permissions,
    clock: host.clock,
    random: host.random,
    publish,
    closers,
    logger,
  });
}
