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

const request = {
  request: ids.shellRequest,
  agent: ids.agent,
  job: ids.shellJob,
  command: "git status",
  folder: "/srv/project",
  reason: "unlisted",
  canAlwaysAllow: true,
  createdAt: at,
  closesAt: at + 600_000,
};

/** Example calls of the operations the agent runs commands with (decisions 0378 and 0409). */
export const shellExamples: { readonly [N in keyof ShellOperationShapes]: WireExample } = {
  "shell/run": {
    args: { agent: ids.agent, command: "ls -l", waitMs: 10_000, surface: "telegram" },
    result: ended,
  },
  "shell/job": {
    args: { agent: ids.agent, job: ids.shellJob, action: "poll" },
    result: { ...ended, output: "", endedAt: at + 40 },
  },
  "shell/answer": {
    args: { request: ids.shellRequest, answer: "always" },
    result: { outcome: "allowed_always" },
  },
  "shell/requests": { args: {}, result: { items: [request] } },
  "shell/allowed": {
    args: {},
    result: {
      items: [
        {
          allowed: ids.allowedCommand,
          text: "git status",
          program: "/usr/bin/git",
          args: ["status"],
          folder: "/srv/project",
          allowedAt: at,
        },
      ],
    },
  },
  "shell/disallow": { args: { allowed: ids.allowedCommand }, result: {} },
};
