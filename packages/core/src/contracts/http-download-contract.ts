import assert from "node:assert/strict";
import { BinferenceError } from "../errors/binference-error.js";
import type { HttpDownload } from "../ports.js";
import type { ContractCheck } from "./contract-check.js";

/** An HttpDownload adapter under test, and three URLs its harness serves. */
export interface HttpDownloadSubject {
  readonly download: HttpDownload;
  /** Answers GET with status 200 and the four bytes 0x89 0x50 0x4e 0x47. */
  readonly bytesUrl: string;
  /** Answers GET with status 404. */
  readonly missingUrl: string;
  /** Never answers: nothing listens there. */
  readonly unreachableUrl: string;
}

/** Makes a fresh {@link HttpDownloadSubject} for each check. */
export interface HttpDownloadHarness {
  create(): HttpDownloadSubject;
}

const live = (): AbortSignal => new AbortController().signal;
const served = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);

// What every download answers: the bytes, a status, and a refusal past its limit.
function answerChecks(harness: HttpDownloadHarness): readonly ContractCheck[] {
  return [
    {
      name: "answers the status and the body's bytes as they came",
      run: async () => {
        const { download, bytesUrl } = harness.create();
        const answer = await download.download({ url: bytesUrl, maxBytes: 4, signal: live() });
        assert.equal(answer.status, 200);
        assert.deepEqual([...answer.bytes], [...served]);
      },
    },
    {
      name: "returns a status of 400 or more as an answer",
      run: async () => {
        const { download, missingUrl } = harness.create();
        const answer = await download.download({ url: missingUrl, maxBytes: 4, signal: live() });
        assert.equal(answer.status, 404);
      },
    },
    {
      name: "refuses an answer over its byte limit",
      run: async () => {
        const { download, bytesUrl } = harness.create();
        await assert.rejects(
          download.download({ url: bytesUrl, maxBytes: 3, signal: live() }),
          (error) => error instanceof BinferenceError && error.code === "http.answer_too_large",
        );
      },
    },
  ];
}

/** The contract every `HttpDownload` adapter passes. */
export function httpDownloadContract(harness: HttpDownloadHarness): readonly ContractCheck[] {
  return [
    ...answerChecks(harness),
    {
      name: "rejects with a retryable error when no answer comes",
      run: async () => {
        const { download, unreachableUrl } = harness.create();
        await assert.rejects(
          download.download({ url: unreachableUrl, maxBytes: 4, signal: live() }),
          (error) => error instanceof BinferenceError && error.retryable,
        );
      },
    },
    {
      name: "refuses a download whose signal is aborted",
      run: async () => {
        const { download, bytesUrl } = harness.create();
        const reason = new Error("stopped");
        await assert.rejects(
          download.download({ url: bytesUrl, maxBytes: 4, signal: AbortSignal.abort(reason) }),
          reason,
        );
      },
    },
  ];
}
