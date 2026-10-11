import { type Id, idSchema } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import {
  fixtureStartLine,
  type InProcessRuntime,
  type InProcessRuntimeOptions,
  startInProcessRuntime,
} from "@binference/runtime/testing";
import { describe, expect, it } from "vitest";
import { createRuntimeSupervisor, runtimeTimeouts } from "./runtime-supervisor.js";

interface Watched extends InProcessRuntime {
  /** Settles once the supervisor has read the runtime's `ready` line. */
  readonly ready: Promise<void>;
}

// Passes the runtime's output through, and settles `ready` once the reader asked for what follows
// its ready line, so the supervisor has acted on it.
function watched(runtime: InProcessRuntime): Watched {
  const seen = { ready: (): void => undefined };
  const ready = new Promise<void>((resolve) => {
    seen.ready = resolve;
  });
  async function* output(): AsyncGenerator<Uint8Array> {
    for await (const chunk of runtime.output) {
      yield chunk;
      if (new TextDecoder().decode(chunk).includes('"t":"ready"')) {
        seen.ready();
      }
    }
  }
  return { ...runtime, output: output(), ready };
}

function tokenId(n: number): Id<"tok"> {
  return idSchema("tok").parse(`tok_0190f1c2-3a4b-7c5d-8e6f-${String(n).padStart(12, "0")}`);
}

function started(
  plan: (start: number) => InProcessRuntimeOptions = () => ({}),
  held: (start: number) => Promise<void> = async () => Promise.resolve(),
) {
  const clock = createManualClock(1_000);
  const logger = createMemoryLogger({ subsystem: "runtime" });
  const runtimes: Watched[] = [];
  const starts = { count: 0 };
  const calls = { turns: [] as string[], revoked: [] as (readonly string[])[] };
  const { endpoint, paths, settings } = fixtureStartLine();
  const supervisor = createRuntimeSupervisor({
    start: async () => {
      const n = starts.count;
      starts.count += 1;
      await held(n);
      const runtime = watched(startInProcessRuntime(plan(n)));
      runtimes.push(runtime);
      return runtime;
    },
    makeToken: async () => {
      const n = starts.count + 1;
      const token = `bnt_${String.fromCharCode(96 + n).repeat(43)}`;
      return { token, id: tokenId(n), revoked: n === 1 ? [] : [tokenId(n - 1)] };
    },
    startLine: { endpoint, paths, settings },
    turns: {
      startRuntime: (id) => calls.turns.push(`start ${id}`),
      clearAll: () => calls.turns.push("clear"),
    },
    onRevoked: (tokens) => calls.revoked.push(tokens),
    clock,
    logger,
  });
  const nth = async (n: number): Promise<Watched> => {
    await clock.advance(0);
    const runtime = runtimes[n];
    if (runtime === undefined) {
      throw new Error(`The runtime was started ${String(runtimes.length)} times.`);
    }
    return runtime;
  };
  return { supervisor, clock, logger, runtimes, calls, nth };
}

const call = { signal: new AbortController().signal };

// The first start behaves as `options` say, every later one signs in at once.
function firstOnly(options: InProcessRuntimeOptions): (start: number) => InProcessRuntimeOptions {
  return (start) => (start === 0 ? options : {});
}

// Start `held` waits for `gate`; every other start goes at once.
function heldAt(held: number, gate: Promise<void>): (start: number) => Promise<void> {
  return async (start) => (start === held ? gate : Promise.resolve());
}
const notesList = { op: "notes/list", args: { agent: "agt_x" }, origin: "owner" } as const;

