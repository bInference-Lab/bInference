import { BinferenceError, err, ok, type Result } from "@binference/core";
import { fileLimits } from "@binference/protocol";
import { z } from "zod";
import { pagesOf } from "../documents/page-range.js";
import { contentText, notesOf } from "../documents/pdf-content.js";
import { type PdfAsk, picturesOf, type ReadPdf, readPdfs } from "../documents/read-pdfs.js";
import type { ToolOutcome, ToolRunContext } from "../loop/turn-records.js";
import { agentToolTexts } from "./agent-tool-texts.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import { failedAnswer } from "./tool-answer.js";
import type { AgentToolParts } from "./tool-client.js";

/** The args of `read_pdf`: PDFs by path or address, their pages, a password and the request. */
interface ReadPdfArgs {
  readonly pdf?: string;
  readonly pdfs?: readonly string[];
  readonly pages?: string;
  readonly password?: string;
  readonly prompt?: string;
}

const name = z.string().trim().min(1).max(4_096);

const readPdfArgs: z.ZodType<ReadPdfArgs> = z.strictObject({
  pdf: name.exactOptional(),
  pdfs: z.array(name).max(fileLimits.maxPdfsPerCall).exactOptional(),
  pages: z.string().trim().min(1).max(200).exactOptional(),
  password: z.string().min(1).max(fileLimits.maxPdfPasswordChars).exactOptional(),
  prompt: z.string().trim().min(1).max(4_000).exactOptional(),
});

const defaultPrompt = "Analyze this PDF document.";

// Every PDF a call names, each once, in the order named.
function namesOf(args: ReadPdfArgs): readonly string[] {
  return [...new Set([...(args.pdf === undefined ? [] : [args.pdf]), ...(args.pdfs ?? [])])];
}

function failed(text: string): ToolOutcome {
  return { text, isError: true };
}

// Asks a model of the turn the agent's request over what the PDFs hold, and adds the notes.
async function answerOver(
  parts: AgentToolParts,
  reads: readonly ReadPdf[],
  call: Pick<ToolRunContext, "signal" | "askAbout"> & {
    readonly prompt: string;
    readonly selectionCut: boolean;
  },
): Promise<ToolOutcome> {
  const drawn = reads.reduce(
    (sum, { read }) => sum + read.pages.filter((page) => page.image !== undefined).length,
    0,
  );
  const document = {
    text: contentText(reads),
    pictureCount: drawn,
    pictures: async () => picturesOf(parts, reads, call.signal),
  };
  const answer = await call.askAbout(document, call.prompt);
  if (!answer.ok) {
    return failed("The model that reads PDFs did not answer. Try again later.");
  }
  const { text, picturesSeen: seen, readsImages } = answer.value;
  const notes = notesOf(reads, { drawn, seen, readsImages, selectionCut: call.selectionCut });
  return { text: [text, "", ...notes].join("\n"), isError: false };
}

// The pages and password every PDF is read with, and whether pages asked for were left out.
function askOf(args: ReadPdfArgs): Result<PdfAsk & { readonly selectionCut: boolean }, string> {
  const password = args.password === undefined ? {} : { password: args.password };
  if (args.pages === undefined) {
    return ok({ ...password, selectionCut: false });
  }
  const selection = pagesOf(args.pages, fileLimits.maxPdfPages);
  if (!selection.ok) {
    return err(`pages: ${selection.error}`);
  }
  return ok({ pages: selection.value.pages, ...password, selectionCut: selection.value.cut });
}

async function run(
  parts: AgentToolParts,
  args: ReadPdfArgs,
  context: Pick<ToolRunContext, "signal" | "askAbout">,
): Promise<ToolOutcome> {
  const names = namesOf(args);
  if (names.length === 0 || names.length > fileLimits.maxPdfsPerCall) {
    return failed(`Name 1 to ${String(fileLimits.maxPdfsPerCall)} PDFs: pdf, or pdfs for several.`);
  }
  const asked = askOf(args);
  if (!asked.ok) {
    return failed(asked.error);
  }
  const { selectionCut, ...ask } = asked.value;
  const { signal, askAbout } = context;
  const reads = await readPdfs(parts, names, { ...ask, signal });
  if (!reads.ok) {
    return failed(reads.error);
  }
  const prompt = args.prompt ?? defaultPrompt;
  return answerOver(parts, reads.value, { signal, askAbout, prompt, selectionCut });
}

/**
 * `read_pdf`, a read tool (decision 0402): reads up to 10 PDFs of at most 10 MiB, at public
 * addresses or in files on the engine's machine read as the file tools read them, 20 pages each,
 * the pages a range names or the first, and answers a model's reply to the agent's request over
 * their text and the pictures of their scanned pages, with what was cut. Every answer is outside
 * content: a PDF may hold any words. The password reaches the engine alone.
 */
export function readPdfTool(parts: AgentToolParts): AgentTool {
  return defineTool({
    name: "read_pdf",
    kind: "read",
    outside: true,
    description: agentToolTexts.read_pdf,
    args: readPdfArgs,
    run: async (args, context) => {
      try {
        return await run(parts, args, context);
      } catch (error) {
        if (error instanceof BinferenceError) {
          return failedAnswer("read_pdf", error);
        }
        throw error;
      }
    },
  });
}
