import { err, type JsonValue, ok, type Result } from "@binference/core";
import { z } from "zod";
import type { FakeFileKind } from "./fake-files.js";

/** A file the bot sent again by its id, as a photo or a document. */
export interface FakeSentFile {
  readonly kind: FakeFileKind;
  readonly fileId: string;
}

/** A file send the fake took, for the chat to keep as a message. */
export interface SentFile {
  readonly chatId: number;
  readonly file: FakeSentFile;
  readonly replyTo?: number;
}

/** What a file send reads and keeps through: the bot's files, and the chat's messages. */
interface FileSendParts {
  /** What the bot's files are held as, by id; `undefined` for one it never received. */
  readonly fileKindOf: (fileId: string) => FakeFileKind | undefined;
  /** Keeps the sent file as a message, and answers it as the Bot API does. */
  readonly keep: (sent: SentFile) => JsonValue;
}

const sendFileSchema = z.looseObject({
  chat_id: z.int(),
  photo: z.string().min(1).optional(),
  document: z.string().min(1).optional(),
  reply_parameters: z.looseObject({ message_id: z.int() }).optional(),
});

/**
 * Answers `sendPhoto` or `sendDocument` of a file the bot holds, sent again by its id: Telegram
 * refuses an id it does not hold, and a document's id sent as a photo, or a photo's as a document.
 */
export function sendFile(
  parts: FileSendParts,
  kind: FakeFileKind,
  body: string,
): Result<JsonValue, string> {
  const call = sendFileSchema.safeParse(JSON.parse(body));
  if (!call.success) {
    return err("Bad Request: wrong parameters");
  }
  const fileId = kind === "photo" ? call.data.photo : call.data.document;
  const held = fileId === undefined ? undefined : parts.fileKindOf(fileId);
  if (fileId === undefined || held === undefined) {
    return err("Bad Request: wrong file identifier/HTTP URL specified");
  }
  if (held !== kind) {
    return err("Bad Request: type of file mismatch");
  }
  const replyTo = call.data.reply_parameters?.message_id;
  const reply = replyTo === undefined ? {} : { replyTo };
  return ok(parts.keep({ chatId: call.data.chat_id, file: { kind, fileId }, ...reply }));
}
