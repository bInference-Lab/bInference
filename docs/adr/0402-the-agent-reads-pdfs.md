# 0402. The agent reads PDFs

Status: Accepted

Accepted by the tech lead on 2026-11-08.

## Context

Owners keep much of what they ask about in PDFs: whitepapers, audit reports, token terms, bank and
exchange statements, research. The agent could read a text file, look at a picture and drive a
browser, but a PDF reached it only as a binary file it could not open. Many PDFs are scans with no
text at all, and some are encrypted with a password.

A PDF is written by someone else and may hold any words, including instructions to the agent. It
can also be crafted to make a reader run for minutes or use gigabytes of memory.

## Decision

- The agent gets `read_pdf`, a read tool: up to 10 PDFs by path or public address, the pages to
  read (`"1-5"`, `"1,3,5-7"`; the first 20 when absent), the password of an encrypted one, and a
  request (`prompt`, "Analyze this PDF document." by default). A model answers the request over
  what the PDFs hold, and the tool's answer says when pages or text were cut. Every answer is
  outside content.
- The engine reads the PDF where `file/read` reads a path, behind the same wall: binference's own
  folder is refused and `files.workspaceOnly` holds. An address is read only on the public internet,
  through the owner's proxy, as `image/view` reads one. A PDF over 10 MiB is refused.
- `pdf/read` reads each page's text on the engine's machine, at most 20 pages and 100,000
  characters. A page with fewer than 200 characters of text, a scanned page, is also drawn as a
  JPEG, all the drawn pages of one PDF sharing 4 million pixels, so each stays readable without an
  answer too large to carry. `pdf/pageImage` hands the runtime each picture in 512 KiB parts, held
  for 2 minutes. Only the current agent runtime calls either; they take no idempotency key, so no
  page's words and no password are ever stored.
- The reading runs in `@binference/pdf`, on Mozilla's pdf.js with a canvas for Node, in a worker
  thread of its own: the engine's event loop never waits on a document, a read past 30 seconds is
  stopped, and the thread's memory is capped. pdf.js runs with its script evaluation off.
- The pictures go to the model `look_at_image` uses: the turn's own when it takes images, else
  `models.vision`. With neither, the turn's model answers over the text alone and the answer says
  which scanned pages went unread. The model's usage is booked on the turn.
- The password reaches the engine's reader and nothing else: it is never logged, never in an
  answer, and the transcript keeps the tool call with the password hidden.
- `file_read` on a PDF says it is a PDF and to read it with `read_pdf`.

## Consequences

- The agent reads the documents owners actually send, scans included, and answers about them.
- Long documents are read 20 pages a call; the answer says what remains, and the agent asks for the
  next pages.
- A scan read without a model that takes images gives no answer about its pages, and says so, with
  the settings that fix it.
- A PDF's words may try to steer the agent; the answer is outside content, so a trade after it
  always gets a card.
- The install carries pdf.js (Apache-2.0) and a canvas for Node (MIT) with its prebuilt native
  parts for each platform.

## Alternatives

- **Send the file itself to models that read PDFs.** Only some providers take documents, each in
  its own form, and a page selection or a password would need a second path. Reading the pages on
  the machine works with every model.
- **Read the text in the engine's own thread.** A crafted document would hold every trade, card and
  notice while it runs.
- **Render every page.** Text pages read better as text and cost a fraction of the tokens.
