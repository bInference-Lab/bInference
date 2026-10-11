import { describe, expect, it } from "vitest";
import {
  type EngineLine,
  engineLineSchema,
  runtimeLineSchema,
} from "../control/control-line.schema.js";
import { readControlLines } from "../control/read-control-lines.js";
import {
  type InProcessRuntime,
  type InProcessRuntimeOptions,
  startInProcessRuntime,
} from "../testing/in-process-runtime.js";
import { fixtureStartLine } from "../testing/start-line-fixture.js";

interface Runtime extends InProcessRuntime {
  readonly next: () => Promise<unknown>;
}

function started(options: InProcessRuntimeOptions = {}): Runtime {
  const runtime = startInProcessRuntime(options);
  const lines = readControlLines(runtime.output)[Symbol.asyncIterator]();
  const next = async (): Promise<unknown> => {
    const line = await lines.next();
    return line.done === true ? "ended" : runtimeLineSchema.parse(JSON.parse(line.value));
  };
  return Object.assign(runtime, { next });
}

async function send(runtime: Runtime, line: object): Promise<void> {
  await runtime.write(`${JSON.stringify(engineLineSchema.encode(line as EngineLine))}\n`);
}

describe("runRuntime", () => {
  it("signs in with the start line's token, then writes ready", async () => {
    const runtime = started();
    await send(runtime, fixtureStartLine());
    await expect(runtime.next()).resolves.toEqual({
      t: "ready",
      version: "test",
      schemaVersion: 0,
    });
    expect(runtime.starts.map((start) => start.token)).toEqual([fixtureStartLine().token]);
    expect(runtime.starts[0]?.settings.models.providers["router"]?.apiKey).toBe("sk-test-router");
  });

  it("writes its health at each tick of its timer", async () => {
    const runtime = started();
    await send(runtime, fixtureStartLine());
    await runtime.next();
    await runtime.tick();
    await expect(runtime.next()).resolves.toEqual({
      t: "health",
      runningTurns: 0,
      waitingMessages: 0,
    });
  });

  it("refuses a routed operation it does not serve yet, by its id", async () => {
    const runtime = started();
    await send(runtime, fixtureStartLine());
    await runtime.next();
    const route = { t: "route", id: "r7", op: "notes/list", args: { agent: "a" }, origin: "owner" };
    await send(runtime, route);
    await expect(runtime.next()).resolves.toMatchObject({
      t: "routeReply",
      id: "r7",
      error: { code: "protocol.unknown_op", retryable: false },
    });
  });

  it("ends without a fault on stop, after new settings", async () => {
    const runtime = started();
    await send(runtime, fixtureStartLine());
    await runtime.next();
    await send(runtime, { t: "settings", settings: fixtureStartLine().settings });
    await send(runtime, { t: "stop" });
    await expect(runtime.exited).resolves.toBe(0);
    await expect(runtime.next()).resolves.toBe("ended");
  });

  it("ends without a fault when its input ends", async () => {
    const runtime = started();
    await send(runtime, fixtureStartLine());
    await runtime.next();
    await runtime.end();
    await expect(runtime.exited).resolves.toBe(0);
  });

  it("ends with a fault, signed in to nothing, when the first line is not start", async () => {
    const runtime = started();
    await send(runtime, { t: "stop" });
    await expect(runtime.exited).resolves.toBe(1);
    expect(runtime.starts).toEqual([]);
  });

  it("ends with a fault on a line it cannot read", async () => {
    const runtime = started();
    await send(runtime, fixtureStartLine());
    await runtime.next();
    await runtime.write("{not json\n");
    await expect(runtime.exited).resolves.toBe(1);
  });

  it("ends with a fault and writes no ready when the engine refuses its token", async () => {
    const runtime = started({ refusesSignIn: true });
    await send(runtime, fixtureStartLine());
    await expect(runtime.exited).resolves.toBe(1);
    await expect(runtime.next()).resolves.toBe("ended");
  });

  it("ends without a fault when its input ends or stop comes while it signs in", async () => {
    const ended = started({ hangsAtSignIn: true });
    await send(ended, fixtureStartLine());
    await ended.end();
    await expect(ended.exited).resolves.toBe(0);
    const stopped = started({ hangsAtSignIn: true });
    await send(stopped, fixtureStartLine());
    await send(stopped, { t: "stop" });
    await expect(stopped.exited).resolves.toBe(0);
    await expect(stopped.next()).resolves.toBe("ended");
  });

  it("answers the settings that came while it signed in once it is ready", async () => {
    const runtime = started();
    await send(runtime, fixtureStartLine());
    await send(runtime, { t: "settings", settings: fixtureStartLine().settings });
    await expect(runtime.next()).resolves.toMatchObject({ t: "ready" });
    await send(runtime, { t: "stop" });
    await expect(runtime.exited).resolves.toBe(0);
  });
});
