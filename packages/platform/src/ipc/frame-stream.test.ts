import { duplexPair } from "node:stream";
import { describe, expect, it } from "vitest";
import { encodeFrame } from "./frame-codec.js";
import { createFrameStream } from "./frame-stream.js";

const signal = (): AbortSignal => new AbortController().signal;
const bounds = { maxFrameBytes: 64, maxQueuedFrames: 2 };

describe("frame stream", () => {
  it("delivers frames in order and still hands over the ones that came before the peer left", async () => {
    const [near, far] = duplexPair();
    const stream = createFrameStream(near, bounds);

    far.write(encodeFrame(Buffer.from("one"), 64));
    far.write(encodeFrame(Buffer.from("two"), 64));
    far.end(encodeFrame(Buffer.from("three"), 64));

    await expect(stream.read(signal())).resolves.toStrictEqual(Buffer.from("one"));
    await expect(stream.read(signal())).resolves.toStrictEqual(Buffer.from("two"));
    await expect(stream.read(signal())).resolves.toStrictEqual(Buffer.from("three"));
    await expect(stream.read(signal())).rejects.toMatchObject({ code: "platform.ipc_closed" });
  });

  it("stops reading the socket while the queue is full and resumes as frames are read", async () => {
    const [near, far] = duplexPair();
    const stream = createFrameStream(near, bounds);
    const delivered = new Promise<void>((resolve) => {
      far.write(
        Buffer.concat([encodeFrame(Buffer.from("a"), 64), encodeFrame(Buffer.from("b"), 64)]),
        () => {
          resolve();
        },
      );
    });
    await delivered;

    expect(near.isPaused()).toBe(true);
    await expect(stream.read(signal())).resolves.toStrictEqual(Buffer.from("a"));
    expect(near.isPaused()).toBe(false);
  });

  it("allows one waiting read at a time", async () => {
    const [near] = duplexPair();
    const stream = createFrameStream(near, bounds);

    const first = stream.read(signal());

    await expect(stream.read(signal())).rejects.toMatchObject({ code: "platform.ipc_read_busy" });
    stream.close();
    await expect(first).rejects.toMatchObject({ code: "platform.ipc_closed" });
  });

  it("refuses a write beyond the unfinished ones it may hold", async () => {
    const [near] = duplexPair();
    const stream = createFrameStream(near, bounds);

    // Nobody reads the other side, so these writes stay unfinished.
    const pending = [
      stream.write(Buffer.from("a"), signal()),
      stream.write(Buffer.from("b"), signal()),
    ];

    await expect(stream.write(Buffer.from("c"), signal())).rejects.toMatchObject({
      code: "platform.ipc_write_busy",
    });
    stream.close();
    await expect(Promise.allSettled(pending)).resolves.toHaveLength(2);
  });

  it("ends the connection when a write is abandoned halfway", async () => {
    const [near] = duplexPair();
    const stream = createFrameStream(near, bounds);
    const controller = new AbortController();
    const reason = new Error("deadline");

    // Nobody reads the other side, so the write never completes on its own.
    const writing = stream.write(Buffer.from("x"), controller.signal);
    controller.abort(reason);

    await expect(writing).rejects.toBe(reason);
    expect(near.destroyed).toBe(true);
  });

  it("refuses to write once closed, and turns a socket error into a closed stream", async () => {
    const [near] = duplexPair();
    const stream = createFrameStream(near, bounds);

    near.destroy(new Error("reset"));

    await expect(stream.read(signal())).rejects.toMatchObject({
      code: "platform.ipc_closed",
      cause: new Error("reset"),
    });
    await expect(stream.write(Buffer.from("x"), signal())).rejects.toMatchObject({
      code: "platform.ipc_closed",
    });
  });
});
