import { BinferenceError } from "@binference/core";
import { fileLimits, type ResultOf } from "@binference/protocol";
import { z } from "zod";
import type { ToolOutcome } from "../loop/turn-records.js";
import { agentToolTexts } from "./agent-tool-texts.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import { lookAtPlaces } from "./look-at-image-tool.js";
import { failedAnswer } from "./tool-answer.js";
import type { AgentToolParts } from "./tool-client.js";

const path = z.string().trim().min(1).max(4_096);
const text = z.string().max(fileLimits.maxFileTextChars);

// What the agent reads for each refusal of the engine, by its code.
const refusals: Readonly<Record<string, string>> = {
  "file.not_found":
    "No file has that path. Check the path; a relative path starts in your workspace.",
  "file.walled":
    "That path is inside binference's own folder, which is walled off. Never try to reach it another way.",
  "file.outside_workspace":
    "The owner keeps the file tools inside your workspace (files.workspaceOnly), so that path is refused.",
  "file.too_large": "The file is over 10 MiB, more than the file tools read in one call.",
  "file.is_folder": "That path is a folder. List it with the shell, then name a file in it.",
  "file.binary": "That file is not text. Read it with a program that understands its format.",
  "file.exists": "A file is already there.",
  "file.unreadable": "The file could not be read: check its permissions.",
  "file.unwritable": "The file could not be written: check that its folder is the owner's.",
  "file.offset_past_end": "The file ends before that line. Read from an earlier line.",
};

async function answerOrRefusal(
  tool: string,
  work: () => Promise<ToolOutcome>,
): Promise<ToolOutcome> {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof BinferenceError)) {
      throw error;
    }
    const known = refusals[error.code];
    return known === undefined ? failedAnswer(tool, error) : { text: known, isError: true };
  }
}

type TextPage = Extract<ResultOf<"file/read">, { readonly kind: "text" }>;

// Where the next page starts, as the model writes the call that reads it.
function continueAt(next: NonNullable<TextPage["next"]>): string {
  return next.cursor === undefined
    ? `offset=${String(next.offset)}`
    : `offset=${String(next.offset)} cursor=${String(next.cursor)}`;
}

// A page as the model reads it: its text, then where to go on when the file holds more.
function pageText(page: TextPage): string {
  if (page.totalLines === 0) {
    return "The file is empty.";
  }
  if (page.startLine > page.totalLines) {
    const total = String(page.totalLines);
    return `Offset ${String(page.startLine)} is past the end of the file (${total} lines in all). Read again with an offset of ${total} or less.`;
  }
  const { next } = page;
  if (next === undefined) {
    return page.text;
  }
  const more = page.totalLines - page.endLine;
  const note =
    next.cutBy === "bytes"
      ? `[Read output capped at ${String(fileLimits.maxFileReadBytes / 1024)} KB for this call. Use ${continueAt(next)} to continue.]`
      : `[${String(more)} more line${more === 1 ? "" : "s"} in file. Use ${continueAt(next)} to continue.]`;
  return `${page.text}\n\n${note}`;
}

const readArgs: z.ZodType<{
  readonly path: string;
  readonly offset?: number;
  readonly limit?: number;
  readonly cursor?: number;
}> = z.strictObject({
  path,
  cursor: z.int().min(0).exactOptional(),
  offset: z.int().min(1).exactOptional(),
  limit: z.int().min(1).max(fileLimits.maxFileReadLines).exactOptional(),
});

// What file_read answers for a PDF, which it does not read as text.
function pdfText(file: string): string {
  return `${file} is a PDF, which file_read does not read.`;
}

function fileReadTool(parts: AgentToolParts): AgentTool {
  return defineTool({
    name: "file_read",
    kind: "read",
    parallel: true,
    outside: true,
    description: agentToolTexts.file_read,
    args: readArgs,
    run: async (args, { signal, look }) =>
      answerOrRefusal("file_read", async () => {
        const read = await parts.client.call(
          "file/read",
          { agent: parts.agent, ...args },
          { signal },
        );
        if (read.kind === "pdf") {
          return { text: pdfText(read.path), isError: true };
        }
        return read.kind === "image"
          ? lookAtPlaces(parts, [{ path: read.path }], {
              signal,
              look,
              question: "What does it show?",
            })
          : { text: pageText(read), isError: false };
      }),
  });
}

