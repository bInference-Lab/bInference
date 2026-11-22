import { join } from "node:path";
import { createMemoryLogger, createSeededRandom } from "@binference/core/testing";
import type { EngineCaller, EnginePush } from "@binference/engine";
import { writePrivateFile } from "@binference/platform";
import { type CheckReportView, checkReportViewSchema, type PushFrame } from "@binference/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { checkFindings } from "../commands/check-command.js";
import { createCheckOperations } from "../compose/check-operations.js";
import { createClosers } from "../compose/closers.js";
import { proxyUrlWith } from "../config/secrets/test-proxy-url.js";
import { runCli } from "../program/run-cli.js";
import { createFakeModelProvider, testModelId, testModelKey } from "./model-fixtures.js";
import {
  connectClient,
  createTestMachines,
  freePort,
  hostOn,
  hostWith,
  noPermissions,
  type TestMachine,
  writeTestConfig,
} from "./test-host.js";

// `check/run` (decision 0445): the findings of `binference check` run in the engine's process,
// reading the engine through its own handlers, and a report carries no secret a finding read.
const slow = { timeout: 60_000 };
const nowMs = 1_800_000_000_000;
const machines = createTestMachines();
const engines: { readonly machine: TestMachine; readonly exit: Promise<number> }[] = [];

afterEach(async () => {
  engines.forEach(({ machine }) => machine.signals.emit("SIGINT", "SIGINT"));
  await Promise.allSettled(engines.splice(0).map(async ({ exit }) => exit));
  await machines.removeAll();
});

async function start(machine: TestMachine): Promise<void> {
  const port = String(await freePort());
  const host = hostOn(machine, ["start", "--foreground", "--json", "--set", `engine.port=${port}`]);
  const exit = runCli(host);
  engines.push({ machine, exit });
  await host.waitForLine((line) => line.includes('"state":"ready"'));
}

const doneSchema = z.object({ job: z.string(), result: checkReportViewSchema });

// Runs check/run over the CLI's connection and answers the report its job ended with.
async function reportOver(machine: TestMachine): Promise<CheckReportView> {
  const client = await connectClient(machine);
  try {
    const ends: PushFrame[] = [];
    const ended: { done?: () => void } = {};
    const subscribed = new Promise<void>((resolve) => {
      client.subscribe("job", {
        onPush: (push) => {
          ends.push(push);
          ended.done?.();
        },
        refetch: async () => {
          resolve();
          return Promise.resolve();
        },
      });
    });
    await subscribed;
    const end = new Promise<void>((resolve) => {
      ended.done = resolve;
    });
    const { job } = await client.call("check/run", {}, { signal: AbortSignal.timeout(20_000) });
    await end;
    const done = doneSchema.parse(ends.find((push) => push.kind === "job/done")?.data);
    expect(done.job).toBe(job);
    return done.result;
  } finally {
    client.close();
  }
}

const levelOf = (report: CheckReportView, check: string) =>
  report.findings.find((finding) => finding.check === check)?.level;

// The secrets planted in every source a finding reads: the model's key from a variable, the
// proxy's password from a file, the bot's token from a variable, and an RPC address's key.
const planted = {
  modelKey: testModelKey,
  proxyPassword: "proxy-pass-7b1e4f0c9a2d",
  botToken: "123456:planted-bot-token-3c8e1f2a",
  rpcKey: "rpc-key-5d9a0b7e1c4f",
} as const;

async function plantedMachine(): Promise<TestMachine> {
  const machine = await machines.create(nowMs);
  const proxyFile = join(machine.folder, "proxy-url");
  const signal = new AbortController().signal;
  const proxy = proxyUrlWith("owner", planted.proxyPassword, "proxy.owner.test:3128");
  await writePrivateFile(proxyFile, proxy, { permissions: noPermissions, signal });
  const extra = [
    '  engine: { unlock: { mode: "file" } },',
    `  network: { proxy: { fromFile: ${JSON.stringify(proxyFile)} } },`,
    `  chains: { rpc: { "eip155:56": { urls: ["http://rpc.owner.test/${planted.rpcKey}"] } } },`,
    "  models: {",
    '    providers: { openai: { kind: "openai", apiKey: { fromEnv: "TEST_MODEL_KEY" } } },',
    `    main: "openai/${testModelId}",`,
    "  },\n",
  ].join("\n");
  await writeTestConfig(machine.folder, extra);
  return machine;
}

const owner: EngineCaller = {
  credential: "dev_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  client: { kind: "console", version: "test" },
  scopes: ["read", "admin"],
  transport: "ws",
};

// The check/run job's end over the findings of a host whose sources hold the planted secrets.
async function plantedEnd(machine: TestMachine): Promise<EnginePush> {
  const provider = createFakeModelProvider();
  const env = { TEST_MODEL_KEY: planted.modelKey, TEST_BOT_TOKEN: planted.botToken };
  const host = hostWith(machine, [], { env, parts: { http: provider.http } });
  const pushes: EnginePush[] = [];
  const waiting: { done?: () => void } = {};
  const handler = createCheckOperations({
    run: async (signal) => checkFindings({ host, fix: false, signal }),
    clock: host.clock,
    random: createSeededRandom(9),
    publish: (push) => {
      pushes.push(push);
      waiting.done?.();
    },
    closers: createClosers(),
    logger: createMemoryLogger({ subsystem: "check" }),
  })["check/run"];
  const end = new Promise<void>((resolve) => {
    waiting.done = resolve;
  });
  await handler?.({ args: {}, caller: owner, signal: new AbortController().signal });
  await end;
  const [push] = pushes;
  if (push === undefined) {
    throw new Error("Expected the job's end.");
  }
  return push;
}

describe("check/run", () => {
  it("runs the checks in the engine, which it reads in its own process", slow, async () => {
    const machine = await machines.create(nowMs);
    await writeTestConfig(machine.folder, '  engine: { unlock: { mode: "file" } },\n');
    await start(machine);
    const report = await reportOver(machine);
    expect(levelOf(report, "config.valid")).toBe("ok");
    expect(levelOf(report, "engine.reachable")).toBe("ok");
    expect(levelOf(report, "unlock.mode")).toBe("warn");
    const client = await connectClient(machine);
    await expect(
      client.call("check/run", { fix: true }, { signal: AbortSignal.timeout(20_000) }),
    ).rejects.toMatchObject({ code: "check.terminal_only" });
    client.close();
  });

  it("carries no secret from any source a finding reads into its report", slow, async () => {
    const machine = await plantedMachine();
    const push = await plantedEnd(machine);
    const text = JSON.stringify(push);
    const report = doneSchema.parse(push.data).result;
    expect(levelOf(report, "models.reachable")).toBe("ok");
    expect(levelOf(report, "network.proxy")).toBeDefined();
    expect(levelOf(report, "network.cleartext")).toBe("warn");
    expect(Object.values(planted).filter((secret) => text.includes(secret))).toStrictEqual([]);
  });
});
