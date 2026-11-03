import { join } from "node:path";
import { ok } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import type { EngineCaller, EngineHandler, EnginePush } from "@binference/engine";
import { testNowMs } from "@binference/engine/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  type FakeTailscaleState,
  fakeStatus,
  fakeTailnetName,
  writeFakeTailscale,
} from "../e2e/fake-tailscale.js";
import { createTestMachines, testSystem } from "../e2e/test-host.js";
import type { RemoteRecord } from "../remote/remote-view.js";
import { createClosers } from "./closers.js";
import { createRemoteOperations } from "./remote-operations.js";
import { createRemoteReading, webhookBaseOf } from "./remote-reading.js";

const live = new AbortController().signal;
const ports = { engine: 17_456, webhooks: 17_457 };
const machines = createTestMachines();
const caller: EngineCaller = {
  credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  client: { kind: "cli", version: "test" },
  scopes: ["read", "propose", "chat", "confirm", "loosen", "admin"],
  transport: "ipc",
};
const mini = `https://${fakeTailnetName}`;
const hooks = `${fakeTailnetName}:8443`;
const nothing = { mini: false, webhooks: false };
// A call that sets the funnel, never the one that takes it off.
const setsFunnel = (call: readonly string[]) => call.join(" ").startsWith("funnel --bg");

afterEach(async () => machines.removeAll());

// Remote operations over a stand-in Tailscale and a record the patches it writes keep up to date.
async function remoteOn(state: Partial<FakeTailscaleState> = {}, recorded: RemoteRecord = nothing) {
  const machine = await machines.create(testNowMs);
  const fake = await writeFakeTailscale(join(machine.folder, "bin"), {
    status: fakeStatus(),
    serve: {},
    ...state,
  });
  const patches: object[] = [];
  const now = { record: recorded };
  const configChange: EngineHandler<"config/change"> = async ({ args }) => {
    patches.push(args.patch);
    return Promise.resolve(ok({ config: {}, restartNeeded: true }));
  };
  const ends: EnginePush[] = [];
  const waiting: ((push: EnginePush) => void)[] = [];
  const reading = createRemoteReading({
    host: fake.host,
    ports,
    record: () => now.record,
    clock: createManualClock(testNowMs),
  });
  const handlers = createRemoteOperations({
    reading,
    random: createSeededRandom(7),
    configChange,
    publish: (push) => {
      ends.push(push);
      waiting.shift()?.(push);
    },
    closers: createClosers(),
  });
  const nextEnd = async () =>
    ends.shift() ?? new Promise<EnginePush>((resolve) => waiting.push(resolve));
  return { fake, reading, handlers, patches, nextEnd, now };
}

