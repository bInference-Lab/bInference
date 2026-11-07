import type { ShellOperationShapes } from "../operations/shell-operations.schema.js";
import { at, ids, type WireExample } from "./wire-values.js";

const ended = {
  job: ids.shellJob,
  status: "ended",
  command: "ls -l",
  folder: "/Users/owner",
  startedAt: at,
  endedAt: at + 40,
  exitCode: 0,
  timedOut: false,
  stopped: false,
  output: "total 0\ndrwx------  4 owner  staff  128 Nov  7 12:00 Documents\n",
  outputCut: false,
};

/** Example calls of the operations the agent runs commands with (decision 0378). */
export const shellExamples: { readonly [N in keyof ShellOperationShapes]: WireExample } = {
  "shell/run": {
    args: { agent: ids.agent, command: "ls -l", waitMs: 10_000 },
    result: ended,
  },
  "shell/job": {
    args: { agent: ids.agent, job: ids.shellJob, action: "poll" },
    result: { ...ended, output: "", endedAt: at + 40 },
  },
};
