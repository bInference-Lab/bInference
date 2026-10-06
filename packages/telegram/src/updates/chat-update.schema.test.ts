import { describe, expect, it } from "vitest";
import { ownerId, pressUpdate, textUpdate } from "../testing/update-fixtures.js";
import { chatUpdateSchema } from "./chat-update.schema.js";

describe("chatUpdateSchema", () => {
  it("reads a private text message into a chat post", () => {
    const update = textUpdate({ updateId: 7, from: ownerId, text: "hi", languageCode: "zh-hans" });
    expect(chatUpdateSchema.parse(update)).toStrictEqual({
      kind: "message",
      updateId: 7,
      messageId: 507,
      chatId: ownerId,
      chatType: "private",
      sender: { id: ownerId, isBot: false, languageCode: "zh-hans" },
      hasSenderChat: false,
      isViaBot: false,
      isForwarded: false,
      text: "hi",
    });
  });

  it("reads an edit, a forward, a caption, a topic and posts on behalf of a chat", () => {
    const edit = chatUpdateSchema.parse(
      textUpdate({ updateId: 8, from: ownerId, text: "x", isEdit: true, isForwarded: true }),
    );
    expect(edit).toMatchObject({ kind: "edit", isForwarded: true });
    const captioned = chatUpdateSchema.parse({
      update_id: 9,
      message: {
        message_id: 1,
        chat: { id: -100, type: "supergroup" },
        sender_chat: { id: -100, type: "supergroup" },
        via_bot: { id: 1, is_bot: true, first_name: "Other" },
        is_automatic_forward: true,
        message_thread_id: 4,
        caption: "a picture",
      },
    });
    expect(captioned).toStrictEqual({
      kind: "message",
      updateId: 9,
      messageId: 1,
      chatId: -100,
      chatType: "supergroup",
      threadId: 4,
      hasSenderChat: true,
      isViaBot: true,
      isForwarded: true,
      text: "a picture",
    });
  });

  it("reads a button press with the chat its message sits in", () => {
    expect(chatUpdateSchema.parse(pressUpdate(10, ownerId, "bnf1:c:y:abc"))).toStrictEqual({
      kind: "callback",
      updateId: 10,
      callbackId: "press-10",
      sender: { id: ownerId, isBot: false },
      data: "bnf1:c:y:abc",
      chatId: ownerId,
      chatType: "private",
      messageId: 900,
    });
  });

  it("makes an update it cannot read an other one, and needs a whole update_id", () => {
    expect(chatUpdateSchema.parse({ update_id: 11, message: { text: "no chat" } })).toStrictEqual({
      kind: "other",
      updateId: 11,
    });
    expect(chatUpdateSchema.parse({ update_id: 12, my_chat_member: {} })).toStrictEqual({
      kind: "other",
      updateId: 12,
    });
    expect(chatUpdateSchema.safeParse({ update_id: 1.5 }).success).toBe(false);
    expect(chatUpdateSchema.safeParse({ message: {} }).success).toBe(false);
  });
});
