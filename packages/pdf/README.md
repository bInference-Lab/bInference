# @binference/pdf

## Purpose

The agent's PDF reader on the owner's machine (decision 0402): each page's text, and a JPEG of each
scanned page, read with pdf.js and a canvas for Node in a worker thread of its own.

## API

| Export            | What it does                                                                 |
| ----------------- | ---------------------------------------------------------------------------- |
| `createPdfReader` | The engine's `PdfReader`: one worker thread per PDF, ended after its answer. |
| `pdfWorker`       | The worker thread's entry beside the module, built JavaScript or TypeScript. |
| `pdfReadLimitMs`  | How long one PDF may take before its thread is ended: 30 seconds.            |

## Example

```ts
import { createPdfReader } from "@binference/pdf";

const reader = createPdfReader({ clock });
const read = await reader.read({ bytes, pages: [1, 2] }, { signal });
```
