import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { type Clock, err, ok, type Result } from "@binference/core";
import type { PdfContent, PdfReader, PdfRefusal, PdfRequest } from "@binference/engine/pdf";
import { type PdfJob, type PdfJobAnswer, pdfJobAnswerOf } from "./pdf-job.schema.js";

/** The worker thread's entry beside this module: built JavaScript, or TypeScript in tests. */
export const pdfWorker: URL = new URL(
  `./pdf.worker${extname(fileURLToPath(import.meta.url))}`,
  import.meta.url,
);

/** How long one PDF may take to read before its thread is ended: 30 seconds. */
export const pdfReadLimitMs = 30_000;

/** What {@link createPdfReader} starts its threads with. */
export interface PdfReaderOptions {
  /** The clock each read's time limit runs on. */
  readonly clock: Clock;
  /** The worker entry: {@link pdfWorker}, or a test's own. */
  readonly worker?: URL;
  /** Node flags for each thread, such as a loader for TypeScript in tests. */
  readonly execArgv?: readonly string[];
  /** How long one read may take; {@link pdfReadLimitMs} when absent. */
  readonly timeoutMs?: number;
}

// The heap one thread may use; a PDF made to fill memory ends its own thread, not the engine.
const maxHeapMb = 512;

type ReadOutcome = Result<PdfContent, PdfRefusal>;

function outcomeOf(answer: PdfJobAnswer): ReadOutcome {
  if (answer.kind === "read") {
    return ok(answer.content);
  }
  return answer.kind === "refused" ? err(answer.refusal) : err("unreadable");
}

function jobOf(request: PdfRequest): PdfJob {
  return {
    bytes: Uint8Array.from(request.bytes),
    ...(request.pages === undefined ? {} : { pages: [...request.pages] }),
    ...(request.password === undefined ? {} : { password: request.password }),
  };
}

interface TimeLimit {
  readonly clock: Clock;
  readonly timeoutMs: number;
}

// Answers `timed_out` once the limit passes, unless the read ended first.
async function expire(
  limit: TimeLimit,
  signal: AbortSignal,
  resolve: (outcome: ReadOutcome) => void,
): Promise<void> {
  try {
    await limit.clock.sleep(limit.timeoutMs, signal);
  } catch {
    return;
  }
  resolve(err("timed_out"));
}

// The thread's one answer, a refusal once it ends without one or runs out of time, or the
// signal's reason once it aborts.
async function answerOf(
  worker: Worker,
  limit: TimeLimit,
  signal: AbortSignal,
): Promise<ReadOutcome> {
  const stops = new AbortController();
  try {
    return await new Promise<ReadOutcome>((resolve, reject) => {
      void expire(limit, stops.signal, resolve);
      signal.addEventListener("abort", () => reject(signal.reason), { signal: stops.signal });
      worker.once("message", (value) => {
        resolve(outcomeOf(pdfJobAnswerOf(value)));
      });
      worker.once("error", () => {
        resolve(err("unreadable"));
      });
      worker.once("exit", () => {
        resolve(err("unreadable"));
      });
    });
  } finally {
    stops.abort();
  }
}

/**
 * The engine's `PdfReader` on this machine (decision 0402): each read in a worker thread of its
 * own, with pdf.js and a canvas for Node, its heap capped at 512 MiB and ended after its answer,
 * after 30 seconds (`timed_out`), or once the signal aborts. A thread that fails or dies answers
 * `unreadable`, with no reason that could carry the PDF's words or its password.
 */
export function createPdfReader(options: PdfReaderOptions): PdfReader {
  const limit = { clock: options.clock, timeoutMs: options.timeoutMs ?? pdfReadLimitMs };
  return {
    async read(request, call) {
      call.signal.throwIfAborted();
      const worker = new Worker(options.worker ?? pdfWorker, {
        execArgv: [...(options.execArgv ?? [])],
        resourceLimits: { maxOldGenerationSizeMb: maxHeapMb },
      });
      try {
        const answer = answerOf(worker, limit, call.signal);
        worker.postMessage(jobOf(request), []);
        return await answer;
      } finally {
        await worker.terminate();
      }
    },
  };
}
