import {
  BinferenceError,
  err,
  type JsonValue,
  type Logger,
  ok,
  type Result,
} from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { type IdempotencyLookup, type IdempotencyStore, sha256Hex } from "@binference/engine";
import { createMemoryIdempotencyStore } from "@binference/engine/testing";
import type { ProtocolErrorCode } from "@binference/protocol";
import { describe, expect, it, vi } from "vitest";
import { createIdempotentWrites } from "./idempotent-writes.js";

type Work = () => Promise<Result<JsonValue, ProtocolErrorCode>>;

const lookup: IdempotencyLookup = {
  credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  op: "safety/freeze",
  key: "key-1",
  argsHash: sha256Hex("{}"),
};

const live = { signal: new AbortController().signal };

// A runner on its own store, as one engine start; a second one on the same store is a later start.
function writesOn(
  store: IdempotencyStore,
  parts: {
    readonly maxInFlight?: number;
    readonly signal?: AbortSignal;
    readonly logger?: Logger;
  } = {},
): ReturnType<typeof createIdempotentWrites> {
  return createIdempotentWrites({
    store,
    clock: createManualClock(0),
    logger: parts.logger ?? createMemoryLogger({ subsystem: "server" }),
    maxInFlight: parts.maxInFlight ?? 8,
    signal: parts.signal ?? live.signal,
  });
}

function writes(maxInFlight = 8): ReturnType<typeof createIdempotentWrites> {
  return writesOn(createMemoryIdempotencyStore(), { maxInFlight });
}

function ignore(): void {
  // Replaced before anything calls it.
}

// A promise and the switch that resolves it.
function latch(): { readonly opened: Promise<void>; readonly open: () => void } {
  let open: () => void = ignore;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open: () => open() };
}

