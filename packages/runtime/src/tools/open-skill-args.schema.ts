import { z } from "zod";

/** The arguments of `open_skill`: a skill's name, and a path inside its folder. */
export const openSkillArgs: z.ZodType<{ readonly skill: string; readonly file?: string }> =
  z.strictObject({
    skill: z
      .string()
      .max(64)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    file: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z0-9_-][\w.-]*(?:\/[A-Za-z0-9_-][\w.-]*)*$/)
      .exactOptional(),
  });
