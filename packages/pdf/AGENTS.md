# @binference/pdf

The agent's PDF reader on the owner's machine (decision 0402): each page's text, and a JPEG of each
scanned page, read with pdf.js and a canvas for Node in a worker thread.

The root [AGENTS.md](../../AGENTS.md) applies here. Rules for this package:

- It implements the engine's `PdfReader` port; the composition root in `cli` builds it with the
  host's clock and worker flags.
- Every read runs in a worker thread of its own (`pdf.worker.ts`), its heap capped, ended after its
  answer, at its time limit or when the signal aborts. Nothing of pdf.js runs on the engine's
  thread.
- What crosses the thread is parsed by `pdf-job.schema.ts` on both sides. A failure in the thread
  answers `failed` with no reason, so a PDF's words or its password never reach a log or an error.
- Reads stay within `fileLimits` of the protocol: pages, text and the pixels the drawn pages share.
  pdf.js reads its character maps, fonts and decoders from its own folders, never the network.
- Its public API is what `src/index.ts` exports; every export carries TSDoc.
- Tests sit beside the code as `*.test.ts`. `create-pdf-reader.test.ts` runs the port's contract on
  PDFs `test-pdfs.ts` makes in the test, the thread loading the TypeScript sources.
