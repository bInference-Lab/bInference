import { displayOutsideText } from "@binference/i18n";
import type { ShellAnswer, ShellRequestClosedPush, ShellRequestView } from "@binference/protocol";
import { callOptions, type ChatContext } from "./chat-context.js";
import { failureText } from "./chat-lines.js";
import type { ScreenLine } from "./chat-screen.js";
import { withoutShellRequest } from "./chat-state.js";

/** The agent's open shell request in the chat: shown once it opens, answered by a number key. */
export interface ShellRequestEntry {
  /** Reads the agent's open request with `shell/requests`, and prints it when it is new. */
  reload(): Promise<void>;
  /** Prints how the shown request ended, and takes it off the live area. */
  closed(push: ShellRequestClosedPush): void;
  /** Answers the open request with the answer at `place` of its keys, through `shell/answer`. */
  answer(place: number): Promise<void>;
}

// The command a request shows: every character a reader cannot see written out.
const commandCharacters = 3_000;

/** The answers a request's number keys give, in order: Always allow only where it is offered. */
export function shellAnswersOf(request: ShellRequestView): readonly ShellAnswer[] {
  return request.canAlwaysAllow ? ["once", "always", "refuse"] : ["once", "refuse"];
}

// A request as the chat prints it: who asks, the command, its folder, why and until when.
function requestLines(context: ChatContext, request: ShellRequestView): readonly ScreenLine[] {
  const { words, formatter, agentName } = context;
  const command = displayOutsideText(request.command, commandCharacters);
  return [
    { text: words("shell.request.header", { agent: agentName }), tone: "bold" },
    { text: command, tone: "yellow" },
    { text: words("shell.request.folder", { folder: request.folder }) },
    { text: words("shell.request.reason", { reason: request.reason }) },
    ...(request.canAlwaysAllow ? [] : [{ text: words("shell.request.noAlways") }]),
    { text: words("shell.request.until", { time: formatter.time(request.closesAt) }), tone: "dim" },
  ];
}

function isClosedRefusal(error: ErrorOptions["cause"]): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "shell.request_closed"
  );
}

/**
 * The agent's shell request in terminal chat (decision 0409): read when the chat opens, at each
 * request push and after a gap in the agent's chat topic. A new request prints its lines; the live
 * area shows its number keys until it closes, and the line that says how it closed prints then.
 */
export function createShellRequestEntry(context: ChatContext): ShellRequestEntry {
  const { client, agent, words, store, print } = context;
  return {
    reload: async () => {
      const { items } = await client.call("shell/requests", { agent }, callOptions(context));
      const [request] = items;
      if (request?.request === store.get().shellRequest?.request) {
        return;
      }
      if (request !== undefined) {
        print(requestLines(context, request));
      }
      store.update((state) =>
        request === undefined ? withoutShellRequest(state) : { ...state, shellRequest: request },
      );
    },
    closed: (push) => {
      if (store.get().shellRequest?.request !== push.request) {
        return;
      }
      print([{ text: words("shell.request.closed", { outcome: push.outcome }), tone: "dim" }]);
      store.update(withoutShellRequest);
    },
    answer: async (place) => {
      const request = store.get().shellRequest;
      const answer = request === undefined ? undefined : shellAnswersOf(request)[place];
      if (request === undefined || answer === undefined) {
        return;
      }
      try {
        await client.call(
          "shell/answer",
          { request: request.request, answer },
          callOptions(context),
        );
      } catch (error) {
        const text = isClosedRefusal(error)
          ? words("shell.request.closedToast")
          : failureText(words, error);
        print([{ text, tone: "dim" }]);
      }
    },
  };
}
