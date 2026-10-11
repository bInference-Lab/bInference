import { type JsonValue, jsonValueSchema } from "@binference/core";
import { z } from "zod";
import { type ProtocolError, protocolErrorSchema } from "../errors/protocol-error.js";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";

/**
 * The data of a `job/done` push: the job, the operation that started it, and what it made, in
 * the shape protocol spec section 7 names for that operation's job.
 */
export interface JobDonePush {
  readonly job: ProtocolId<"longJob">;
  readonly op: string;
  readonly result: JsonValue;
}

/** The data of a `job/failed` push: the job, the operation that started it, and why it failed. */
export interface JobFailedPush {
  readonly job: ProtocolId<"longJob">;
  readonly op: string;
  readonly error: ProtocolError;
}

/** Parses the data of a `job/done` push. */
export const jobDonePushSchema: z.ZodType<JobDonePush> = z.object({
  job: protocolIdSchema("longJob"),
  op: z.string().min(1),
  result: jsonValueSchema,
});

/** Parses the data of a `job/failed` push. */
export const jobFailedPushSchema: z.ZodType<JobFailedPush> = z.object({
  job: protocolIdSchema("longJob"),
  op: z.string().min(1),
  error: protocolErrorSchema,
});