describe("createRuntimeSupervisor", () => {
  it("is failing from the engine's start until the runtime writes ready", async () => {
    const test = started();
    expect(test.supervisor.health()).toStrictEqual({ state: "fail", since: 1_000 });
    test.supervisor.begin();
    const first = await test.nth(0);
    await first.ready;
    expect(test.supervisor.health().state).toBe("ok");
    expect(first.starts.map((start) => start.token)).toStrictEqual([`bnt_${"a".repeat(43)}`]);
    expect(first.starts[0]?.settings).toStrictEqual(fixtureStartLine().settings);
    expect(test.calls.turns).toStrictEqual([`start ${tokenId(1)}`]);
  });

  it("starts a killed runtime again at once with a new token, failing since the kill", async () => {
    const gate = { open: (): void => undefined };
    const opened = new Promise<void>((resolve) => {
      gate.open = resolve;
    });
    const test = started(() => ({}), heldAt(1, opened));
    test.supervisor.begin();
    const first = await test.nth(0);
    await first.ready;
    await test.clock.advance(5_000);
    first.kill();
    await first.exited;
    await test.clock.advance(0);
    expect(test.supervisor.health()).toStrictEqual({ state: "fail", since: 6_000 });
    await expect(test.supervisor.route(notesList, call.signal)).resolves.toStrictEqual({
      ok: false,
      error: "runtime.unavailable",
    });
    gate.open();
    const second = await test.nth(1);
    await second.ready;
    expect(test.supervisor.health().state).toBe("ok");
    expect(test.clock.now()).toBe(6_000);
    expect(second.starts[0]?.token).toBe(`bnt_${"b".repeat(43)}`);
    expect(test.calls.revoked).toStrictEqual([[], [tokenId(1)]]);
    expect(test.calls.turns).toStrictEqual([`start ${tokenId(1)}`, "clear", `start ${tokenId(2)}`]);
  });

  it("waits 2, 4 and 8 seconds before the starts after exits that follow one another", async () => {
    const test = started(() => ({ refusesSignIn: true }));
    test.supervisor.begin();
    await (
      await test.nth(0)
    ).exited;
    await (
      await test.nth(1)
    ).exited;
    await test.clock.advance(1_999);
    expect(test.runtimes).toHaveLength(2);
    await test.clock.advance(1);
    await (
      await test.nth(2)
    ).exited;
    await test.clock.advance(3_999);
    expect(test.runtimes).toHaveLength(3);
    await test.clock.advance(1);
    await (
      await test.nth(3)
    ).exited;
    await test.clock.advance(8_000);
    expect(test.runtimes).toHaveLength(5);
    await test.supervisor.stop(call.signal);
  });

  it("forgets earlier exits once a runtime stayed up 10 minutes", async () => {
    const test = started(firstOnly({ refusesSignIn: true }));
    test.supervisor.begin();
    await (
      await test.nth(0)
    ).exited;
    const second = await test.nth(1);
    await second.ready;
    await test.clock.advance(600_000);
    second.kill();
    await second.exited;
    const third = await test.nth(2);
    await third.ready;
    expect(test.clock.now()).toBe(601_000);
  });

  it("ends a runtime that writes no ready within 30 seconds, and counts it as an exit", async () => {
    const test = started(firstOnly({ hangsAtSignIn: true }));
    test.supervisor.begin();
    const first = await test.nth(0);
    await test.clock.advance(runtimeTimeouts.readyMs - 1);
    expect(test.runtimes).toHaveLength(1);
    await test.clock.advance(1);
    await expect(first.exited).resolves.toBeUndefined();
    await (
      await test.nth(1)
    ).ready;
    expect(test.logger.records().map((record) => record.event)).toContain("runtime.not_ready");
  });

  it("routes a call to the running runtime and hands back its answer", async () => {
    const test = started();
    test.supervisor.begin();
    await (
      await test.nth(0)
    ).ready;
    await expect(test.supervisor.route(notesList, call.signal)).resolves.toStrictEqual({
      ok: false,
      error: "protocol.unknown_op",
    });
  });

  it("stops the runtime with its stop line and starts no other", async () => {
    const test = started();
    test.supervisor.begin();
    const first = await test.nth(0);
    await first.ready;
    await test.supervisor.stop(call.signal);
    await expect(first.exited).resolves.toBe(0);
    await test.clock.advance(120_000);
    expect(test.runtimes).toHaveLength(1);
    expect(test.supervisor.health().state).toBe("fail");
  });

  it("ends a runtime that has not exited 10 seconds after its stop line", async () => {
    const test = started(() => ({ isStuck: true }));
    test.supervisor.begin();
    const first = await test.nth(0);
    const stopping = test.supervisor.stop(call.signal);
    await test.clock.advance(runtimeTimeouts.stopMs);
    await stopping;
    await expect(first.exited).resolves.toBeUndefined();
  });

  it("ends the runtime at once when the shutdown's own time runs out", async () => {
    const test = started(() => ({ isStuck: true }));
    test.supervisor.begin();
    const first = await test.nth(0);
    await test.supervisor.stop(AbortSignal.abort());
    await expect(first.exited).resolves.toBeUndefined();
  });
});
