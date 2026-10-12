import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { ModelEvent } from "../loop/model-event.js";
import type { ModelTransport } from "../loop/ports.js";
import type { ModelRequest } from "../loop/turn-records.js";

/** Makes a fresh transport whose model answers its first call with text and no tool call. */
export interface ModelTransportHarness {
  create(): Promise<ModelTransport>;
}

const request: ModelRequest = {
  prefix: "Answer in one word.",
  messages: [{ role: "owner", text: "hello" }],
  tools: [],
};

async function collect(transport: ModelTransport, signal: AbortSignal): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  for await (const event of transport.stream(request, signal)) {
    events.push(event);
  }
  return events;
}

const isEnd = (event: ModelEvent): boolean => event.type === "done" || event.type === "error";

async function endsOnce(harness: ModelTransportHarness): Promise<void> {
  const events = await collect(await harness.create(), new AbortController().signal);
  assert.equal(events.filter(isEnd).length, 1);
  assert.equal(events.at(-1)?.type, "done");
  assert.ok(events.some((event) => event.type === "text"));
}

async function endsAborted(harness: ModelTransportHarness): Promise<void> {
  const events = await collect(await harness.create(), AbortSignal.abort());
  assert.equal(events.filter(isEnd).length, 1);
  const last = events.at(-1);
  assert.equal(last?.type === "error" ? last.failure : last?.type, "aborted");
}

/**
 * The contract every {@link ModelTransport} keeps (runtime spec, section 8.1): a stream ends with
 * exactly one `done` or `error`, never throws, and an aborted signal ends it as `aborted`.
 */
export function modelTransportContract(harness: ModelTransportHarness): readonly ContractCheck[] {
  return [
    {
      name: "streams the answer and ends it with one done event",
      run: async () => endsOnce(harness),
    },
    {
      name: "ends a stream on an aborted signal with one aborted error, never a throw",
      run: async () => endsAborted(harness),
    },
  ];
}
