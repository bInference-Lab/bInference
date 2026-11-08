import { type Clock, type Id, idSchema } from "@binference/core";
import { z } from "zod";
import { type HelperDesk, helperMinutes } from "../helpers/helper-desk.js";
import { agentToolTexts } from "./agent-tool-texts.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import { helperLine, readingText, refusedHelper } from "./helper-answers.js";
import type { AgentToolParts } from "./tool-client.js";

/** What the helper tools run on: the agent's helpers, and the time their lines read. */
export interface HelperToolParts {
  readonly desk: HelperDesk;
  readonly clock: Clock;
}

/** The args of `helper_start`: the whole brief, its title, and the model and time it runs with. */
interface StartArgs {
  readonly task: string;
  readonly label: string;
  readonly model?: string;
  readonly timeoutMinutes?: number;
}

/** The args of `helper_send`: the helper and the follow-up, with its run's time. */
interface SendArgs {
  readonly helper: Id<"ses">;
  readonly message: string;
  readonly timeoutMinutes?: number;
}

/** The args of `helper_read` and `helper_stop`: one of the agent's helpers. */
interface HelperArgs {
  readonly helper: Id<"ses">;
}

const minutes = z.int().min(helperMinutes.least).max(helperMinutes.most);
const brief = z.string().trim().min(1).max(20_000);

const startArgs: z.ZodType<StartArgs> = z.strictObject({
  task: brief,
  label: z.string().trim().min(1).max(60),
  model: z.string().trim().min(3).max(200).exactOptional(),
  timeoutMinutes: minutes.exactOptional(),
});

const sendArgs: z.ZodType<SendArgs> = z.strictObject({
  helper: idSchema("ses"),
  message: brief,
  timeoutMinutes: minutes.exactOptional(),
});

const helperArgs: z.ZodType<HelperArgs> = z.strictObject({ helper: idSchema("ses") });

function startTool(parts: AgentToolParts, helpers: HelperToolParts): AgentTool {
  return defineTool({
    name: "helper_start",
    kind: "control",
    description: agentToolTexts.helper_start,
    args: startArgs,
    run: async (args, { signal }) => {
      const request = { ...args, agent: parts.agent, from: { session: parts.turn.session } };
      const started = await helpers.desk.start(request, signal);
      if (!started.ok) {
        return refusedHelper(started.error);
      }
      const helper = started.value;
      const limit = String(Math.round(helper.timeoutMs / 60_000));
      return {
        text: `Started helper "${helper.label}" (${helper.id}), with up to ${limit} minutes. Its result arrives on its own in a later turn, as a message from binference. Now do other work that does not overlap it, or end the turn with a short line; never wait for it with helper_list or helper_read.`,
        isError: false,
      };
    },
  });
}

function listTool(parts: AgentToolParts, helpers: HelperToolParts): AgentTool {
  return defineTool({
    name: "helper_list",
    kind: "read",
    parallel: true,
    forHelpers: false,
    description: agentToolTexts.helper_list,
    args: z.strictObject({}),
    run: async (_args, { signal }) => {
      const listed = await helpers.desk.list(parts.agent, signal);
      const nowMs = helpers.clock.now();
      const text =
        listed.length === 0
          ? "You have no helpers."
          : listed.map((helper) => helperLine(helper, nowMs)).join("\n");
      return { text, isError: false };
    },
  });
}

function readTool(parts: AgentToolParts, helpers: HelperToolParts): AgentTool {
  return defineTool({
    name: "helper_read",
    kind: "read",
    parallel: true,
    forHelpers: false,
    description: agentToolTexts.helper_read,
    args: helperArgs,
    run: async ({ helper }, { signal }) => {
      const reading = await helpers.desk.read({ agent: parts.agent, helper }, signal);
      return reading === undefined
        ? refusedHelper("not_found")
        : readingText(reading, helpers.clock.now());
    },
  });
}

function sendTool(parts: AgentToolParts, helpers: HelperToolParts): AgentTool {
  return defineTool({
    name: "helper_send",
    kind: "control",
    description: agentToolTexts.helper_send,
    args: sendArgs,
    run: async (args, { signal }) => {
      const sent = await helpers.desk.send({ ...args, agent: parts.agent }, signal);
      if (!sent.ok) {
        return refusedHelper(sent.error);
      }
      const { helper, queued } = sent.value;
      const when = queued ? "after its current run ends" : "now";
      return {
        text: `Sent the follow-up to helper "${helper.label}" (${helper.id}); it works on it ${when}. Its result arrives on its own in a later turn; do other work, or end the turn.`,
        isError: false,
      };
    },
  });
}

function stopTool(parts: AgentToolParts, helpers: HelperToolParts): AgentTool {
  return defineTool({
    name: "helper_stop",
    kind: "control",
    description: agentToolTexts.helper_stop,
    args: helperArgs,
    run: async ({ helper }, { signal }) => {
      const stopped = await helpers.desk.stop({ agent: parts.agent, helper }, signal);
      return stopped.ok
        ? {
            text: `Stopped helper "${stopped.value.label}" (${stopped.value.id}). What it did so far stays readable with helper_read.`,
            isError: false,
          }
        : refusedHelper(stopped.error);
    },
  });
}

/**
 * The helper tools (decision 0403): `helper_start` and `helper_send`, control tools that start a
 * run of a helper in the background and answer at once; `helper_list` and `helper_read`, reads of
 * the agent's helpers; and `helper_stop`. No helper may call any of them, so a helper never starts
 * another.
 */
export function helperTools(parts: AgentToolParts, helpers: HelperToolParts): readonly AgentTool[] {
  return [
    startTool(parts, helpers),
    listTool(parts, helpers),
    readTool(parts, helpers),
    sendTool(parts, helpers),
    stopTool(parts, helpers),
  ];
}
