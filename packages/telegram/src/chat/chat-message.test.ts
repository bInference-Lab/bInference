import { describe, expect, it } from "vitest";
import type { ChatPost } from "../updates/chat-update.schema.js";
import { chatMessageOf, maxPhotoBytes } from "./chat-message.js";

const base = {
  kind: "message",
  updateId: 1,
  messageId: 501,
  chatId: 7,
  chatType: "private",
  hasSenderChat: false,
  isViaBot: false,
  isForwarded: false,
} as const;

function textPost(text: string): ChatPost {
  return { ...base, text };
}

function photoPost(fileId: string, sizeBytes?: number, caption?: string): ChatPost {
  const size = sizeBytes === undefined ? {} : { sizeBytes };
  return {
    ...base,
    photo: { fileId, ...size },
    ...(caption === undefined ? {} : { text: caption }),
  };
}

describe("chatMessageOf", () => {
  it("joins pasted parts a line apart, in the order they came", () => {
    expect(chatMessageOf([textPost("first half"), textPost("second half")])).toStrictEqual({
      text: "first half\nsecond half",
      images: [],
      leftOut: 0,
      tooLarge: 0,
    });
  });

  it("carries an album's photos and its caption", () => {
    const album = [photoPost("p1", 1_000, "these charts"), photoPost("p2"), photoPost("p3")];
    expect(chatMessageOf(album)).toStrictEqual({
      text: "these charts",
      images: ["tg:p1", "tg:p2", "tg:p3"],
      leftOut: 0,
      tooLarge: 0,
    });
  });

  it("keeps the first four photos and counts the rest as left out", () => {
    const six = ["p1", "p2", "p3", "p4", "p5", "p6"].map((id) => photoPost(id));
    expect(chatMessageOf(six)).toMatchObject({
      images: ["tg:p1", "tg:p2", "tg:p3", "tg:p4"],
      leftOut: 2,
      tooLarge: 0,
    });
  });

  it("leaves out a photo over 5 MiB, and lets the next one take its place", () => {
    const posts = [
      photoPost("big", maxPhotoBytes + 1),
      ...["p1", "p2", "p3", "p4"].map((id) => photoPost(id, maxPhotoBytes)),
    ];
    expect(chatMessageOf(posts)).toMatchObject({
      images: ["tg:p1", "tg:p2", "tg:p3", "tg:p4"],
      leftOut: 0,
      tooLarge: 1,
    });
  });

  it("counts a photo whose id does not fit an image name as left out", () => {
    expect(chatMessageOf([photoPost("a".repeat(126)), photoPost("x/y")])).toMatchObject({
      images: [],
      leftOut: 2,
    });
  });
});
