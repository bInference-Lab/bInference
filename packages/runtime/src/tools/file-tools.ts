import { BinferenceError } from "@binference/core";
import { fileLimits, type ResultOf } from "@binference/protocol";
import { z } from "zod";
import type { ToolOutcome } from "../loop/turn-records.js";
import { agentToolTexts } from "./agent-tool-texts.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import { lookAtPlace } from "./look-at-image-tool.js";
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
  "file.no_match":
    "Could not find the exact text in the file. The old text must match exactly, including all whitespace and line breaks.",
  "file.many_matches":
    "The old text appears more than once in the file. It must be unique: add lines around it.",
  "file.overlap": "Two edits overlap. Merge them into one edit or target separate parts.",
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

// A page as the model reads it: its text, then where to go on when the file holds more.
function pageText(page: TextPage): string {
  if (page.totalLines === 0) {
    return "The file is empty.";
  }
  const { next } = page;
  if (next === undefined) {
    return page.text;
  }
  const more = page.totalLines - page.endLine;
  const note =
    next.cutBy === "bytes"
      ? `[Read output capped at ${String(fileLimits.maxFileReadBytes / 1024)} KB for this call. Use offset=${String(next.offset)} to continue.]`
      : `[${String(more)} more line${more === 1 ? "" : "s"} in file. Use offset=${String(next.offset)} to continue.]`;
  return `${page.text}\n\n${note}`;
}

const readArgs: z.ZodType<{
  readonly path: string;
  readonly offset?: number;
  readonly limit?: number;
}> = z.strictObject({
  path,
  offset: z.int().min(1).exactOptional(),
  limit: z.int().min(1).max(fileLimits.maxFileReadLines).exactOptional(),
});

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
        return read.kind === "image"
          ? lookAtPlace(
              parts,
              { path: read.path },
              { signal, look, question: "What does it show?" },
            )
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
        return {
          text: `Successfully wrote ${String(written.bytes)} bytes to ${written.path}.`,
          isError: false,
        };
      }),
  });
}

/** The most characters of a file a failed edit shows the agent, to copy the text exactly. */
const mismatchHintChars = 800;

function fileEditTool({ agent, client }: AgentToolParts): AgentTool {
  return defineTool({
    name: "file_edit",
    kind: "machine",
    description: agentToolTexts.file_edit,
    args: z.strictObject({
      path,
      edits: z
        .array(z.strictObject({ oldText: text.min(1), newText: text }))
        .min(1)
        .max(100),
    }),
    run: async (args, { signal }) =>
      answerOrRefusal("file_edit", async () => {
        try {
          const edited = await client.call("file/edit", { agent, ...args }, { signal });
          return edited.changed
            ? {
                text: `Successfully replaced ${String(edited.replaced ?? 0)} block(s) in ${edited.path}.`,
                isError: false,
              }
            : {
                text: `No changes made to ${edited.path}. The replacement text is identical to the original.`,
                isError: false,
              };
        } catch (error) {
          if (!(error instanceof BinferenceError) || error.code !== "file.no_match") {
            throw error;
          }
          const read = await client.call("file/read", { agent, path: args.path }, { signal });
          const shown = read.kind === "text" ? read.text.slice(0, mismatchHintChars) : "";
          return {
            text: `${refusals["file.no_match"] ?? ""}\nCurrent file contents:\n${shown}`,
            isError: true,
            outside: true,
          };
        }
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
