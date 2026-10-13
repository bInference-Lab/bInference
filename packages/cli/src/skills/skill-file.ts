import { err, ok, type Result } from "@binference/core";
import { z } from "zod";
import { readSkillFields } from "./skill-front.schema.js";

/** Who a skill is for: binference's agents, outside MCP clients, or both (decision 0207). */
type SkillAudience = "agent" | "mcp" | "all";

/** What binference reads of a skill's `SKILL.md` frontmatter. */
export interface SkillFront {
  readonly name: string;
  /** The description on one line, as the agent's index shows it. */
  readonly description: string;
  readonly audience: SkillAudience;
}

/** Why a `SKILL.md` is not a skill: no frontmatter, YAML that does not parse, or a field. */
export type SkillFileProblem = "no_frontmatter" | "bad_yaml" | "bad_fields";

// The block between a first line of `---` and the next line of `---`.
const frontmatterBlock = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

const audienceSchema = z.enum(["agent", "mcp", "all"]);

/**
 * Reads a skill's `SKILL.md` frontmatter with `yaml` and checks it as the Agent Skills format
 * says: a `name` of 1 to 64 lowercase letters, digits and single hyphens, a `description` of 1 to
 * 1,024 characters, and optional `license`, `compatibility`, `allowed-tools` and string `metadata`.
 * binference's own key is `metadata["binference-audience"]`: `agent`, `mcp` or `all`, the default.
 * The description comes back on one line.
 */
export function readSkillFile(text: string): Result<SkillFront, SkillFileProblem> {
  const block = frontmatterBlock.exec(text)?.[1];
  if (block === undefined) {
    return err("no_frontmatter");
  }
  const fields = readSkillFields(block);
  if (!fields.ok) {
    return fields;
  }
  const audience = audienceSchema.safeParse(
    fields.value.metadata?.["binference-audience"] ?? "all",
  );
  if (!audience.success) {
    return err("bad_fields");
  }
  const { name, description } = fields.value;
  return ok({ name, description: description.replace(/\s+/g, " "), audience: audience.data });
}
