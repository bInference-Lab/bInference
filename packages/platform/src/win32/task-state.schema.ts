import { z } from "zod";
import { parseJsonText } from "../json-text.schema.js";

/**
 * What Task Scheduler reports about one task: its state number (4 is running, 3 ready, 1
 * disabled), whether it is enabled, and whether an enabled trigger starts it at logon.
 */
export type TaskState =
  | { readonly found: false }
  | {
      readonly found: true;
      readonly state: number;
      readonly enabled: boolean;
      readonly logon: boolean;
    };

const taskStateSchema: z.ZodType<TaskState> = z.union([
  z.strictObject({ found: z.literal(false) }),
  z.strictObject({
    found: z.literal(true),
    state: z.int().min(0).max(4),
    enabled: z.boolean(),
    logon: z.boolean(),
  }),
]);

/** Reads the JSON line the task probe printed; anything else is `undefined`. */
export function parseTaskState(text: string): TaskState | undefined {
  const parsed = taskStateSchema.safeParse(parseJsonText(text.trim()));
  return parsed.success ? parsed.data : undefined;
}
