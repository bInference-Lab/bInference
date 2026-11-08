import { idSchema } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { imagePartBytes, fileLimits } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createRunningTurns } from "../chat/running-turns.js";
import { createFakePdfReader, fakePdfBytes } from "../fakes/fake-pdf-reader.js";
import { createMemoryViewImages } from "../fakes/memory-view-images.js";
import { testAgent } from "../intents/test-intents.js";
import type { EngineCall } from "../operations/engine-call.js";
import { testCall, testCallers } from "../operations/test-engine.js";
import { createPdfHandlers, pdfReadMs } from "./pdf-handlers.js";
import type { PdfReader } from "./ports.js";

const long = (word: string) => `${word} `.repeat(50);
const report = fakePdfBytes({
  pages: [{ text: long("supply") }, { text: "", scanned: true }, { text: long("vesting") }],
});
const locked = fakePdfBytes({ pages: [{ text: long("secret") }], password: "s3cret" });
// A picture two parts long: a JPEG's first bytes, then filler.
const bigPicture = new Uint8Array(imagePartBytes + 10);
bigPicture.set([0xff, 0xd8, 0xff]);

const bigPictureReader: PdfReader = {
  read: async () =>
    Promise.resolve({
      ok: true,
      value: {
        totalPages: 2,
        pages: [
          { page: 1, text: "", picture: bigPicture },
          { page: 2, text: "", picture: new Uint8Array([1, 2, 3]) },
        ],
        textCut: false,
        pagesCut: false,
        imagesCut: false,
      },
    }),
};

// The id a read answered its pictures under.
function documentOf(answer: Awaited<ReturnType<ReturnType<typeof setUp>["read"]>>): string {
  return answer.ok ? answer.value.document : "";
}

function setUp(options: { readonly reader?: PdfReader; readonly noSource?: boolean } = {}) {
  const clock = createManualClock(0);
  const source = createMemoryViewImages(
    new Map([
      ["https://example.com/report.pdf", report],
      ["~/locked.pdf", locked],
      ["~/notes.txt", new TextEncoder().encode("plain words")],
      ["~/big.pdf", new Uint8Array(fileLimits.maxPdfBytes + 1)],
    ]),
  );
  const turns = createRunningTurns();
  turns.startRuntime(idSchema("tok").parse(testCallers.runtime.credential));
  const handlers = createPdfHandlers({
    turns,
    clock,
    random: createSeededRandom(4),
    reader: options.reader ?? createFakePdfReader(),
    ...(options.noSource === true ? {} : { source }),
  });
  const read = async (
    args: Partial<EngineCall<"pdf/read">["args"]>,
    caller = testCallers.runtime,
  ) => handlers["pdf/read"](testCall({ agent: testAgent, ...args }, caller));
  const picture = async (args: Omit<EngineCall<"pdf/pageImage">["args"], "agent">) =>
    handlers["pdf/pageImage"](testCall({ agent: testAgent, ...args }, testCallers.runtime));
  return { read, picture, clock };
}

describe("pdf/read", () => {
  it("answers each page's text and the size of a scanned page's picture", async () => {
    const { read } = setUp();
    const answer = await read({ url: "https://example.com/report.pdf" });
    expect(answer).toMatchObject({
      ok: true,
      value: {
        totalPages: 3,
        pages: [
          { page: 1, text: long("supply") },
          { page: 2, text: "", image: { contentType: "image/jpeg", bytes: 5 } },
          { page: 3, text: long("vesting") },
        ],
        textCut: false,
        pagesCut: false,
        imagesCut: false,
      },
    });
  });

  it("reads only the pages asked for", async () => {
    const { read } = setUp();
    const answer = await read({ url: "https://example.com/report.pdf", pages: [3, 9] });
    expect(answer).toMatchObject({ ok: true, value: { pages: [{ page: 3 }], pagesCut: true } });
  });

  it("opens an encrypted PDF only with its password", async () => {
    const { read } = setUp();
    expect(await read({ path: "~/locked.pdf" })).toStrictEqual({
      ok: false,
      error: "pdf.password",
    });
    expect(await read({ path: "~/locked.pdf", password: "s3cret" })).toMatchObject({ ok: true });
  });

  it("refuses a file that is no PDF, a missing one, a large one and a walled one", async () => {
    const { read } = setUp();
    const answers = await Promise.all(
      ["~/notes.txt", "~/gone.pdf", "~/big.pdf", "/state/keys/agent.pdf"].map(async (path) =>
        read({ path }),
      ),
    );
    expect(answers).toStrictEqual(
      ["pdf.not_pdf", "pdf.not_found", "pdf.too_large", "pdf.walled"].map((error) => ({
        ok: false,
        error,
      })),
    );
  });

  it("refuses a private address and every caller but the runtime", async () => {
    const { read } = setUp();
    expect(await read({ url: "https://host.private.invalid/a.pdf" })).toStrictEqual({
      ok: false,
      error: "pdf.not_public",
    });
    expect(await read({ path: "~/locked.pdf" }, testCallers.cli)).toStrictEqual({
      ok: false,
      error: "auth.scope",
    });
  });

  it("refuses every read on an engine with no PDF source", async () => {
    const { read } = setUp({ noSource: true });
    expect(await read({ path: "~/locked.pdf" })).toStrictEqual({
      ok: false,
      error: "pdf.unreadable",
    });
  });

  it("stops a read that runs past its time", async () => {
    const { read, clock } = setUp({ reader: createFakePdfReader({ slow: true }) });
    const answer = read({ url: "https://example.com/report.pdf" });
    await clock.advance(pdfReadMs);
    expect(await answer).toStrictEqual({ ok: false, error: "pdf.timed_out" });
  });
});

describe("pdf/pageImage", () => {
  it("answers a picture part by part, then lets it go", async () => {
    const { read, picture } = setUp({ reader: bigPictureReader });
    const answer = await read({ url: "https://example.com/report.pdf" });
    expect(answer).toMatchObject({ ok: true, value: { imagesCut: true } });
    const document = documentOf(answer);
    const first = await picture({ document, page: 1 });
    expect(first).toMatchObject({ ok: true, value: { offset: 0, next: imagePartBytes } });
    const last = await picture({ document, page: 1, offset: imagePartBytes });
    expect(last).toMatchObject({ ok: true, value: { offset: imagePartBytes } });
    expect(await picture({ document, page: 1 })).toStrictEqual({ ok: false, error: "pdf.gone" });
  });

  it("refuses a page with no picture, and a document no longer held", async () => {
    const { read, picture, clock } = setUp();
    const answer = await read({ url: "https://example.com/report.pdf" });
    const document = documentOf(answer);
    expect(await picture({ document, page: 1 })).toStrictEqual({
      ok: false,
      error: "protocol.bad_args",
    });
    await clock.advance(120_000);
    expect(await picture({ document, page: 2 })).toStrictEqual({ ok: false, error: "pdf.gone" });
  });
});
