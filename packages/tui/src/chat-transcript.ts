import type { ResultOf } from "@binference/protocol";
import { callOptions, type ChatContext } from "./chat-context.js";
import { failureText, saidLines } from "./chat-lines.js";

type TranscriptMessage = ResultOf<"chat/messages">["items"][number];

/** The said text of the agent's open session that the chat prints, and what it printed itself. */
export interface ChatTranscript {
  /**
   * Prints what the session holds past what the chat showed: the newest messages when the chat
   * opens or a new session starts, then the owner's messages from other surfaces and anything a
   * gap in the pushes missed. A session that cannot be read, as while the agent runtime is down,
   * prints why once and is read again at the next catch-up.
   */
  catchUp(): Promise<void>;
  /** Notes said text the chat printed itself, so a catch-up never prints it again. */
  printed(role: "owner" | "agent", turn: string): void;
  /** Forgets the session, as after the owner cleared the chat. */
  reset(): void;
}

// The newest messages the chat prints when it opens, and the most it reads of a session.
const openingMessages = 20;
// The most turns the chat remembers printing; the oldest are forgotten first, long after any read
// of the transcript could bring them back.
const mostPrintedTurns = 500;
const pageSize = 200;
const mostPages = 10;

async function readSession(context: ChatContext): Promise<readonly TranscriptMessage[]> {
  const read: TranscriptMessage[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < mostPages; page += 1) {
    const args = {
      agent: context.agent,
      limit: pageSize,
      ...(cursor === undefined ? {} : { cursor }),
    };
    // oxlint-disable-next-line eslint/no-await-in-loop -- each page reads on from the last
    const answer = await context.client.call("chat/messages", args, callOptions(context));
    read.push(...answer.items);
    cursor = answer.next;
    if (cursor === undefined) {
      break;
    }
  }
  return read;
}

function isSaid(message: TranscriptMessage): message is TranscriptMessage & {
  readonly role: "owner" | "agent";
} {
  return message.kind === "text" && (message.role === "owner" || message.role === "agent");
}

/**
 * The chat's view of the agent's transcript, read with `chat/messages` (it fails
 * `runtime.unavailable` while the agent runtime is down). Each message prints once, under the
 * owner's or the agent's name, oldest first.
 */
export function createChatTranscript(context: ChatContext, you: string): ChatTranscript {
  const printedTurns = new Set<string>();
  const state: { lastSeq: number | undefined; isReported: boolean } = {
    lastSeq: undefined,
    isReported: false,
  };
  const unread = (error: ErrorOptions["cause"]): undefined => {
    if (!state.isReported) {
      state.isReported = true;
      const reason = failureText(context.words, error);
      context.print([{ text: context.words("tui.historyFailed", { reason }), tone: "dim" }]);
    }
    return undefined;
  };
  const speaker = (role: "owner" | "agent"): string => (role === "owner" ? you : context.agentName);
  const isNew = (message: TranscriptMessage & { readonly role: "owner" | "agent" }): boolean =>
    message.seq > (state.lastSeq ?? -1) &&
    (message.turn === undefined || !printedTurns.has(`${message.role} ${message.turn}`));
  return {
    catchUp: async () => {
      const session = await readSession(context).catch(unread);
      if (session === undefined) {
        return;
      }
      const said = session.filter(isSaid).filter(isNew);
      const shown = state.lastSeq === undefined ? said.slice(-openingMessages) : said;
      state.lastSeq = Math.max(state.lastSeq ?? -1, ...session.map((message) => message.seq));
      context.print(
        shown.flatMap((message) => saidLines(speaker(message.role), message.text ?? "")),
      );
    },
    printed: (role, turn) => {
      printedTurns.add(`${role} ${turn}`);
      const [oldest] = printedTurns;
      if (printedTurns.size > mostPrintedTurns && oldest !== undefined) {
        printedTurns.delete(oldest);
      }
    },
    reset: () => {
      state.lastSeq = undefined;
      printedTurns.clear();
    },
  };
}
