import { describe, expect, it } from "vitest";
import { chatPushOf } from "./chat-push.schema.js";

const at = { agent: "agt_1", turn: "trn_1" };

describe("chatPushOf", () => {
  it("reads a progress line with its key and values", () => {
    const data = { ...at, progressKey: "turn.tool.plugin", values: { plugin: "fear_index" } };
    expect(chatPushOf({ kind: "chat/progress", data })).toStrictEqual({
      kind: "chat/progress",
      ...data,
    });
  });

  it("reads a draft as a message that is not final", () => {
    const data = { ...at, session: "ses_1", text: "Checking", final: false };
    expect(chatPushOf({ kind: "chat/message", data })).toStrictEqual({
      kind: "chat/message",
      ...at,
      text: "Checking",
      final: false,
    });
  });

  it("reads no progress line without its key", () => {
    expect(chatPushOf({ kind: "chat/progress", data: at })).toBeUndefined();
  });
});
