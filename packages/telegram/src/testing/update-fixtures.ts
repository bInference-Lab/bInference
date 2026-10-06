import type { JsonValue } from "@binference/core";

/** The owner's numeric Telegram id in tests. */
export const ownerId = 7_100_000_001;

/** A chat message for {@link textUpdate}. */
export interface TextFixture {
  readonly updateId: number;
  readonly from: number;
  readonly text: string;
  readonly messageId?: number;
  readonly chatId?: number;
  readonly chatType?: string;
  readonly languageCode?: string;
  readonly isEdit?: boolean;
  readonly isForwarded?: boolean;
  readonly isBot?: boolean;
}

/** A text message in the Bot API's shape, by default in the sender's private chat. */
export function textUpdate(fixture: TextFixture): JsonValue {
  const from = {
    id: fixture.from,
    is_bot: fixture.isBot ?? false,
    first_name: "Fixture",
    ...(fixture.languageCode === undefined ? {} : { language_code: fixture.languageCode }),
  };
  const posted = {
    message_id: fixture.messageId ?? fixture.updateId + 500,
    date: 1_760_000_000,
    chat: { id: fixture.chatId ?? fixture.from, type: fixture.chatType ?? "private" },
    from,
    text: fixture.text,
    ...(fixture.isForwarded === true ? { forward_origin: { type: "hidden_user", date: 1 } } : {}),
  };
  return fixture.isEdit === true
    ? { update_id: fixture.updateId, edited_message: { ...posted, edit_date: 1_760_000_001 } }
    : { update_id: fixture.updateId, message: posted };
}

/** An inline button press in the Bot API's shape, on a message in the sender's private chat. */
export function pressUpdate(updateId: number, from: number, data: string): JsonValue {
  return {
    update_id: updateId,
    callback_query: {
      id: `press-${String(updateId)}`,
      from: { id: from, is_bot: false, first_name: "Fixture" },
      chat_instance: "1",
      data,
      message: { message_id: 900, date: 1_760_000_000, chat: { id: from, type: "private" } },
    },
  };
}
