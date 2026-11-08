import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { type Empty, emptyResultSchema } from "../values/empty.schema.js";
import { type ChatSurface, chatSurfaceSchema } from "../views/inbox-message-view.schema.js";
import { readFlags, type OperationTable } from "./operation.schema.js";

/** What a made medium is: a video the agent made, or its words spoken (decision 0405). */
export type MediaKind = "video" | "voice";

/** The formats of the media the agent makes: an MP4 video, or speech as Ogg, MP3 or M4A. */
export type MediaContentType = "video/mp4" | "audio/ogg" | "audio/mpeg" | "audio/mp4";

/** The most bytes of a medium one part carries, in and out: 512 KiB. */
export const mediaPartBytes: number = 512 * 1024;

/** The largest video the agent keeps: 100 MiB (decision 0405). */
export const maxVideoBytes: number = 100 * 1024 * 1024;

/** The largest speech the agent keeps: 20 MiB (decision 0405). */
export const maxVoiceBytes: number = 20 * 1024 * 1024;

/** The most characters of a prompt the agent makes a video with, as the gateway takes it. */
export const maxVideoPromptChars: number = 2_000;

/** The most characters the agent speaks in one call (decision 0405). */
export const maxSpeechChars: number = 4_000;

/** A made medium, as `media/store` saves it and `chat/media` names it (decision 0405). */
export interface MediaView {
  /** Its id, which `media/read` reads it by. */
  readonly media: string;
  readonly kind: MediaKind;
  readonly contentType: MediaContentType;
  readonly bytes: number;
  /** Where it was saved, in the agent's workspace. */
  readonly path: string;
}

/**
 * The args of `media/store`: one part of a video or speech the agent's runtime made, from
 * `offset`, of a medium `total` bytes long; the runtime's job id is the same for every part.
 */
interface StoreMediaArgs {
  readonly agent: ProtocolId<"agent">;
  readonly job: string;
  readonly kind: MediaKind;
  readonly offset: number;
  readonly total: number;
  /** The part's bytes in base64, at most 512 KiB of them. */
  readonly data: string;
}

/** The answer of `media/store`: once the last part arrived, the saved medium. */
interface StoredMediaPart {
  readonly media?: MediaView;
}

/**
 * The args of `media/made`: the end of a video job, its video by the id `media/store` answered or
 * why it failed, and the turn and surface it was asked for in.
 */
interface MadeVideoArgs {
  readonly agent: ProtocolId<"agent">;
  readonly session: ProtocolId<"chatSession">;
  readonly turn: ProtocolId<"chatTurn">;
  readonly surface: ChatSurface;
  readonly prompt: string;
  readonly media?: string;
  /** Why the job made no video, in a line the agent reads. */
  readonly failed?: string;
}

/** The args of `media/send`: a saved medium the agent sends the owner in the chat of its turn. */
interface SendMediaArgs {
  readonly agent: ProtocolId<"agent">;
  readonly turn: ProtocolId<"chatTurn">;
  readonly media: string;
}

/** The args of `speech/local`: words the engine's machine speaks with its own voice. */
interface LocalSpeechArgs {
  readonly agent: ProtocolId<"agent">;
  readonly text: string;
  /** One of the machine's voices, by its name; the machine's default when absent. */
  readonly voice?: string;
}

/** The args of `media/read`: one part of a made medium, by its id, from `offset`. */
interface ReadMediaArgs {
  readonly agent: ProtocolId<"agent">;
  readonly media: string;
  readonly offset?: number;
}

/** One part of a made medium: at most {@link mediaPartBytes} of it, in base64. */
export interface MediaPart {
  readonly contentType: MediaContentType;
  /** The whole medium's size in bytes. */
  readonly bytes: number;
  readonly offset: number;
  readonly data: string;
  /** Where the next part starts; absent on the last part. */
  readonly next?: number;
}

