import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { type ShellJobView, shellJobViewSchema } from "../views/shell-job-view.schema.js";
import { type OperationTable, readFlags } from "./operation.schema.js";

// The longest command line the agent may run.
const maxShellCommandChars = 8_000;

// How long a call waits for a command before it answers that it still runs, in milliseconds.
const shellWaitMs = { least: 10, most: 50_000, standard: 10_000 } as const;

/**
 * The args of `shell/run` (decision 0378): the command line, the folder it starts in (the owner's
 * home folder when left out, else absolute or under it), how long to wait before answering that it
 * still runs, whether to answer at once, and its time limit in seconds (0 for none; the setting's
 * when left out).
 */
interface ShellRunArgs {
  readonly agent: ProtocolId<"agent">;
  readonly command: string;
  readonly folder?: string;
  readonly waitMs?: number;
  readonly background?: boolean;
  readonly timeoutSeconds?: number;
}

/** The args of `shell/job`: read a running command's new output, or stop it. */
interface ShellJobArgs {
  readonly agent: ProtocolId<"agent">;
  readonly job: ProtocolId<"shellJob">;
  readonly action: "poll" | "stop";
  readonly waitMs?: number;
}

/**
 * The operations the agent runs commands with (decision 0378). They take no idempotency key: a
 * kept answer would store a command's output, which never leaves the engine's memory.
 */
export interface ShellOperationShapes {
  readonly "shell/run": { readonly args: ShellRunArgs; readonly result: ShellJobView };
  readonly "shell/job": { readonly args: ShellJobArgs; readonly result: ShellJobView };
}

const agent = protocolIdSchema("agent");
const waitMs = z.int().min(shellWaitMs.least).max(shellWaitMs.most);

/** The shell operations, by name. */
export const shellOperations: OperationTable<ShellOperationShapes> = {
  "shell/run": {
    ...readFlags,
    name: "shell/run",
    scope: "agent",
    args: z.strictObject({
      agent,
      command: z.string().trim().min(1).max(maxShellCommandChars),
      folder: z.string().min(1).max(4_096).exactOptional(),
      waitMs: waitMs.exactOptional(),
      background: z.boolean().exactOptional(),
      timeoutSeconds: z.int().min(0).max(86_400).exactOptional(),
    }),
    result: shellJobViewSchema,
  },
  "shell/job": {
    ...readFlags,
    name: "shell/job",
    scope: "agent",
    args: z.strictObject({
      agent,
      job: protocolIdSchema("shellJob"),
      action: z.enum(["poll", "stop"]),
      waitMs: waitMs.exactOptional(),
    }),
    result: shellJobViewSchema,
  },
};
