import type { ClientStatus, ProtocolClient, TopicHandlers } from "@binference/client";
import { BinferenceError } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import type { PushFrame } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { watchJobEnds } from "./job-ends.js";

const job = "job_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const other = "job_0190f1c2-3a4b-7c5d-8e6f-000000000002";
const live = (): AbortSignal => new AbortController().signal;

// A client that hands the test the `job` topic's handlers and lets it close the client.
function clientOf() {
  const topic: { handlers?: TopicHandlers; isOpen: boolean } = { isOpen: true };
  const status: { current: ClientStatus } = { current: { state: "idle" } };
  const client = {
    subscribe: (_topic: string, handlers: TopicHandlers) => {
      topic.handlers = handlers;
      return () => {
        topic.isOpen = false;
      };
    },
    status: () => status.current,
  } as unknown as ProtocolClient;
  let seq = 0;
  const push = (kind: string, data: object): void => {
    seq += 1;
    const frame: PushFrame = { t: "push", topic: "job", seq, kind, data };
    topic.handlers?.onPush(frame);
  };
  const close = (): void => {
    status.current = {
      state: "closed",
      error: new BinferenceError({ code: "client.closed", message: "x" }),
    };
  };
  return { client, topic, push, close };
}

describe("the ends of long jobs", () => {
  it("gives a job's end that came before the wait, and skips other jobs and kinds", async () => {
    const { client, push, topic } = clientOf();
    const ends = watchJobEnds(client, createManualClock(0));
    push("job/done", { job: other, op: "backup/create", result: 1 });
    push("job/progress", { job });
    push("job/done", { job, op: "backup/create", result: { bytes: 5 } });

    await expect(ends.of(job, live())).resolves.toStrictEqual({
      kind: "done",
      push: { job, op: "backup/create", result: { bytes: 5 } },
    });
    ends.close();
    expect(topic.isOpen).toBe(false);
  });

  it("gives a failed job's error once it comes", async () => {
    const { client, push } = clientOf();
    const ends = watchJobEnds(client, createManualClock(0));
    const end = ends.of(job, live());
    const error = { code: "backup.write_failed", message: "x", retryable: true };
    push("job/failed", { job, op: "backup/create", error });

    await expect(end).resolves.toStrictEqual({
      kind: "failed",
      push: { job, op: "backup/create", error },
    });
  });

  it("stops waiting once the client closes, or the wait's signal aborts", async () => {
    const { client, close } = clientOf();
    const clock = createManualClock(0);
    const ends = watchJobEnds(client, clock);
    const closed = ends.of(job, live());
    close();
    await clock.advance(1_000);
    await expect(closed).rejects.toMatchObject({ code: "client.closed" });

    const stopped = new AbortController();
    const aborted = watchJobEnds(clientOf().client, clock).of(job, stopped.signal);
    stopped.abort(new Error("budget"));
    await expect(aborted).rejects.toThrow("budget");
  });
});
