import { z } from "zod";

/** What the recorded run's MCP server reads from its environment. */
export interface SkillRunEnv {
  /** The JSON file the server rewrites after each tool call and each answer. */
  readonly SKILL_RUN_RECORD: string;
}

/** Parses the recorded run's MCP server environment; every other variable is left out. */
export const skillRunEnvSchema: z.ZodType<SkillRunEnv> = z.object({
  SKILL_RUN_RECORD: z.string().min(1),
});
