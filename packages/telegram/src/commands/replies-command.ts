import type { OwnerChatPatch, ReasoningShown, ReplyStream } from "@binference/engine/surfaces";
import type { ReplySettings } from "../chat/chat-replies-options.js";
import type { ButtonRows } from "../ingress/bot-calls.js";
import { commandCallbackData, type ReplyChoice } from "./command-callback.schema.js";
import { callOrSay, type CommandContext, type PressContext } from "./command-context.js";

const streams: readonly ReplyStream[] = ["progress", "partial"];
const reasonings: readonly ReasoningShown[] = ["off", "streamed", "kept"];

// The settings as the reply names them, `off` for reasoning no file sets.
function shownOf(settings: ReplySettings): Required<ReplySettings> {
  return { stream: settings.stream, reasoning: settings.reasoning ?? "off" };
}

// One row for how replies grow, one for how reasoning shows; the setting in use is marked.
function buttonsOf(context: CommandContext, settings: Required<ReplySettings>): ButtonRows {
  const mark = (button: { readonly isOn: boolean; readonly text: string }): string =>
    button.isOn ? context.words("cmd.replies.chosen", { text: button.text }) : button.text;
  return [
    streams.map((stream) => ({
      text: mark({
        isOn: settings.stream === stream,
        text: context.words(`cmd.replies.stream.${stream}`),
      }),
      data: commandCallbackData({ kind: "replies", choice: { stream } }),
    })),
    reasonings.map((reasoning) => ({
      text: mark({
        isOn: settings.reasoning === reasoning,
        text: context.words(`cmd.replies.reasoning.${reasoning}`),
      }),
      data: commandCallbackData({ kind: "replies", choice: { reasoning } }),
    })),
  ];
}

function textOf(context: CommandContext, settings: Required<ReplySettings>): string {
  return context.words("cmd.replies.current", settings);
}

/**
 * `/replies`: how the agent's replies and the model's reasoning show in this chat (decisions 0376
 * and 0377), and a button for each choice.
 */
export async function runReplies(context: CommandContext): Promise<void> {
  const settings = shownOf(context.replies());
  await context.say(textOf(context, settings), { buttons: buttonsOf(context, settings) });
}

function patchOf(choice: ReplyChoice): OwnerChatPatch {
  return "stream" in choice
    ? { telegram: { replies: { stream: choice.stream } } }
    : { telegram: { replies: { reasoning: choice.reasoning } } };
}

/**
 * A press of a `/replies` button: sets that one key of `telegram.replies` through `config/change`
 * (decision 0377), which the live reload applies from the next turn; the choice in use changes
 * nothing.
 */
export async function runReplyChoice(context: PressContext, choice: ReplyChoice): Promise<void> {
  const before = shownOf(context.replies());
  const after = { ...before, ...choice };
  if (after.stream !== before.stream || after.reasoning !== before.reasoning) {
    if ((await callOrSay(context, "config/change", { patch: patchOf(choice) })) === undefined) {
      await context.answer();
      return;
    }
  }
  await context.edit(textOf(context, after), buttonsOf(context, after));
  await context.answer(context.words("cmd.replies.switched"));
}
