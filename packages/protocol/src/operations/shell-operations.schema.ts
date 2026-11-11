import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { type Empty, emptyArgsSchema, emptyResultSchema } from "../values/empty.schema.js";
import { type ChatSurface, chatSurfaceSchema } from "../views/inbox-message-view.schema.js";
import { type ShellJobView, shellJobViewSchema } from "../views/shell-job-view.schema.js";
import {
  type AllowedCommandView,
  allowedCommandViewSchema,
  maxShellCommandChars,
  type ShellAnswer,
  shellAnswerSchema,
  type ShellRequestOutcome,
  shellRequestOutcomeSchema,
  type ShellRequestView,
  shellRequestViewSchema,
} from "../views/shell-request-view.schema.js";
import { type OperationTable, readFlags, writeFlags } from "./operation.schema.js";

// How long a call waits for a command before it answers that it still runs, in milliseconds.
const shellWaitMs = { least: 10, most: 50_000, standard: 10_000 } as const;

/**
 * The args of `shell/run` (decision 0378): the command line, the folder it starts in (the owner's
 * home folder when left out, else absolute or under it), how long to wait before answering that it
 * still runs, whether to answer at once, its time limit in seconds (0 for none; the setting's
 * when left out), and the surface of the turn that runs it, which the agent's next turn names when
 * the command's end or the owner's answer starts it (decision 0409).
 */
interface ShellRunArgs {
  readonly agent: ProtocolId<"agent">;
  readonly command: string;
  readonly folder?: string;
  readonly waitMs?: number;
  readonly background?: boolean;
  readonly timeoutSeconds?: number;
  readonly surface?: ChatSurface;
}

/** The args of `shell/job`: read a running command's new output, or stop it. */
interface ShellJobArgs {
  readonly agent: ProtocolId<"agent">;
  readonly job: ProtocolId<"shellJob">;
  readonly action: "poll" | "stop";
  readonly waitMs?: number;
}

/** The args of `shell/answer`: the owner's answer to a shell request (decision 0409). */
interface ShellAnswerArgs {
  readonly request: ProtocolId<"shellRequest">;
  readonly answer: ShellAnswer;
}

/** A list of the shell's open requests or its allowed commands. */
interface Items<T> {
  readonly items: readonly T[];
}

/**
 * The operations the agent runs commands with (decision 0378), and the owner's answers to the
 * commands that ask first (decision 0409). They take no idempotency key: a kept answer would store
 * a command's output, which never leaves the engine's memory.
 */
export interface ShellOperationShapes {
  readonly "shell/run": { readonly args: ShellRunArgs; readonly result: ShellJobView };
  readonly "shell/job": { readonly args: ShellJobArgs; readonly result: ShellJobView };
  readonly "shell/answer": {
    readonly args: ShellAnswerArgs;
    readonly result: { readonly outcome: ShellRequestOutcome };
  };
  readonly "shell/requests": {
    readonly args: { readonly agent?: ProtocolId<"agent"> };
    readonly result: Items<ShellRequestView>;
  };
  readonly "shell/allowed": { readonly args: Empty; readonly result: Items<AllowedCommandView> };
  readonly "shell/disallow": {
    readonly args: { readonly allowed: ProtocolId<"allowedCommand"> };
    readonly result: Empty;
  };
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
      surface: chatSurfaceSchema.exactOptional(),
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
  "shell/answer": {
    ...writeFlags,
    name: "shell/answer",
    scope: "confirm",
    args: z.strictObject({
      request: protocolIdSchema("shellRequest"),
      answer: shellAnswerSchema,
    }),
    result: z.object({ outcome: shellRequestOutcomeSchema }),
  },
  "shell/requests": {
    ...readFlags,
    name: "shell/requests",
    scope: "read",
    args: z.strictObject({ agent: agent.exactOptional() }),
    result: z.object({ items: z.array(shellRequestViewSchema).readonly() }),
  },
  "shell/allowed": {
    ...readFlags,
    name: "shell/allowed",
    scope: "read",
    args: emptyArgsSchema,
    result: z.object({ items: z.array(allowedCommandViewSchema).readonly() }),
  },
  "shell/disallow": {
    ...writeFlags,
    name: "shell/disallow",
    scope: "confirm",
    args: z.strictObject({ allowed: protocolIdSchema("allowedCommand") }),
    result: emptyResultSchema,
  },
};
