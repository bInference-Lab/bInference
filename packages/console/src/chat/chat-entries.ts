import type { ResultOf } from "@binference/protocol";

/** One message of the agent's transcript, as `chat/messages` reads it. */
export type TranscriptMessage = ResultOf<"chat/messages">["items"][number];

/** One entry of the chat as the console draws it, in order. */
export interface ChatEntry {
  readonly kind: "owner" | "answer";
  readonly id: string;
  readonly text: string;
}

/** The chat in order: the transcript's text messages of the owner and the agent. */
export function chatEntries(transcript: readonly TranscriptMessage[]): readonly ChatEntry[] {
  return transcript
    .filter(
      (message) =>
        message.kind === "text" && (message.role === "owner" || message.role === "agent"),
    )
    .map((message) => ({
      kind: message.role === "owner" ? "owner" : "answer",
      id: `seq ${String(message.seq)}`,
      text: message.text ?? "",
    }));
}
