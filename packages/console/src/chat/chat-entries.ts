import type { ResultOf } from "@binference/protocol";

/** One message of the agent's transcript, as `chat/messages` reads it. */
export type TranscriptMessage = ResultOf<"chat/messages">["items"][number];

/** What the console heard on the chat topic, or sent itself, since the page opened. */
export type LiveLine =
  | {
      readonly kind: "owner";
      readonly id: string;
      readonly turn: string;
      readonly text: string;
      readonly images: number;
      readonly at: number;
    }
  | { readonly kind: "answer"; readonly id: string; readonly turn: string; readonly text: string }
  | {
      readonly kind: "status";
      readonly id: string;
      readonly turn: string;
      readonly statusKey: string;
      readonly values?: Readonly<Record<string, string | number>>;
    };

/** One entry of the chat as the console draws it, in order. */
export type ChatEntry =
  | {
      readonly kind: "owner" | "answer";
      readonly id: string;
      readonly text: string;
      readonly images?: number;
    }
  | {
      readonly kind: "status";
      readonly id: string;
      readonly statusKey: string;
      readonly values?: Readonly<Record<string, string | number>>;
    };

// How far the engine's clock may run behind the browser's while an owner's message is matched to
// its copy in the transcript.
const skewMs = 60_000;

function entryOf(line: LiveLine): ChatEntry {
  if (line.kind === "status") {
    const { id, statusKey, values } = line;
    return { kind: "status", id, statusKey, ...(values === undefined ? {} : { values }) };
  }
  return line.kind === "owner"
    ? { kind: "owner", id: line.id, text: line.text, images: line.images }
    : { kind: "answer", id: line.id, text: line.text };
}

// The owner's messages this page sent that the transcript holds now, each matched once by its
// text, oldest first.
function heardOwnerLines(
  transcript: readonly TranscriptMessage[],
  live: readonly LiveLine[],
): ReadonlySet<string> {
  const unmatched = transcript.filter((message) => message.role === "owner");
  const heard = new Set<string>();
  live.forEach((line) => {
    if (line.kind !== "owner") {
      return;
    }
    const at = unmatched.findIndex(
      (message) => message.text === line.text && message.at >= line.at - skewMs,
    );
    if (at >= 0) {
      heard.add(line.id);
      unmatched.splice(at, 1);
    }
  });
  return heard;
}

/**
 * The chat in order: the transcript's text messages of the owner and the agent, each status line
 * after the last message of its turn, then what the page heard or sent that the transcript does
 * not hold yet, in the order it came. An answer leaves the live lines once its turn's answer is in
 * the transcript, and an owner's message once its text is.
 */
export function chatEntries(
  transcript: readonly TranscriptMessage[],
  live: readonly LiveLine[],
): readonly ChatEntry[] {
  const said = transcript.filter(
    (message) => message.kind === "text" && (message.role === "owner" || message.role === "agent"),
  );
  const answered = new Set<string>(
    said.flatMap((message) =>
      message.role === "agent" && message.turn !== undefined ? [message.turn] : [],
    ),
  );
  const turnsShown = new Set<string>(
    said.flatMap((message) => (message.turn === undefined ? [] : [message.turn])),
  );
  const heard = heardOwnerLines(said, live);
  const lastOfTurn = new Map(said.map((message) => [message.turn, message.seq]));
  const placed = live.filter((line) => line.kind === "status" && turnsShown.has(line.turn));
  const entries: ChatEntry[] = [];
  said.forEach((message) => {
    entries.push({
      kind: message.role === "owner" ? "owner" : "answer",
      id: `seq ${String(message.seq)}`,
      text: message.text ?? "",
    });
    if (message.turn !== undefined && lastOfTurn.get(message.turn) === message.seq) {
      entries.push(...placed.filter((line) => line.turn === message.turn).map(entryOf));
    }
  });
  const rest = live.filter(
    (line) =>
      !placed.includes(line) &&
      !heard.has(line.id) &&
      !(line.kind === "answer" && answered.has(line.turn)),
  );
  return [...entries, ...rest.map(entryOf)];
}
