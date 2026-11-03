import { EventEmitter } from "node:events";
import { createManualClock } from "@binference/core/testing";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { runCli } from "../program/run-cli.js";
import { createSystemHttp } from "../runtime/system-http.js";
import {
  connectClient,
  engineLogLines,
  freePort,
  hostWith,
  type TestMachine,
  writeTestConfig,
} from "./test-host.js";

const slow = { timeout: 60_000 };
const folders: TempFolder[] = [];
const machines: TestMachine[] = [];
const running: Promise<number>[] = [];

afterEach(async () => {
  machines.splice(0).forEach((machine) => machine.signals.emit("SIGINT", "SIGINT"));
  await Promise.allSettled(running.splice(0));
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

const readySchema = z.object({
  http: z.object({ port: z.number() }),
  webhooks: z.object({ host: z.string(), port: z.number() }).optional(),
});

// Starts an engine on a fresh machine with the `--set` flags given. With `isConfigPort`, its host
// leaves the webhook port to the config, as the entry file does; else it takes the test host's.
async function startOn(sets: readonly string[], options: { readonly isConfigPort: boolean }) {
  const folder = await createTempFolder("bnf-");
  folders.push(folder);
  const machine = {
    folder: folder.path,
    clock: createManualClock(1_800_000_000_000),
    signals: new EventEmitter(),
  };
  machines.push(machine);
  await writeTestConfig(machine.folder);
  const argv = ["start", "--foreground", "--json", ...sets.flatMap((set) => ["--set", set])];
  const tested = hostWith(machine, argv, { env: {} });
  const { webhookPort: _testPort, ...configured } = tested;
  const host = options.isConfigPort ? configured : tested;
  const exit = runCli(host);
  running.push(exit);
  const line = await host.waitForLine((text) => text.includes('"state":"ready"'));
  return { machine, exit, ready: readySchema.parse(JSON.parse(line)) };
}

const http = createSystemHttp({ version: "test" });

// Sends one request to 127.0.0.1 and answers its status and body.
async function send(port: number, method: "GET" | "POST", path: string) {
  const answer = await http.request({
    method,
    url: `http://127.0.0.1:${String(port)}${path}`,
    ...(method === "POST" ? { body: '{"id":"tv-1"}' } : {}),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: answer.status, body: answer.body };
}

const unknownHook = `/hook/whr_0190f1c2-3a4b-7c5d-8e6f-000000000001/${"a".repeat(43)}`;

describe("the engine's webhook listener", () => {
  it(
    "listens on its own port, serves none of the engine's routes there, and stops with the engine",
    slow,
    async () => {
      const ports = { engine: await freePort(), webhooks: await freePort() };
      const sets = [
        `engine.port=${String(ports.engine)}`,
        `engine.webhookPort=${String(ports.webhooks)}`,
      ];
      const { machine, exit, ready } = await startOn(sets, { isConfigPort: true });
      expect(ready.webhooks).toStrictEqual({ host: "127.0.0.1", port: ports.webhooks });
      await expect(send(ports.webhooks, "POST", unknownHook)).resolves.toStrictEqual({
        status: 404,
        body: "",
      });
      await expect(send(ports.webhooks, "GET", "/health")).resolves.toStrictEqual({
        status: 404,
        body: "",
      });
      await expect(send(ports.engine, "GET", "/health")).resolves.toMatchObject({ status: 200 });
      machine.signals.emit("SIGINT", "SIGINT");
      await expect(exit).resolves.toBe(0);
      await expect(send(ports.webhooks, "POST", unknownHook)).rejects.toMatchObject({
        code: "http.unreachable",
      });
    },
  );

  it(
    "runs without the listener, and tells the owner, when its port is the engine's own",
    slow,
    async () => {
      const port = await freePort();
      const sets = [`engine.port=${String(port)}`, `engine.webhookPort=${String(port)}`];
      const { machine, ready } = await startOn(sets, { isConfigPort: true });
      expect(ready.webhooks).toBeUndefined();
      await expect(send(port, "POST", unknownHook)).resolves.toMatchObject({ status: 404 });
      const lines = await engineLogLines(machine);
      const failed = lines.filter((line) => line.includes('"event":"webhook.listen_failed"'));
      expect(failed).toHaveLength(1);
      expect(failed[0]).toContain('"fields":{"errorCode":"server.listen_failed"}');
      const client = await connectClient(machine);
      const notices = await client.call("notice/list", {}, { signal: AbortSignal.timeout(10_000) });
      client.close();
      expect(notices.items.map((notice) => [notice.key, notice.values])).toContainEqual([
        "notice.webhookPortTaken",
        { port: String(port) },
      ]);
    },
  );

  it("takes a free webhook port, never the default one, when a test starts it", slow, async () => {
    const port = await freePort();
    const { ready } = await startOn([`engine.port=${String(port)}`], { isConfigPort: false });
    expect(ready.webhooks?.host).toBe("127.0.0.1");
    expect(ready.webhooks?.port).toBeGreaterThan(0);
    expect(ready.webhooks?.port).not.toBe(7457);
  });
});
