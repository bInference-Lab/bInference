import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";

/** The answer of a long operation: its job, which reports on the `job` topic. */
export interface JobRef {
  readonly job: ProtocolId<"longJob">;
}

/** Parses a job reference. */
export const jobRefSchema: z.ZodType<JobRef> = z.object({ job: protocolIdSchema("longJob") });