/** The operations of the videos and speech the agent makes (decision 0405). */
export interface MediaOperationShapes {
  readonly "media/store": { readonly args: StoreMediaArgs; readonly result: StoredMediaPart };
  readonly "media/made": { readonly args: MadeVideoArgs; readonly result: Empty };
  readonly "media/send": { readonly args: SendMediaArgs; readonly result: Empty };
  readonly "media/read": { readonly args: ReadMediaArgs; readonly result: MediaPart };
  readonly "speech/local": { readonly args: LocalSpeechArgs; readonly result: StoredMediaPart };
}

const mediaId = z.string().regex(/^[a-z0-9]{8,64}$/u);
const byteCount = z.int().nonnegative().max(maxVideoBytes);
// A part's base64 text: 4 characters for each 3 bytes, padded.
const maxPartText = Math.ceil(mediaPartBytes / 3) * 4;

/** Parses a kind of made medium. */
export const mediaKindSchema: z.ZodType<MediaKind> = z.enum(["video", "voice"]);

/** Parses a format of a made medium. */
export const mediaContentTypeSchema: z.ZodType<MediaContentType> = z.enum([
  "video/mp4",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
]);

/** Parses a made medium, as `media/store` answers it and `chat/media` names it. */
export const mediaViewSchema: z.ZodType<MediaView> = z.object({
  media: mediaId,
  kind: mediaKindSchema,
  contentType: mediaContentTypeSchema,
  bytes: byteCount.min(1),
  path: z.string().min(1).max(4_096),
});

/**
 * Parses the name of one of the machine's voices: letters, digits, spaces and `._()'-`, never a
 * leading `-`, at most 64 characters.
 */
export const voiceNameSchema: z.ZodType<string> = z
  .string()
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} ._()'-]{0,63}$/u);

const storedSchema: z.ZodType<StoredMediaPart> = z.object({
  media: mediaViewSchema.exactOptional(),
});

/** The media operations, by name. */
export const mediaOperations: OperationTable<MediaOperationShapes> = {
  "media/store": {
    ...readFlags,
    name: "media/store",
    scope: "agent",
    args: z
      .strictObject({
        agent: protocolIdSchema("agent"),
        job: mediaId,
        kind: mediaKindSchema,
        offset: byteCount,
        total: byteCount.min(1),
        data: z.base64().min(1).max(maxPartText),
      })
      .refine((args) => args.offset < args.total, { message: "The part starts past the medium." }),
    result: storedSchema,
  },
  "media/made": {
    ...readFlags,
    name: "media/made",
    scope: "agent",
    args: z.strictObject({
      agent: protocolIdSchema("agent"),
      session: protocolIdSchema("chatSession"),
      turn: protocolIdSchema("chatTurn"),
      surface: chatSurfaceSchema,
      prompt: z.string().trim().min(1).max(maxVideoPromptChars),
      media: mediaId.exactOptional(),
      failed: z.string().trim().min(1).max(500).exactOptional(),
    }),
    result: emptyResultSchema,
  },
  "media/send": {
    ...readFlags,
    name: "media/send",
    scope: "agent",
    args: z.strictObject({
      agent: protocolIdSchema("agent"),
      turn: protocolIdSchema("chatTurn"),
      media: mediaId,
    }),
    result: emptyResultSchema,
  },
  "media/read": {
    ...readFlags,
    name: "media/read",
    scope: "read",
    args: z.strictObject({
      agent: protocolIdSchema("agent"),
      media: mediaId,
      offset: byteCount.exactOptional(),
    }),
    result: z.object({
      contentType: mediaContentTypeSchema,
      bytes: byteCount,
      offset: byteCount,
      data: z.base64().max(maxPartText),
      next: byteCount.exactOptional(),
    }),
  },
  "speech/local": {
    ...readFlags,
    name: "speech/local",
    scope: "agent",
    args: z.strictObject({
      agent: protocolIdSchema("agent"),
      text: z.string().trim().min(1).max(maxSpeechChars),
      voice: voiceNameSchema.exactOptional(),
    }),
    result: storedSchema,
  },
};