describe("createIdempotentWrites", () => {
  it("runs a write once and answers the same key with its first result", async () => {
    const runner = writes();
    let runs = 0;
    const work = vi.fn<Work>(async () => {
      runs += 1;
      return ok({ run: runs });
    });
    await expect(runner.run({ lookup, work })).resolves.toStrictEqual(ok({ run: 1 }));
    await expect(runner.run({ lookup, work })).resolves.toStrictEqual(ok({ run: 1 }));
    expect(work).toHaveBeenCalledOnce();
  });

  it("refuses the same key with other args", async () => {
    const runner = writes();
    await runner.run({ lookup, work: async () => ok(null) });
    const other = { ...lookup, argsHash: sha256Hex('{"agent":"x"}') };
    await expect(runner.run({ lookup: other, work: async () => ok(1) })).resolves.toStrictEqual(
      err("protocol.key_reused"),
    );
  });

  it("lets a second call with a running key wait for the first, which runs once", async () => {
    const runner = writes();
    const releases: (() => void)[] = [];
    const gate = new Promise<void>((resolve) => {
      releases.push(resolve);
    });
    const work = vi.fn<Work>(async () => {
      await gate;
      return ok("done");
    });
    const first = runner.run({ lookup, work });
    const second = runner.run({ lookup, work });
    const reused = runner.run({ lookup: { ...lookup, argsHash: sha256Hex("x") }, work });
    releases.forEach((release) => release());
    await expect(Promise.all([first, second, reused])).resolves.toStrictEqual([
      ok("done"),
      ok("done"),
      err("protocol.key_reused"),
    ]);
    expect(work).toHaveBeenCalledOnce();
  });

  it("stores nothing for a refused write, so the key may run again", async () => {
    const runner = writes();
    await expect(
      runner.run({ lookup, work: async () => err("agent.frozen") }),
    ).resolves.toStrictEqual(err("agent.frozen"));
    await expect(runner.run({ lookup, work: async () => ok(2) })).resolves.toStrictEqual(ok(2));
  });

  it("refuses a write past the most that may run at once", async () => {
    const runner = writes(1);
    const never = new Promise<Result<JsonValue, ProtocolErrorCode>>(() => undefined);
    void runner.run({ lookup, work: async () => never });
    await Promise.resolve();
    const other = { ...lookup, key: "key-2" };
    await expect(runner.run({ lookup: other, work: async () => ok(1) })).resolves.toStrictEqual(
      err("protocol.busy"),
    );
  });

  it("answers a key an earlier engine start left unfinished as unknown and runs nothing", async () => {
    const store = createMemoryIdempotencyStore();
    await store.start({ ...lookup, atMs: 0 }, live);
    const work = vi.fn<Work>(async () => ok(1));
    await expect(writesOn(store).run({ lookup, work })).resolves.toStrictEqual(
      err("protocol.outcome_unknown"),
    );
    const other = { ...lookup, argsHash: sha256Hex('{"agent":"x"}') };
    await expect(writesOn(store).run({ lookup: other, work })).resolves.toStrictEqual(
      err("protocol.key_reused"),
    );
    expect(work).not.toHaveBeenCalled();
  });

  it("marks the key started in the store before the write runs", async () => {
    const store = createMemoryIdempotencyStore();
    const marks: string[] = [];
    const work = vi.fn<Work>(async () => {
      marks.push((await store.start({ ...lookup, atMs: 0 }, live)).kind);
      return ok(1);
    });
    await writesOn(store).run({ lookup, work });
    expect(marks).toStrictEqual(["unfinished"]);
  });

  it.each([
    new Error("the handler broke"),
    new BinferenceError({ code: "engine.timeout", message: "The call ran out of time." }),
    new BinferenceError({ code: "store.commit_unknown", message: "The store cannot tell." }),
    new BinferenceError({ code: "store.lease_lost", message: "Another worker holds it." }),
  ])(
    "keeps the key of a write whose handler threw %s, so its resend answers unknown",
    async (fault) => {
      const store = createMemoryIdempotencyStore();
      const failing = writesOn(store).run({ lookup, work: async () => Promise.reject(fault) });
      await expect(failing).rejects.toBe(fault);
      const work = vi.fn<Work>(async () => ok(1));
      await expect(writesOn(store).run({ lookup, work })).resolves.toStrictEqual(
        err("protocol.outcome_unknown"),
      );
      expect(work).not.toHaveBeenCalled();
    },
  );

  it("stores a result whose work ended after the server began to stop", async () => {
    const store = createMemoryIdempotencyStore();
    const stop = new AbortController();
    const runner = writesOn(store, { signal: stop.signal });
    const work = vi.fn<Work>(async () => {
      stop.abort(new Error("the engine stops"));
      return ok(1);
    });
    await expect(runner.run({ lookup, work })).resolves.toStrictEqual(ok(1));
    await expect(writesOn(store).run({ lookup, work })).resolves.toStrictEqual(ok(1));
    expect(work).toHaveBeenCalledOnce();
  });

  it("frees the key of a write refused after the server began to stop", async () => {
    const store = createMemoryIdempotencyStore();
    const stop = new AbortController();
    const runner = writesOn(store, { signal: stop.signal });
    const refused = vi.fn<Work>(async () => {
      stop.abort(new Error("the engine stops"));
      return err("agent.frozen");
    });
    await expect(runner.run({ lookup, work: refused })).resolves.toStrictEqual(err("agent.frozen"));
    const work = vi.fn<Work>(async () => ok(1));
    await expect(writesOn(store).run({ lookup, work })).resolves.toStrictEqual(ok(1));
    expect(work).toHaveBeenCalledOnce();
  });

  it("settles only once the results it is storing are stored", async () => {
    const store = createMemoryIdempotencyStore();
    const gate = latch();
    const entered = latch();
    const runner = writesOn({
      ...store,
      finish: async (entry, options) => {
        entered.open();
        await gate.opened;
        return store.finish(entry, options);
      },
    });
    const running = runner.run({ lookup, work: async () => ok(1) });
    await entered.opened;
    let isSettled = false;
    const settling = runner.settled().then(() => {
      isSettled = true;
      return isSettled;
    });
    // Every pending microtask runs first, so only a store that still waits keeps it unsettled.
    await vi.advanceTimersByTimeAsync(0);
    expect(isSettled).toBe(false);
    gate.open();
    await expect(running).resolves.toStrictEqual(ok(1));
    await settling;
    expect(isSettled).toBe(true);
  });

  it("prunes keys a day old, but never the mark of a write it still runs", async () => {
    const store = createMemoryIdempotencyStore();
    const clock = createManualClock(0);
    const runner = createIdempotentWrites({
      store,
      clock,
      logger: createMemoryLogger({ subsystem: "server" }),
      maxInFlight: 8,
      signal: live.signal,
    });
    const gate = latch();
    const running = runner.run({ lookup, work: async () => gate.opened.then(() => ok(1)) });
    await store.start({ ...lookup, key: "left", atMs: 0 }, live);
    await clock.advance(86_400_001);
    await expect(runner.prune(live)).resolves.toBe(1);
    gate.open();
    await expect(running).resolves.toStrictEqual(ok(1));
    await expect(store.start({ ...lookup, atMs: 1 }, live)).resolves.toMatchObject({
      kind: "repeat",
    });
  });

  it("logs why a result was not stored, and keeps the key started", async () => {
    const store = createMemoryIdempotencyStore();
    const logger = createMemoryLogger({ subsystem: "server" });
    const broken = new BinferenceError({ code: "store.timeout", message: "Too slow." });
    const runner = writesOn({ ...store, finish: async () => Promise.reject(broken) }, { logger });
    await expect(runner.run({ lookup, work: async () => ok(1) })).rejects.toBe(broken);
    expect(logger.records()).toContainEqual(
      expect.objectContaining({ event: "server.result_unkept" }),
    );
    await expect(store.start({ ...lookup, atMs: 1 }, live)).resolves.toStrictEqual({
      kind: "unfinished",
    });
  });

  it("runs no write whose key the store cannot mark", async () => {
    const store = createMemoryIdempotencyStore();
    const lost = new BinferenceError({ code: "store.lease_lost", message: "Another worker." });
    const work = vi.fn<Work>(async () => ok(1));
    const runner = writesOn({ ...store, start: async () => Promise.reject(lost) });
    await expect(runner.run({ lookup, work })).rejects.toBe(lost);
    expect(work).not.toHaveBeenCalled();
  });

  it("answers a refusal even when its key cannot be freed, and keeps the key unfinished", async () => {
    const store = createMemoryIdempotencyStore();
    const broken = new BinferenceError({ code: "store.timeout", message: "Too slow." });
    const runner = writesOn({ ...store, forget: async () => Promise.reject(broken) });
    await expect(
      runner.run({ lookup, work: async () => err("agent.frozen") }),
    ).resolves.toStrictEqual(err("agent.frozen"));
    await expect(store.start({ ...lookup, atMs: 1 }, live)).resolves.toStrictEqual({
      kind: "unfinished",
    });
  });

  it.each([
    ["webhookRule/create", { rule: "whr_1", url: "http://127.0.0.1:7457/hook/whr_1/s3cr3t" }],
    ["webhookRule/rotateUrl", { url: "http://127.0.0.1:7457/hook/whr_1/s3cr3t" }],
  ])(
    "keeps %s's answer without its URL, and answers its repeat with no URL",
    async (op, answer) => {
      const store = createMemoryIdempotencyStore();
      const runner = writesOn(store);
      const shown = { ...lookup, op };
      const work = vi.fn<Work>(async () => ok(answer));
      await expect(runner.run({ lookup: shown, work })).resolves.toStrictEqual(ok(answer));
      const kept = await store.start({ ...shown, atMs: 1 }, live);
      expect(kept.kind).toBe("repeat");
      expect(JSON.stringify(kept)).not.toContain("s3cr3t");
      await expect(runner.run({ lookup: shown, work })).resolves.toStrictEqual(
        err("webhook.url_shown"),
      );
      expect(work).toHaveBeenCalledOnce();
    },
  );
});
