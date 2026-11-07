import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { maxSentFileBytes, maxSentFiles, sentFilePartBytes } from "./file-limits.js";
import { type OperationTable, readFlags } from "./operation.schema.js";

/**
 * The args of `file/send`: files on the engine's machine the agent sends the owner in the chat of
 * its turn, by their paths, with a line saying what they are (decision 0400).
 */
interface SendFilesArgs {
  readonly agent: ProtocolId<"agent">;
  readonly turn: ProtocolId<"chatTurn">;
  /** Absolute, `~/` under the owner's home folder, or relative to the agent's workspace. */
  readonly paths: readonly string[];
  readonly caption: string;
}

/** A file the agent sent, as `file/send` answers it and `chat/files` names it. */
export interface SentFileView {
  /** Its id, which `file/fetch` reads it by. */
  readonly file: string;
  /** Its name, the last part of its path. */
  readonly name: string;
  readonly bytes: number;
  /** Its absolute path on the engine's machine. */
  readonly path: string;
}

/** The answer of `file/send`: each file sent, in order. */
interface SentFiles {
  readonly files: readonly SentFileView[];
}

/** The args of `file/fetch`: one part of a file the agent sent, by its id, from `offset`. */
interface FetchFileArgs {
  readonly agent: ProtocolId<"agent">;
  readonly file: string;
  readonly offset?: number;
}

/** One part of a sent file: at most {@link sentFilePartBytes} of it, in base64. */
interface SentFilePart {
  readonly name: string;
  /** The whole file's size in bytes. */
  readonly bytes: number;
  readonly offset: number;
  readonly data: string;
  /** Where the next part starts; absent on the last part. */
  readonly next?: number;
}

/** The operations of the files the agent sends the owner (decision 0400). */
export interface SentFileOperationShapes {
  readonly "file/send": { readonly args: SendFilesArgs; readonly result: SentFiles };
  readonly "file/fetch": { readonly args: FetchFileArgs; readonly result: SentFilePart };
}

const sentFileId = z.string().regex(/^[a-z0-9]{8,64}$/u);
const byteCount = z.int().nonnegative().max(maxSentFileBytes);
// A part's base64 text: 4 characters for each 3 bytes, padded.
const maxPartText = Math.ceil(sentFilePartBytes / 3) * 4;

/** Parses a file the agent sent, as `file/send` answers it and `chat/files` names it. */
export const sentFileViewSchema: z.ZodType<SentFileView> = z.object({
  file: sentFileId,
  name: z.string().min(1).max(255),
  bytes: byteCount,
  path: z.string().min(1).max(4_096),
});

/** The sent file operations, by name. */
export const sentFileOperations: OperationTable<SentFileOperationShapes> = {
  "file/send": {
    ...readFlags,
    name: "file/send",
    scope: "agent",
    args: z.strictObject({
      agent: protocolIdSchema("agent"),
      turn: protocolIdSchema("chatTurn"),
      paths: z.array(z.string().min(1).max(4_096)).min(1).max(maxSentFiles).readonly(),
      caption: z.string().trim().min(1).max(500),
    }),
    result: z.object({ files: z.array(sentFileViewSchema).readonly() }),
  },
  "file/fetch": {
    ...readFlags,
    name: "file/fetch",
    scope: "read",
    args: z.strictObject({
      agent: protocolIdSchema("agent"),
      file: sentFileId,
      offset: byteCount.exactOptional(),
    }),
    result: z.object({
      name: z.string().min(1).max(255),
      bytes: byteCount,
      offset: byteCount,
      data: z.base64().max(maxPartText),
      next: byteCount.exactOptional(),
    }),
  },
};
