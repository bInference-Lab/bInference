import { protocolIdSchema } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { chatEntries, type LiveLine, type TranscriptMessage } from "./chat-entries";

const session = protocolIdSchema("chatSession").parse("ses_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const turn = (n: number) =>
  protocolIdSchema("chatTurn").parse(`trn_0190f1c2-3a4b-7c5d-8e6f-${String(n).padStart(12, "0")}`);

function said(seq: number, role: "owner" | "agent", text: string): TranscriptMessage {
  return { session, turn: turn(1), seq, role, kind: "text", text, at: 1_000 + seq };
}

describe("chatEntries", () => {
  it("puts each status line after its turn's last message, and drops what the transcript holds", () => {
    const transcript = [said(1, "owner", "Buy CAKE"), said(2, "agent", "Opened a card")];
    const live: readonly LiveLine[] = [
      { kind: "owner", id: "o", turn: turn(1), text: "Buy CAKE", images: 0, at: 1_000 },
      { kind: "status", id: "s", turn: turn(1), statusKey: "turn.proposalWaits" },
      { kind: "answer", id: "a", turn: turn(1), text: "Opened a card" },
      { kind: "owner", id: "o2", turn: turn(2), text: "And BNB?", images: 1, at: 2_000 },
    ];
    expect(chatEntries(transcript, live)).toStrictEqual([
      { kind: "owner", id: "seq 1", text: "Buy CAKE" },
      { kind: "answer", id: "seq 2", text: "Opened a card" },
      { kind: "status", id: "s", statusKey: "turn.proposalWaits" },
      { kind: "owner", id: "o2", text: "And BNB?", images: 1 },
    ]);
  });

  it("leaves out tool calls and images, and shows live lines in the order they came", () => {
    const tool: TranscriptMessage = {
      session,
      seq: 2,
      role: "tool",
      kind: "tool_call",
      text: "swap {}",
      at: 1,
    };
    const live: readonly LiveLine[] = [
      { kind: "status", id: "s", turn: turn(3), statusKey: "turn.stopped" },
      { kind: "answer", id: "a", turn: turn(3), text: "Done" },
    ];
    expect(
      chatEntries([said(1, "owner", "Hi"), tool], live).map((entry) => entry.id),
    ).toStrictEqual(["seq 1", "s", "a"]);
  });

  it("puts a chart after its turn's last message, as a status line goes", () => {
    const chart = {
      chartType: "pie" as const,
      title: "Holdings",
      segments: [{ label: "BNB", value: 1 }],
    };
    const live: readonly LiveLine[] = [
      { kind: "chart", id: "c", turn: turn(1), chart },
      { kind: "chart", id: "c2", turn: turn(4), chart },
    ];
    expect(chatEntries([said(1, "owner", "Show my holdings")], live)).toStrictEqual([
      { kind: "owner", id: "seq 1", text: "Show my holdings" },
      { kind: "chart", id: "c", chart },
      { kind: "chart", id: "c2", chart },
    ]);
  });

  it("puts the images the agent made after the last message of the turn that asked for them", () => {
    const images = [
      { image: "a1b2c3d4e5f60718", contentType: "image/png" as const, bytes: 70, path: "/w/a.png" },
    ];
    const live: readonly LiveLine[] = [{ kind: "images", id: "i", turn: turn(1), images }];
    expect(
      chatEntries([said(1, "owner", "Make a logo"), said(2, "agent", "Making it.")], live),
    ).toStrictEqual([
      { kind: "owner", id: "seq 1", text: "Make a logo" },
      { kind: "answer", id: "seq 2", text: "Making it." },
      { kind: "images", id: "i", images },
    ]);
  });
});
