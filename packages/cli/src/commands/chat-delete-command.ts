import { jsonValueSchema } from "@binference/core";
import { operations } from "@binference/protocol";
import { z } from "zod";
import type { AgentFlags } from "../program/cli-flags.schema.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { withEngine } from "./connect-engine.js";
import { isTypedConfirmed } from "./typed-confirmation.js";

/**
 * `binference chat delete` (decision 0415): deletes the chats of the agent `--agent` names, or of
 * every agent not archived, through `chat/delete`, once the person at the terminal typed the
 * phrase its plan asks for, or with `--yes`. The plan and the answer say what goes, what stays and
 * that backups made before still hold the chats. With `--json` it prints the counts as the
 * operation answers them. Exits 1 when nobody confirmed or the engine refused, such as
 * `chat.needs_runtime` while the agent runtime is down.
 */
export async function runChatDelete(run: CommandRun, options: AgentFlags): Promise<ExitCode> {
  const { host, output } = run;
  const { agent } = options;
  const plan = {
    area: "chatDelete",
    planKey: "chatDelete.plan",
    values: { which: agent === undefined ? "every" : "one", agent: agent ?? "" },
  } as const;
  if (!(await isTypedConfirmed(run, options, plan))) {
    return 1;
  }
  return withEngine(host, output, async (client, signal) => {
    const deleted = await client.call("chat/delete", agent === undefined ? {} : { agent }, {
      signal,
    });
    output.json(jsonValueSchema.parse(z.encode(operations["chat/delete"].result, deleted)));
    output.say("chatDelete.done", {
      agents: deleted.agents.length,
      sessions: deleted.sessions,
      events: deleted.events,
      turns: deleted.turns,
      questions: deleted.questions,
      goals: deleted.goals,
      progressNotes: deleted.progressNotes,
      helpers: deleted.helpers,
    });
    return 0;
  });
}
