import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { StreamingHttp } from "../providers/ports.js";

/** What the server a check talks to answers: its status, its headers and its body's pieces. */
export interface StreamedAnswer {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly chunks: readonly string[];
}

/** A fresh adapter and the address of a server that answers each request with one answer. */
export interface StreamingHttpSubject {
  readonly http: StreamingHttp;
  /** Where the server listens, such as `http://127.0.0.1:4000/v1/chat/completions`. */
  readonly url: string;
  close(): Promise<void>;
}

/** Makes a fresh subject for each check, whose server gives the answer the check names. */
export interface StreamingHttpHarness {
  create(answer: StreamedAnswer): Promise<StreamingHttpSubject>;
}

const live = (): AbortSignal => new AbortController().signal;

async function textOf(body: AsyncIterable<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const piece of body) {
    text += decoder.decode(piece, { stream: true });
  }
  return text + decoder.decode();
}

async function withSubject(
  harness: StreamingHttpHarness,
  answer: StreamedAnswer,
  check: (subject: StreamingHttpSubject) => Promise<void>,
): Promise<void> {
  const subject = await harness.create(answer);
  try {
    await check(subject);
  } finally {
    await subject.close();
  }
}

async function streamsTheAnswer(harness: StreamingHttpHarness): Promise<void> {
  const chunks = ["data: one\n\n", "data: two\n\n", "data: [DONE]\n\n"];
  const answer = { status: 200, headers: { "content-type": "text/event-stream" }, chunks };
  await withSubject(harness, answer, async ({ http, url }) => {
    const response = await http.open({ method: "POST", url, body: "{}", signal: live() });
    assert.equal(response.status, 200);
    assert.equal(response.headers["content-type"], "text/event-stream");
    assert.equal(await textOf(response.body), chunks.join(""));
  });
}

async function answersAnErrorStatus(harness: StreamingHttpHarness): Promise<void> {
  const body = '{"error":{"code":"rate_limit_exceeded"}}';
  const answer = { status: 429, headers: { "retry-after": "2" }, chunks: [body] };
  await withSubject(harness, answer, async ({ http, url }) => {
    const response = await http.open({ method: "POST", url, body: "{}", signal: live() });
    assert.equal(response.status, 429);
    assert.equal(response.headers["retry-after"], "2");
    assert.equal(await textOf(response.body), body);
  });
}

async function refusesAnAbortedRequest(harness: StreamingHttpHarness): Promise<void> {
  const answer = { status: 200, headers: {}, chunks: ["data: [DONE]\n\n"] };
  await withSubject(harness, answer, async ({ http, url }) => {
    const stop = new AbortController();
    const reason = new Error("stopped");
    stop.abort(reason);
    await assert.rejects(
      http.open({ method: "POST", url, body: "{}", signal: stop.signal }),
      reason,
    );
  });
}

/**
 * The contract every {@link StreamingHttp} keeps: it answers the status and the lowercase headers
 * with the body streaming in order, an error status is an answer and never a fault, and a request
 * whose signal aborted rejects with the signal's reason.
 */
export function streamingHttpContract(harness: StreamingHttpHarness): readonly ContractCheck[] {
  return [
    {
      name: "answers the status and headers, then the body's pieces in order",
      run: async () => streamsTheAnswer(harness),
    },
    {
      name: "answers an error status as an answer, never a fault",
      run: async () => answersAnErrorStatus(harness),
    },
    {
      name: "rejects a request whose signal aborted with the signal's reason",
      run: async () => refusesAnAbortedRequest(harness),
    },
  ];
}
