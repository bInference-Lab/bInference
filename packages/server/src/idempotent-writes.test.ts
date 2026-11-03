import { err, type JsonValue, ok, type Result } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { type IdempotencyLookup, sha256Hex } from "@binference/engine";
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

function writes(maxInFlight = 8): ReturnType<typeof createIdempotentWrites> {
  return createIdempotentWrites({
    store: createMemoryIdempotencyStore(),
    clock: createManualClock(0),
    maxInFlight,
    signal: new AbortController().signal,
  });
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

  it.each([
    ["webhookRule/create", { rule: "whr_1", url: "http://127.0.0.1:7457/hook/whr_1/s3cr3t" }],
    ["webhookRule/rotateUrl", { url: "http://127.0.0.1:7457/hook/whr_1/s3cr3t" }],
  ])(
    "keeps %s's answer without its URL, and answers its repeat with no URL",
    async (op, answer) => {
      const store = createMemoryIdempotencyStore();
      const live = { signal: new AbortController().signal };
      const runner = createIdempotentWrites({
        store,
        clock: createManualClock(0),
        maxInFlight: 8,
        signal: live.signal,
      });
      const shown = { ...lookup, op };
      const work = vi.fn<Work>(async () => ok(answer));
      await expect(runner.run({ lookup: shown, work })).resolves.toStrictEqual(ok(answer));
      const kept = await store.recall(shown, live);
      expect(kept.kind).toBe("repeat");
      expect(JSON.stringify(kept)).not.toContain("s3cr3t");
      await expect(runner.run({ lookup: shown, work })).resolves.toStrictEqual(
        err("webhook.url_shown"),
      );
      expect(work).toHaveBeenCalledOnce();
    },
  );
});
