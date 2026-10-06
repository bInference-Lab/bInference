import assert from "node:assert/strict";
import { BinferenceError } from "../errors/binference-error.js";
import type { Http } from "../ports.js";
import type { ContractCheck } from "./contract-check.js";

/** An Http adapter under test, and three URLs its harness serves. */
export interface HttpSubject {
  readonly http: Http;
  /** Answers GET with status 200 and the body `ok`. */
  readonly okUrl: string;
  /** Answers GET with status 404. */
  readonly missingUrl: string;
  /** Never answers: nothing listens there. */
  readonly unreachableUrl: string;
}

/** Makes a fresh {@link HttpSubject} for each check. */
export interface HttpHarness {
  create(): HttpSubject;
}

const live = (): AbortSignal => new AbortController().signal;

/** The contract every `Http` adapter passes. */
export function httpContract(harness: HttpHarness): readonly ContractCheck[] {
  return [
    {
      name: "answers with the status and body of the response",
      run: async () => {
        const { http, okUrl } = harness.create();
        const response = await http.request({ method: "GET", url: okUrl, signal: live() });
        assert.equal(response.status, 200);
        assert.equal(response.body, "ok");
      },
    },
    {
      name: "returns a status of 400 or more as an answer",
      run: async () => {
        const { http, missingUrl } = harness.create();
        const response = await http.request({ method: "GET", url: missingUrl, signal: live() });
        assert.equal(response.status, 404);
      },
    },
    {
      name: "rejects with a retryable error when no answer comes",
      run: async () => {
        const { http, unreachableUrl } = harness.create();
        await assert.rejects(
          http.request({ method: "GET", url: unreachableUrl, signal: live() }),
          (error) => error instanceof BinferenceError && error.retryable,
        );
      },
    },
    {
      name: "refuses a request whose signal is aborted",
      run: async () => {
        const { http, okUrl } = harness.create();
        const reason = new Error("stopped");
        await assert.rejects(
          http.request({ method: "GET", url: okUrl, signal: AbortSignal.abort(reason) }),
          reason,
        );
      },
    },
  ];
}
