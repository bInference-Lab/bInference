import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { join } from "node:path";
import { writePrivateFile } from "@binference/platform";
import { type StandInProxy, startStandInProxy } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createSystemHttp, type SystemHttp } from "../runtime/system-http.js";
import { configText, type InitMachine, secretEnv } from "./init-fixtures.js";
import { engineLogLines, freePort, noPermissions } from "./test-host.js";
import { createRunningEngines } from "./unlock-fixtures.js";

// The done-when of the outbound proxy: an engine started with a proxy in network.proxy sends
// every outbound connection to it, and its log never names the proxy.
const engines = createRunningEngines();
const held: { proxy?: StandInProxy; http?: SystemHttp } = {};
const credentials = "owner:hunter2-proxy-pass";

afterEach(async () => {
  await engines.stopAll();
  await held.http?.close();
  await held.proxy?.close();
});

// Every connection undici opened while the test ran, as `host:port`: the proxy's alone when every
// request goes through it.
function watchConnections(): { readonly opened: readonly string[]; readonly stop: () => void } {
  const opened: string[] = [];
  const schema = z.object({
    connectParams: z.object({ hostname: z.string(), port: z.union([z.string(), z.number()]) }),
  });
  const onConnect = (message: unknown): void => {
    const { connectParams } = schema.parse(message);
    opened.push(`${connectParams.hostname}:${String(connectParams.port)}`);
  };
  subscribe("undici:client:beforeConnect", onConnect);
  return { opened, stop: () => unsubscribe("undici:client:beforeConnect", onConnect) };
}

async function proxyInConfig(machine: InitMachine): Promise<void> {
  const text = (await configText(machine)) ?? "";
  const network = `  network: { proxy: { fromEnv: "TEST_PROXY" } },\n}`;
  const files = { permissions: noPermissions, signal: new AbortController().signal };
  await writePrivateFile(
    join(machine.folder, "config.json5"),
    text.replace(/\}\s*$/, network),
    files,
  );
}

describe("an engine with the owner's proxy", () => {
  it(
    "sends every outbound connection through the proxy, and never logs it",
    { timeout: 60_000 },
    async () => {
      const machine = await engines.setUp();
      await proxyInConfig(machine);
      // The proxy refuses every tunnel: nothing it is asked for reaches a host, here or outside.
      held.proxy = await startStandInProxy({
        toPort: await freePort(),
        credentials,
        refuseWith: 502,
      });
      const proxyAddress = new URL(held.proxy.url).host;
      held.http = createSystemHttp({ version: "2026.10.0-test" });
      const env = {
        ...secretEnv(machine),
        TEST_PROXY: held.proxy.url.replace("http://", `http://${credentials}@`),
      };
      const watch = watchConnections();
      try {
        const started = await engines.start(machine, {
          env,
          parts: { http: held.http, outbound: held.http },
        });
        // Privy answers only through the proxy, which refuses: custody is out of reach.
        expect(started).toMatchObject({ state: "locked", lockReason: "custody_unreachable" });
        // The bot's first call and the chain's first read come once the engine serves.
        await held.proxy.asked("api.telegram.org");
        await held.proxy.asked("bsc-dataseed.bnbchain.org");
      } finally {
        watch.stop();
      }
      // undici names a tunnelled host's connection by the host, then asks the proxy for the
      // tunnel: each host it connected to must reach the proxy, or the test times out.
      const hosts = new Set(
        watch.opened
          .filter((opened) => opened !== proxyAddress)
          .map((opened) => opened.replace(/:\d*$/, "")),
      );
      await Promise.all([...hosts].map(async (host) => held.proxy?.asked(host)));
      expect(hosts).toContain("api.privy.io");
      expect(watch.opened).toContain(proxyAddress);
      const log = (await engineLogLines(machine)).join("\n");
      expect(log).toContain("custody");
      expect(log).not.toContain(proxyAddress);
      expect(log).not.toContain("hunter2");
    },
  );
});