describe("the remote access operations", () => {
  it("publish both parts in a job, record them, and end with the view", async () => {
    const at = await remoteOn();
    const enable = at.handlers["remote/enable"];
    const started = await enable?.({ args: { mini: true, webhooks: true }, caller, signal: live });
    expect(started).toMatchObject({ ok: true });
    expect(await at.nextEnd()).toMatchObject({
      topic: "job",
      kind: "job/done",
      data: {
        op: "remote/enable",
        result: {
          tailscale: "running",
          miniUrl: mini,
          webhookUrl: `${mini}:8443`,
          published: { mini: true, webhooks: true },
        },
      },
    });
    expect(at.patches).toStrictEqual([{ remote: { mini: true, publicUrl: mini, webhooks: true } }]);
  });

  it("keep an address the owner set as the public URL", async () => {
    const own = { ...nothing, publicUrl: "https://binference.example.org" };
    const at = await remoteOn({}, own);
    await at.handlers["remote/enable"]?.({ args: { mini: true }, caller, signal: live });
    await at.nextEnd();
    expect(at.patches).toStrictEqual([{ remote: { mini: true } }]);
  });

  it("fail the job with a remote code and record nothing", async () => {
    const at = await remoteOn({ status: fakeStatus({ caps: [] }) });
    await at.handlers["remote/enable"]?.({ args: { mini: true }, caller, signal: live });
    expect(await at.nextEnd()).toMatchObject({
      kind: "job/failed",
      data: { op: "remote/enable", error: { code: "remote.https_off" } },
    });
    expect(at.patches).toStrictEqual([]);
  });

  it("answer statuses meanwhile from one read of Tailscale", async () => {
    const at = await remoteOn();
    const status = at.handlers["remote/status"];
    const first = await status?.({ args: {}, caller, signal: live });
    const second = await status?.({ args: {}, caller, signal: live });
    expect(second).toStrictEqual(first);
    expect((await at.fake.calls()).map((call) => call.join(" ")).toSorted()).toStrictEqual([
      "serve status --json",
      "status --json --peers=false",
    ]);
  });

  it("refuse an enable that names neither part", async () => {
    const at = await remoteOn();
    await expect(
      at.handlers["remote/enable"]?.({ args: {}, caller, signal: live }),
    ).resolves.toStrictEqual({ ok: false, error: "protocol.bad_args" });
  });

  it("answer the running job only for the same parts", async () => {
    const at = await remoteOn({ hang: { command: "serve", ms: 2_000 } });
    const enable = at.handlers["remote/enable"];
    const first = await enable?.({ args: { mini: true }, caller, signal: live });
    const again = await enable?.({ args: { mini: true }, caller, signal: live });
    const other = await enable?.({ args: { mini: true, webhooks: true }, caller, signal: live });
    expect(again).toStrictEqual(first);
    expect(other).not.toStrictEqual(first);
    expect([(await at.nextEnd()).kind, (await at.nextEnd()).kind]).toStrictEqual([
      "job/done",
      "job/done",
    ]);
  });

  it("take binference's handlers off and record what Tailscale holds", async () => {
    const at = await remoteOn({}, { mini: true, webhooks: false, publicUrl: mini });
    await at.handlers["remote/enable"]?.({ args: { mini: true }, caller, signal: live });
    await at.nextEnd();
    const aborted = AbortSignal.abort();
    await expect(
      at.handlers["remote/disable"]?.({ args: {}, caller, signal: aborted }),
    ).resolves.toStrictEqual({ ok: true, value: {} });
    expect(at.patches.at(-1)).toStrictEqual({
      remote: { mini: false, webhooks: false, publicUrl: null },
    });
    expect(await at.fake.serve()).toStrictEqual({ TCP: {}, Web: {}, AllowFunnel: {} });
  });

  it("name what still publishes the engine after taking off, and leave it", async () => {
    const blog = {
      [`${fakeTailnetName}:443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:17456" } } },
    };
    const serve = {
      TCP: { "443": { HTTPS: true } },
      Web: blog,
      AllowFunnel: { [`${fakeTailnetName}:443`]: true },
    };
    const at = await remoteOn({ serve }, { mini: true, webhooks: false });
    await expect(
      at.handlers["remote/disable"]?.({ args: {}, caller, signal: live }),
    ).resolves.toStrictEqual({
      ok: true,
      value: {
        stillPublished: [
          { port: 443, mount: "/", target: "http://127.0.0.1:17456", isPublic: true },
        ],
      },
    });
    expect(at.patches).toStrictEqual([{ remote: nothing }]);
  });

  it("stop a publish whose funnel is still on its way, then take off", async () => {
    const at = await remoteOn({ hang: { command: "funnel", ms: 3_000, before: true } });
    await at.handlers["remote/enable"]?.({ args: { webhooks: true }, caller, signal: live });
    await at.fake.untilCalled(setsFunnel);
    await expect(
      at.handlers["remote/disable"]?.({ args: {}, caller, signal: live }),
    ).resolves.toStrictEqual({ ok: true, value: {} });
    expect(await at.nextEnd()).toMatchObject({
      kind: "job/failed",
      data: { error: { code: "remote.not_applied" } },
    });
    expect(await at.fake.serve()).toStrictEqual({});
    expect(at.patches).toStrictEqual([{ remote: nothing }]);
  });

  it("stop a publish whose funnel already landed, undo it, then take off", async () => {
    const at = await remoteOn({ hang: { command: "funnel", ms: 30_000 } });
    await at.handlers["remote/enable"]?.({
      args: { mini: true, webhooks: true },
      caller,
      signal: live,
    });
    await at.fake.untilServe((serve) => JSON.stringify(serve).includes(hooks));
    await expect(
      at.handlers["remote/disable"]?.({ args: {}, caller, signal: live }),
    ).resolves.toStrictEqual({ ok: true, value: {} });
    expect(await at.nextEnd()).toMatchObject({
      kind: "job/failed",
      data: { error: { code: "remote.not_applied" } },
    });
    expect(await at.fake.serve()).toStrictEqual({ TCP: {}, Web: {}, AllowFunnel: {} });
    expect(at.patches).toStrictEqual([{ remote: nothing }]);
  });
});

describe("webhookBaseOf", () => {
  it("starts a rule's URL at the funnel address while binference's handler is there", async () => {
    const at = await remoteOn();
    const base = webhookBaseOf(at.reading);
    await expect(base()).resolves.toBe("http://127.0.0.1:17457");
    await at.handlers["remote/enable"]?.({ args: { webhooks: true }, caller, signal: live });
    await at.nextEnd();
    await expect(base()).resolves.toBe(`${mini}:8443`);
  });

  it("refuses a URL while the record says published and Tailscale does not answer", async () => {
    const reading = createRemoteReading({
      host: { env: {}, system: testSystem },
      ports,
      record: () => ({ mini: false, webhooks: true }),
      clock: createManualClock(testNowMs),
    });
    await expect(webhookBaseOf(reading)()).rejects.toMatchObject({
      code: "remote.tailscale_missing",
    });
  });
});
