import { err, type JsonValue, type Result } from "@binference/core";
import { z } from "zod";
import type { FakeFileKind } from "./fake-files.js";
import { uploadPrefix } from "./fake-uploads.js";

/** A file the bot sent, as a photo or a document: again by its id, or uploaded with its bytes. */
export interface FakeSentFile {
  readonly kind: FakeFileKind;
  /** The file's id, or `uploaded` for a file the bot uploaded. */
  readonly fileId: string;
  /** An uploaded file's bytes. */
  readonly bytes?: Uint8Array;
}

/** A file send the fake took, for the chat to keep as a message. */
export interface SentFile {
  readonly chatId: number;
  readonly file: FakeSentFile;
  readonly replyTo?: number;
  /** The caption and its parse mode, which the chat reads as a message's text. */
  readonly caption?: { readonly text: string; readonly parseMode?: string };
}

/** What a file send reads and keeps through: the bot's files, and the chat's messages. */
interface FileSendParts {
  /** What the bot's files are held as, by id; `undefined` for one it never received. */
  readonly fileKindOf: (fileId: string) => FakeFileKind | undefined;
  /** Keeps the sent file as a message, and answers it as the Bot API does, or refuses its caption. */
  readonly keep: (sent: SentFile) => Result<JsonValue, string>;
}

const sendFileSchema = z.looseObject({
  chat_id: z.int(),
  photo: z.string().min(1).optional(),
  document: z.string().min(1).optional(),
  reply_parameters: z.looseObject({ message_id: z.int() }).optional(),
  caption: z.string().optional(),
  parse_mode: z.string().optional(),
});

// Telegram's longest caption, in characters after its HTML is read.
const maxCaptionLength = 1_024;

// A file the bot uploaded: Telegram takes any bytes it can read as the kind it was sent as.
function uploadedOf(kind: FakeFileKind, field: string): FakeSentFile | undefined {
  return field.startsWith(uploadPrefix)
    ? {
        kind,
        fileId: "uploaded",
        bytes: new Uint8Array(Buffer.from(field.slice(uploadPrefix.length), "base64")),
      }
    : undefined;
}

type SendFileCall = z.infer<typeof sendFileSchema>;

// The caption a send carries, or a refusal of one over Telegram's limit.
function captionOf(call: SendFileCall): Result<Pick<SentFile, "caption">, string> {
  const { caption, parse_mode: parseMode } = call;
  if (caption === undefined) {
    return { ok: true, value: {} };
  }
  if (caption.length > maxCaptionLength) {
    return err("Bad Request: message caption is too long");
  }
  const mode = parseMode === undefined ? {} : { parseMode };
  return { ok: true, value: { caption: { text: caption, ...mode } } };
}

// The file a send names: one it uploaded, or one the bot holds of the kind it was sent as.
function fileOf(
  parts: FileSendParts,
  kind: FakeFileKind,
  call: SendFileCall,
): Result<FakeSentFile, string> {
  const fileId = kind === "photo" ? call.photo : call.document;
  const uploaded = fileId === undefined ? undefined : uploadedOf(kind, fileId);
  if (uploaded !== undefined) {
    return { ok: true, value: uploaded };
  }
  const held = fileId === undefined ? undefined : parts.fileKindOf(fileId);
  if (fileId === undefined || held === undefined) {
    return err("Bad Request: wrong file identifier/HTTP URL specified");
  }
  return held === kind
    ? { ok: true, value: { kind, fileId } }
    : err("Bad Request: type of file mismatch");
}

/**
 * Answers `sendPhoto` or `sendDocument` of a file the bot uploaded, or one it holds sent again by
 * its id: Telegram refuses an id it does not hold, a document's id sent as a photo, or a photo's as
 * a document, and a caption over 1,024 characters.
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
  const file = fileOf(parts, kind, call.data);
  const caption = captionOf(call.data);
  if (!file.ok || !caption.ok) {
    return file.ok ? caption : file;
  }
  const replyTo = call.data.reply_parameters?.message_id;
  const reply = replyTo === undefined ? {} : { replyTo };
  return parts.keep({ chatId: call.data.chat_id, file: file.value, ...reply, ...caption.value });
}
