import type { JsonValue } from "@binference/core";
import { describe, expect, it } from "vitest";
import { ownerId, pressUpdate, textUpdate } from "../testing/update-fixtures.js";
import { chatUpdateSchema } from "../updates/chat-update.schema.js";
import { screenUpdate } from "./screen-update.js";

const phrase = "legal winner thank year wave sausage worth useful legal winner thank yellow";

function screen(raw: JsonValue): ReturnType<typeof screenUpdate> {
  return screenUpdate(raw, chatUpdateSchema.parse(raw));
}

describe("screenUpdate", () => {
  it("keeps an update with no secret as it came", () => {
    const raw = textUpdate({ updateId: 1, from: ownerId, text: "buy 0.1 BNB of CAKE" });
    expect(screen(raw)).toStrictEqual({ update: raw, isRedacted: false });
  });

  it("keeps only the ids and the sender of a message that holds a secret", () => {
    const raw = textUpdate({ updateId: 2, from: ownerId, text: phrase, languageCode: "en" });
    const stored = screen(raw);
    expect(stored).toStrictEqual({
      isRedacted: true,
      update: {
        update_id: 2,
        message: {
          message_id: 502,
          chat: { id: ownerId, type: "private" },
          from: { id: ownerId, is_bot: false, language_code: "en" },
        },
      },
    });
    expect(JSON.stringify(stored)).not.toContain("winner");
  });

  it("finds a secret anywhere in the update and keeps the facts the owner check reads", () => {
    const quoting = {
      update_id: 3,
      message: {
        message_id: 9,
        chat: { id: ownerId, type: "private" },
        from: { id: ownerId, is_bot: false },
        forward_origin: { type: "hidden_user", date: 1 },
        text: "look",
        quote: { text: phrase },
      },
    };
    const stored = screen(quoting);
    expect(stored.isRedacted).toBe(true);
    expect(chatUpdateSchema.parse(stored.update)).toMatchObject({
      kind: "message",
      isForwarded: true,
    });
    const edited = screen(textUpdate({ updateId: 4, from: ownerId, text: phrase, isEdit: true }));
    expect(chatUpdateSchema.parse(edited.update)).toMatchObject({ kind: "edit", messageId: 504 });
  });

  it("keeps a button press without its data, and an unknown update with its id alone", () => {
    const press = screen(pressUpdate(5, ownerId, phrase));
    expect(press.update).toStrictEqual({
      update_id: 5,
      callback_query: { id: "press-5", from: { id: ownerId, is_bot: false } },
    });
    expect(screen({ update_id: 6, poll: { question: phrase } }).update).toStrictEqual({
      update_id: 6,
    });
  });

  it("screens text nested deeper than it walks as one piece", () => {
    const deep = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].reduce<JsonValue>(
      (inner) => ({ inner }),
      phrase,
    );
    expect(screen({ update_id: 7, deep }).isRedacted).toBe(true);
  });
});
