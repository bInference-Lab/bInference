import { createHash } from "node:crypto";
import type { ResultOf } from "@binference/protocol";
import type { ButtonRows } from "../ingress/bot-calls.js";
import { chooseAgent } from "./agent-commands.js";
import { commandCallbackData } from "./command-callback.schema.js";
import { callOrSay, type CommandContext, type PressContext } from "./command-context.js";

type ModelList = ResultOf<"model/list">;

/**
 * A model's digest on its `/ai` button: the first 16 base64url characters of the SHA-256 of its
 * reference, so any reference fits Telegram's 64 bytes (decision 0204).
 */
export function modelDigest(model: string): string {
  return createHash("sha256").update(model, "utf8").digest("base64url").slice(0, 16);
}

// Every configured model once, in the order the config names them.
function distinctModels(list: ModelList): readonly string[] {
  return [...new Set(list.items.map((item) => item.model))];
}

function currentOf(list: ModelList, role: "main" | "fast"): string | undefined {
  return list.items.find((item) => item.role === role && item.current === true)?.model;
}

function aiReply(context: CommandContext, list: ModelList): string {
  const { words } = context;
  const none = words("cmd.ai.none");
  return [
    words("cmd.ai.main", { model: currentOf(list, "main") ?? none }),
    words("cmd.ai.fast", { model: currentOf(list, "fast") ?? none }),
    words("cmd.ai.tapToPick"),
  ].join("\n");
}

function aiButtons(list: ModelList): ButtonRows {
  return distinctModels(list).map((model) => [
    { text: model, data: commandCallbackData({ kind: "model", digest: modelDigest(model) }) },
  ]);
}

/**
 * `/ai`: the main and fast models the agent's next turn uses, and a button for each configured
 * model, read with `model/list` (spec 4, section 5).
 */
export async function runAi(context: CommandContext): Promise<void> {
  const agent = await chooseAgent(context);
  if (agent === undefined) {
    return;
  }
  const list = await callOrSay(context, "model/list", { agent: agent.id });
  if (list === undefined) {
    return;
  }
  if (list.items.length === 0) {
    await context.say(context.words("cmd.ai.noModels"));
    return;
  }
  await context.say(aiReply(context, list), { buttons: aiButtons(list) });
}

/**
 * A press of an `/ai` button: finds the configured model whose digest the button carries, as the
 * config names models now, and sets it for the agent's `main` role with `model/set`, which takes
 * effect from the agent's next turn. The message then shows the models in use again. A digest no
 * configured model has changes nothing and says so.
 */
export async function runPickModel(context: PressContext, digest: string): Promise<void> {
  const agent = await chooseAgent(context);
  const list =
    agent === undefined ? undefined : await callOrSay(context, "model/list", { agent: agent.id });
  const model =
    list === undefined
      ? undefined
      : distinctModels(list).find((each) => modelDigest(each) === digest);
  if (agent === undefined || model === undefined) {
    await context.answer(list === undefined ? undefined : context.words("cmd.ai.gone"));
    return;
  }
  const set = await callOrSay(context, "model/set", { agent: agent.id, role: "main", model });
  if (set === undefined) {
    await context.answer();
    return;
  }
  await context.edit(aiReply(context, set), aiButtons(set));
  await context.answer(context.words("cmd.ai.set", { model }));
}
