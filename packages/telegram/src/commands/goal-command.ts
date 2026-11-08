import { goalLines, progressNoteLines } from "@binference/i18n";
import { goalCommandOf } from "@binference/protocol";
import { chooseAgent } from "./agent-commands.js";
import { callOrSay, type CommandContext } from "./command-context.js";

/**
 * `/goal` (decision 0407): with no words, the chat's goal and progress note, read with `goal/get`;
 * `/goal <objective>` sets the goal with `goal/set`; `/goal pause`, `/goal resume` and `/goal
 * clear` change it with `goal/change`. A change shows as the status line the engine's `chat/goal`
 * push brings, so the command says nothing more once it was taken.
 */
export async function runGoal(context: CommandContext): Promise<void> {
  const agent = await chooseAgent(context);
  if (agent === undefined) {
    return;
  }
  const asked = goalCommandOf(context.args);
  if (asked.ask === "set") {
    await callOrSay(context, "goal/set", { agent: agent.id, objective: asked.objective });
    return;
  }
  if (asked.ask !== "status") {
    await callOrSay(context, "goal/change", { agent: agent.id, action: asked.ask });
    return;
  }
  const read = await callOrSay(context, "goal/get", { agent: agent.id });
  if (read === undefined) {
    return;
  }
  const note =
    read.note === undefined ? [] : ["", ...progressNoteLines(read.note, context.formatter)];
  await context.say([...goalLines(read.goal, context.formatter), ...note].join("\n"));
}
