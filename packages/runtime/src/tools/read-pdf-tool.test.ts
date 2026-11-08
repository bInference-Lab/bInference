import { BinferenceError, err, ok } from "@binference/core";
import { describe, expect, it } from "vitest";
import type {
  DocumentContent,
  PreparedCall,
  ToolOutcome,
  ToolRunContext,
} from "../loop/turn-records.js";
import { agent, context, toolTurn } from "../testing/agent-tool-fixtures.js";
import { createFakeToolClient, type FakeAnswer } from "../testing/fake-tool-client.js";
import { readPdfTool } from "./read-pdf-tool.js";

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64");
const paper = {
  document: "9f2c4e1a7b3d5e60",
  totalPages: 30,
  pages: [
    { page: 1, text: "Supply: 1,000,000,000" },
    { page: 2, text: "", image: { contentType: "image/jpeg", bytes: 4 } },
  ],
  textCut: false,
  pagesCut: true,
  imagesCut: false,
};
const picture = { contentType: "image/jpeg", bytes: 4, offset: 0, data: jpeg };

interface Asked {
  readonly documents: DocumentContent[];
  readonly requests: string[];
}

// A turn whose model reads the document and, when `seesImages`, its pictures.
function askingContext(asked: Asked, model: { readonly seesImages: boolean }): ToolRunContext {
  return {
    ...context,
    askAbout: async (document, request) => {
      asked.documents.push(document);
      asked.requests.push(request);
      const pictures = model.seesImages ? await document.pictures() : [];
      return ok({
        text: "The supply is 1,000,000,000.",
        picturesSeen: pictures.length,
        readsImages: model.seesImages,
      });
    },
  };
}

async function read(
  args: Record<string, unknown>,
  options: { readonly answer?: FakeAnswer; readonly seesImages?: boolean } = {},
): Promise<{
  readonly outcome: ToolOutcome;
  readonly calls: readonly unknown[];
  readonly asked: Asked;
}> {
  const client = createFakeToolClient({
    "pdf/read": options.answer ?? paper,
    "pdf/pageImage": picture,
  });
  const prepared = readPdfTool({ agent, client, turn: toolTurn }).prepare(JSON.stringify(args));
  if (!prepared.ready) {
    throw new Error(prepared.text);
  }
  const asked: Asked = { documents: [], requests: [] };
  const outcome = await prepared.run(
    askingContext(asked, { seesImages: options.seesImages ?? true }),
  );
  return { outcome, calls: client.calls(), asked };
}

// Runs a call the tool box accepted.
async function runPrepared(prepared: PreparedCall, run: ToolRunContext): Promise<ToolOutcome> {
  if (!prepared.ready) {
    throw new Error(prepared.text);
  }
  return prepared.run(run);
}

describe("the read_pdf tool", () => {
  it("reads a PDF and its scanned page's picture, and answers the model's reply with what was left", async () => {
    const { outcome, calls, asked } = await read({
      pdf: "@~/Downloads/paper.pdf",
      pages: "1-2",
      password: "s3cret",
      prompt: "What is the supply?",
    });
    expect(calls).toStrictEqual([
      {
        op: "pdf/read",
        args: { agent, path: "~/Downloads/paper.pdf", pages: [1, 2], password: "s3cret" },
      },
      { op: "pdf/pageImage", args: { agent, document: paper.document, page: 2 } },
    ]);
    expect(asked.requests).toStrictEqual(["What is the supply?"]);
    expect(asked.documents[0]?.text).toBe(
      "[PDF 1: paper.pdf, 30 pages]\n--- Page 1 ---\nSupply: 1,000,000,000\n--- Page 2 (scanned: its picture follows, in page order) ---\n",
    );
    expect(outcome).toStrictEqual({
      text: [
        "The supply is 1,000,000,000.",
        "",
        "paper.pdf: read pages 1-2 of 30.",
        "paper.pdf: more pages are left; read them with pages, 20 at a time.",
      ].join("\n"),
      isError: false,
    });
    expect(outcome.text).not.toContain("s3cret");
  });

  it("reads a public address, and says which scanned pages no model could see", async () => {
    const { outcome, calls } = await read(
      { pdfs: ["https://example.com/a.pdf"] },
      { seesImages: false },
    );
    expect(calls).toStrictEqual([
      { op: "pdf/read", args: { agent, url: "https://example.com/a.pdf" } },
    ]);
    expect(outcome.text).toContain(
      "1 scanned page was read as text alone: no model of this agent takes images.",
    );
  });

  it("answers the engine's refusal as a sentence naming the PDF", async () => {
    const locked = new BinferenceError({ code: "pdf.password", message: "Encrypted." });
    const { outcome } = await read({ pdf: "~/locked.pdf" }, { answer: locked });
    expect(outcome).toMatchObject({ isError: true });
    expect(outcome.text).toMatch(/^~\/locked\.pdf: the PDF is encrypted/u);
  });

  it("refuses no PDF, a page range it cannot read and an address of another kind", async () => {
    const answers = await Promise.all(
      [{}, { pdf: "a.pdf", pages: "7-3" }, { pdf: "ftp://example.com/a.pdf" }].map(async (args) =>
        read(args),
      ),
    );
    expect(answers.map(({ outcome }) => outcome.isError)).toStrictEqual([true, true, true]);
    expect(answers.map(({ calls }) => calls)).toStrictEqual([[], [], []]);
  });

  it("says so when the model that reads PDFs does not answer", async () => {
    const client = createFakeToolClient({ "pdf/read": paper });
    const prepared = readPdfTool({ agent, client, turn: toolTurn }).prepare('{"pdf":"a.pdf"}');
    expect(prepared).toMatchObject({ ready: true });
    const silent: ToolRunContext = {
      ...context,
      askAbout: async () => Promise.resolve(err("failed")),
    };
    await expect(runPrepared(prepared, silent)).resolves.toMatchObject({ isError: true });
  });
});
