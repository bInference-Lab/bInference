import { displayOutsideText } from "@binference/i18n";
import type { ShellRequestOutcome, ShellRequestView } from "@binference/protocol";
import { escapeHtml } from "../format/escape-html.js";
import type { ButtonRows } from "../ingress/bot-calls.js";
import { shellRequestCallbackData } from "./shell-request-callback.schema.js";

/** The words of a shell request's message, in the owner's language. */
export type ShellWords = (key: string, values?: Readonly<Record<string, string>>) => string;

// The agent writes the command: every character a reader cannot see is written out.
const commandCharacters = 3_000;

function shownCommand(command: string): string {
  return displayOutsideText(command, commandCharacters);
}

/**
 * A shell request as Telegram HTML (spec 4, section 8.6): the header naming the agent, the command
 * in a code block, the folder, why it asks, that Always allow is not offered when it is not, and
 * until when it waits.
 */
export function shellRequestHtml(
  request: ShellRequestView,
  parts: { readonly words: ShellWords; readonly agent: string; readonly until: string },
): string {
  const { words, agent, until } = parts;
  return [
    `<b>${escapeHtml(words("shell.request.header", { agent }))}</b>`,
    `<pre>${escapeHtml(shownCommand(request.command))}</pre>`,
    escapeHtml(words("shell.request.folder", { folder: request.folder })),
    escapeHtml(words("shell.request.reason", { reason: request.reason })),
    ...(request.canAlwaysAllow ? [] : [escapeHtml(words("shell.request.noAlways"))]),
    `<i>${escapeHtml(words("shell.request.until", { time: until }))}</i>`,
  ].join("\n");
}

/** The plain text a request's message becomes once it closed: who asked, what, and how it ended. */
export function shellRequestClosedText(
  request: Pick<ShellRequestView, "command" | "folder">,
  parts: {
    readonly words: ShellWords;
    readonly agent: string;
    readonly outcome: ShellRequestOutcome;
  },
): string {
  const { words, agent, outcome } = parts;
  return [
    words("shell.request.header", { agent }),
    shownCommand(request.command),
    words("shell.request.folder", { folder: request.folder }),
    words("shell.request.closed", { outcome }),
  ].join("\n");
}

/** The buttons of an open request: Allow once, Always allow when offered, and Refuse. */
export function shellRequestButtons(request: ShellRequestView, words: ShellWords): ButtonRows {
  const id = request.request;
  const once = {
    text: words("shell.request.once"),
    data: shellRequestCallbackData({ answer: "once", request: id }),
  };
  const always = {
    text: words("shell.request.always"),
    data: shellRequestCallbackData({ answer: "always", request: id }),
  };
  const refuse = {
    text: words("shell.request.refuse"),
    data: shellRequestCallbackData({ answer: "refuse", request: id }),
  };
  return request.canAlwaysAllow ? [[once, always], [refuse]] : [[once, refuse]];
}
