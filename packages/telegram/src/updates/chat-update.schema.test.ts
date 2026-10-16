import { describe, expect, it } from "vitest";
import { ownerId, photoUpdate, pressUpdate, textUpdate } from "../testing/update-fixtures.js";
import { chatUpdateSchema } from "./chat-update.schema.js";

// A message with a document of this MIME type, as Telegram sends an uncompressed image.
function documentUpdate(mimeType: string) {
  return {
    update_id: 15,
    message: {
      message_id: 515,
      date: 1_760_000_000,
      chat: { id: ownerId, type: "private" },
      from: { id: ownerId, is_bot: false, first_name: "Fixture" },
      caption: "the full chart",
      document: { file_id: "BQACdoc1", file_unique_id: "u1", mime_type: mimeType, file_size: 900 },
    },
  };
}

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

  it("reads a photo by its largest size, with its caption and its album", () => {
    const update = photoUpdate({
      updateId: 13,
      from: ownerId,
      fileId: "AgACAgIAAx0Cphoto1",
      sizeBytes: 180_000,
      caption: "this chart",
      albumId: "album-1",
    });
    expect(chatUpdateSchema.parse(update)).toMatchObject({
      kind: "message",
      text: "this chart",
      photo: { fileId: "AgACAgIAAx0Cphoto1", sizeBytes: 180_000 },
      albumId: "album-1",
    });
  });

  it("reads a photo whose size Telegram leaves out", () => {
    const update = photoUpdate({ updateId: 14, from: ownerId, fileId: "AgACphoto2" });
    expect(chatUpdateSchema.parse(update)).toMatchObject({ photo: { fileId: "AgACphoto2" } });
    expect(chatUpdateSchema.parse(update)).not.toHaveProperty("photo.sizeBytes");
  });

  it("reads a PNG, JPEG or WebP document as a photo, and no other document", () => {
    expect(chatUpdateSchema.parse(documentUpdate("image/webp"))).toMatchObject({
      text: "the full chart",
      photo: { fileId: "BQACdoc1", sizeBytes: 900 },
    });
    expect(chatUpdateSchema.parse(documentUpdate("application/pdf"))).not.toHaveProperty("photo");
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
