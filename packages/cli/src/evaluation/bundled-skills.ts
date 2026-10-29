import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BinferenceError } from "@binference/core";
import { createMemoryLogger } from "@binference/core/testing";
import { readTextFile } from "@binference/platform";
import { bundledSkillRoots } from "../skills/bundled-roots.js";
import { createSkillShelf } from "../skills/skill-shelf.js";

/** A bundled skill as the evaluation's agent reads it: its index entry and its `SKILL.md`. */
export interface EvaluationSkill {
  readonly name: string;
  readonly description: string;
  /** `bundled/<name>/SKILL.md`, as the agent's index names it. */
  readonly location: string;
  readonly text: string;
}

// The evaluation runs on a fresh install: no skill is installed and no workspace holds one, so
// the state folder's skill folders do not exist.
const freshState = fileURLToPath(new URL("fresh-install/", import.meta.url));

/**
 * Reads the bundled skills every agent's index holds, as the engine's shelf lists them: the same
 * frontmatter, lint and audience rules, so a skill for MCP clients alone stays out. A bundled skill
 * the shelf leaves out throws `evaluation.bad_skill`, naming it and why.
 */
export async function loadBundledSkills(signal: AbortSignal): Promise<readonly EvaluationSkill[]> {
  // The shelf warns of each skill it leaves out, so a bundled skill the engine would not list
  // fails the evaluation instead of going missing from it.
  const logger = createMemoryLogger({ subsystem: "evaluation" });
  const shelf = createSkillShelf({
    folders: { bundled: bundledSkillRoots, installed: freshState, workspace: freshState },
    startedAtMs: 0,
    logger,
  });
  const skills = await shelf.list(undefined, signal);
  const leftOut = logger
    .records()
    .filter((record) => record.level === "warn")
    .map(({ event, fields }) => `${fields.sourceId ?? event} ${fields.errorCode ?? ""}`);
  if (leftOut.length > 0) {
    throw new BinferenceError({
      code: "evaluation.bad_skill",
      message: `A bundled skill is left out of the agents' index: ${leftOut.join(", ")}.`,
    });
  }
  return Promise.all(
    skills.map(async ({ name, description, location, folder }) => {
      const read = await readTextFile(join(folder, "SKILL.md"), signal);
      if (!read.ok) {
        throw new BinferenceError({
          code: "evaluation.bad_skill",
          message: `${location} could not be read.`,
        });
      }
      return { name, description, location, text: read.value };
    }),
  );
}