function fileWriteTool({ agent, client }: AgentToolParts): AgentTool {
  return defineTool({
    name: "file_write",
    kind: "machine",
    description: agentToolTexts.file_write,
    args: z.strictObject({ path, content: text }),
    run: async (args, { signal }) =>
      answerOrRefusal("file_write", async () => {
        const written = await client.call("file/write", { agent, ...args }, { signal });
        const said = written.changed
          ? `Successfully wrote ${String(written.bytes)} bytes to ${written.path}.`
          : `No changes made to ${written.path}; it already holds this content.`;
        return { text: said, isError: false };
      }),
  });
}

/** The args of `file_edit`: a list of edits, or one edit written as its two texts. */
interface EditArgs {
  readonly path: string;
  readonly edits?: readonly { readonly oldText: string; readonly newText: string }[];
  readonly oldText?: string;
  readonly newText?: string;
}

const editArgs: z.ZodType<EditArgs> = z.strictObject({
  path,
  edits: z
    .array(z.strictObject({ oldText: text.min(1), newText: text }))
    .max(100)
    .exactOptional(),
  oldText: text.min(1).exactOptional(),
  newText: text.exactOptional(),
});

// Every edit a call names: its list, then its one edit written as two texts, once.
function editsOf(
  args: EditArgs,
): readonly { readonly oldText: string; readonly newText: string }[] {
  const listed = args.edits ?? [];
  const { oldText, newText } = args;
  if (oldText === undefined || newText === undefined) {
    return listed;
  }
  const isListed = listed.some((each) => each.oldText === oldText && each.newText === newText);
  return isListed ? listed : [...listed, { oldText, newText }];
}

function editAnswer(edited: ResultOf<"file/edit">): ToolOutcome {
  if (edited.problem !== undefined) {
    // The problem may quote the file's lines, so it is outside content.
    return { text: edited.problem, isError: true, outside: true };
  }
  return edited.changed
    ? {
        text: `Successfully replaced ${String(edited.replaced ?? 0)} block(s) in ${edited.path}.`,
        isError: false,
      }
    : {
        text: `No changes made to ${edited.path}. The replacement text is identical to the original.`,
        isError: false,
      };
}

function fileEditTool({ agent, client }: AgentToolParts): AgentTool {
  return defineTool({
    name: "file_edit",
    kind: "machine",
    description: agentToolTexts.file_edit,
    args: editArgs,
    run: async (args, { signal }) =>
      answerOrRefusal("file_edit", async () => {
        const edits = editsOf(args);
        if (edits.length === 0) {
          return { text: "Name at least one edit: edits, or oldText with newText.", isError: true };
        }
        const edited = await client.call(
          "file/edit",
          { agent, path: args.path, edits },
          { signal },
        );
        return editAnswer(edited);
      }),
  });
}

const changeMarks: Readonly<Record<ResultOf<"file/patch">["files"][number]["change"], string>> = {
  added: "A",
  updated: "M",
  moved: "R",
  deleted: "D",
};

function filePatchTool({ agent, client }: AgentToolParts): AgentTool {
  return defineTool({
    name: "file_patch",
    kind: "machine",
    description: agentToolTexts.file_patch,
    args: z.strictObject({ input: text.min(1) }),
    run: async (args, { signal }) =>
      answerOrRefusal("file_patch", async () => {
        const patched = await client.call("file/patch", { agent, ...args }, { signal });
        if (patched.problem !== undefined) {
          return { text: patched.problem, isError: true };
        }
        if (patched.files.length === 0) {
          return {
            text: "No changes made: the patch leaves every file as it was.",
            isError: false,
          };
        }
        const lines = patched.files.map(
          (file) =>
            `${changeMarks[file.change]} ${file.path}${file.to === undefined ? "" : ` -> ${file.to}`}`,
        );
        return { text: ["Success. Changed files:", ...lines].join("\n"), isError: false };
      }),
  });
}

/**
 * The agent's file tools (decision 0386): `file_read`, a read whose answers are outside content,
 * pages a text file and describes an image file; `file_write`, `file_edit` and `file_patch`,
 * machine tools, write a file whole, make exact replacements, and run a patch over several files.
 * Each goes through the engine's `file/*` operations, behind the same wall as the shell.
 */
export function fileTools(parts: AgentToolParts): readonly AgentTool[] {
  return [fileReadTool(parts), fileWriteTool(parts), fileEditTool(parts), filePatchTool(parts)];
}
