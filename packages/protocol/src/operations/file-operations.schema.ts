import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { maxFileReadLines, maxFileTextChars } from "./file-limits.js";
import { type OperationTable, readFlags } from "./operation.schema.js";

const maxPathChars = 4_096;
const maxEdits = 100;

/** The args of `file/read`: a file, from line `offset` (1-based), at most `limit` lines. */
interface FileReadArgs {
  readonly agent: ProtocolId<"agent">;
  readonly path: string;
  readonly offset?: number;
  readonly limit?: number;
  /** Where to start inside line `offset`, in characters from 0, to go on in a long line. */
  readonly cursor?: number;
}

/**
 * One page of a text file: its lines from `startLine` through `endLine` (1-based), and where the
 * next page starts when there is more, cut by lines or by bytes. An image file is named instead,
 * by its absolute path, for `image/view`.
 */
type FileReadResult =
  | {
      readonly kind: "text";
      readonly path: string;
      readonly text: string;
      readonly startLine: number;
      readonly endLine: number;
      readonly totalLines: number;
      readonly next?: {
        readonly offset: number;
        /** Where to go on inside line `offset`, when a long line was cut. */
        readonly cursor?: number;
        readonly cutBy: "lines" | "bytes";
      };
    }
  | { readonly kind: "image"; readonly path: string };

/** The args of `file/write`: a file's whole new text. */
interface FileWriteArgs {
  readonly agent: ProtocolId<"agent">;
  readonly path: string;
  readonly content: string;
}

/** One exact replacement in a file's text. */
interface FileEdit {
  readonly oldText: string;
  readonly newText: string;
}

/** The args of `file/edit`: replacements against the file's text as it is now. */
interface FileEditArgs {
  readonly agent: ProtocolId<"agent">;
  readonly path: string;
  readonly edits: readonly FileEdit[];
}

/** The args of `file/patch`: a patch over one or more files. */
interface FilePatchArgs {
  readonly agent: ProtocolId<"agent">;
  readonly input: string;
}

/** What a write or an edit changed: the absolute path, and its size or replacements. */
interface FileChange {
  readonly path: string;
  /** False when the edit left the text as it was. */
  readonly changed: boolean;
  readonly bytes: number;
  /** The replacements made; absent for a write. */
  readonly replaced?: number;
  /** Why an edit changed nothing: which edit could not be placed, in the engine's words. */
  readonly problem?: string;
}

/** One file a patch touched, by its absolute path. */
interface PatchedFile {
  readonly path: string;
  readonly change: "added" | "updated" | "moved" | "deleted";
  /** Where a moved file went. */
  readonly to?: string;
}

/**
 * What a patch did, file by file, in the patch's order; or, with `problem`, why it changed
 * nothing: a line of the engine's own words that names the file and the part that failed.
 */
interface FilePatchResult {
  readonly files: readonly PatchedFile[];
  readonly problem?: string;
}

/**
 * The operations the agent reads and changes files on the engine's machine with (decision
 * 0386). They take no idempotency key: a kept answer would store a file's text.
 */
export interface FileOperationShapes {
  readonly "file/read": { readonly args: FileReadArgs; readonly result: FileReadResult };
  readonly "file/write": { readonly args: FileWriteArgs; readonly result: FileChange };
  readonly "file/edit": { readonly args: FileEditArgs; readonly result: FileChange };
  readonly "file/patch": { readonly args: FilePatchArgs; readonly result: FilePatchResult };
}

const agent = protocolIdSchema("agent");
const path = z.string().min(1).max(maxPathChars);
const text = z.string().max(maxFileTextChars);
const line = z.int().min(1);

const fileReadResultSchema: z.ZodType<FileReadResult> = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    path,
    text,
    startLine: line,
    endLine: z.int().min(0),
    totalLines: z.int().min(0),
    next: z
      .object({
        offset: line,
        cursor: z.int().min(0).exactOptional(),
        cutBy: z.enum(["lines", "bytes"]),
      })
      .exactOptional(),
  }),
  z.object({ kind: z.literal("image"), path }),
]);

const fileChangeSchema: z.ZodType<FileChange> = z.object({
  path,
  changed: z.boolean(),
  bytes: z.int().min(0),
  replaced: z.int().min(0).exactOptional(),
  problem: z.string().min(1).max(4_000).exactOptional(),
});

const filePatchResultSchema: z.ZodType<FilePatchResult> = z.object({
  files: z
    .array(
      z.object({
        path,
        change: z.enum(["added", "updated", "moved", "deleted"]),
        to: path.exactOptional(),
      }),
    )
    .readonly(),
  problem: z.string().min(1).max(2_000).exactOptional(),
});

/** The file operations, by name. */
export const fileOperations: OperationTable<FileOperationShapes> = {
  "file/read": {
    ...readFlags,
    name: "file/read",
    scope: "agent",
    args: z.strictObject({
      agent,
      path,
      offset: line.exactOptional(),
      limit: z.int().min(1).max(maxFileReadLines).exactOptional(),
      cursor: z.int().min(0).exactOptional(),
    }),
    result: fileReadResultSchema,
  },
  "file/write": {
    ...readFlags,
    name: "file/write",
    scope: "agent",
    args: z.strictObject({ agent, path, content: text }),
    result: fileChangeSchema,
  },
  "file/edit": {
    ...readFlags,
    name: "file/edit",
    scope: "agent",
    args: z.strictObject({
      agent,
      path,
      edits: z
        .array(z.strictObject({ oldText: text, newText: text }))
        .min(1)
        .max(maxEdits)
        .readonly(),
    }),
    result: fileChangeSchema,
  },
  "file/patch": {
    ...readFlags,
    name: "file/patch",
    scope: "agent",
    args: z.strictObject({ agent, input: text.min(1) }),
    result: filePatchResultSchema,
  },
};
