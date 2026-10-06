import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";

/** When a schedule runs: on a cron expression, in an IANA zone or the owner's, or once `at`. */
export type ScheduleWhen =
  | { readonly cron: string; readonly timezone?: string }
  | { readonly at: number };

/** A schedule: a model turn with `prompt` at set times. It moves no money. */
export interface ScheduleView {
  readonly schedule: ProtocolId<"schedule">;
  readonly agent: ProtocolId<"agent">;
  readonly when: ScheduleWhen;
  readonly prompt: string;
  readonly state: "active" | "cancelled";
  readonly nextAt?: number;
  readonly lastAt?: number;
  readonly createdAt: number;
}

const cronShape = {
  cron: z.string().min(1).max(100),
  timezone: z.string().min(1).max(64).exactOptional(),
};

/** Parses when a schedule runs, as `schedule/create` takes it. Unknown fields are refused. */
export const scheduleWhenSchema: z.ZodType<ScheduleWhen> = z.union([
  z.strictObject(cronShape),
  z.strictObject({ at: epochMsSchema }),
]);

/** Parses a schedule view. */
export const scheduleViewSchema: z.ZodType<ScheduleView> = z.object({
  schedule: protocolIdSchema("schedule"),
  agent: protocolIdSchema("agent"),
  when: z.union([z.object(cronShape), z.object({ at: epochMsSchema })]),
  prompt: z.string(),
  state: z.enum(["active", "cancelled"]),
  nextAt: epochMsSchema.exactOptional(),
  lastAt: epochMsSchema.exactOptional(),
  createdAt: epochMsSchema,
});
