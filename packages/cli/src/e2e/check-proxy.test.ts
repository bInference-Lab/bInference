import { type Http, type OutboundRoute, routeChoiceOf } from "@binference/core";
import { type StandInProxy, startStandInProxy } from "@binference/platform/testing";
import { startStandInModelServer } from "@binference/runtime/testing";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { runCli } from "../program/run-cli.js";
import { createSystemHttp, type OutboundSwitch, type SystemHttp } from "../runtime/system-http.js";
import {
  createTestMachines,
  freePort,
  type HostParts,
  hostWith,
  type TestMachine,
  writeTestConfig,
} from "./test-host.js";

// `network.proxy` of `binference check`: the owner's proxy reaches Telegram, and the check names
// what keeps it from doing so, never the proxy.
const slow = { timeout: 60_000 };
const machines = createTestMachines();
const held: { proxies: StandInProxy[]; adapters: SystemHttp[] } = { proxies: [], adapters: [] };
const credentials = "owner:hunter2-proxy-pass";
const findingSchema = z.looseObject({ check: z.string(), level: z.string() });

afterEach(async () => {
  await Promise.all(held.adapters.splice(0).map(async (made) => made.close()));
  await Promise.all(held.proxies.splice(0).map(async (proxy) => proxy.close()));
  await machines.removeAll();
});

async function machineWithProxy(): Promise<TestMachine> {
  const machine = await machines.create(1_800_000_000_000);
  const extra = [
    '  engine: { unlock: { mode: "file" } },',
    '  network: { proxy: { fromEnv: "TEST_PROXY" }, noProxy: ["example.org"] },',
    "",
  ].join("\n");
  await writeTestConfig(machine.folder, extra);
  return machine;
}

async function standIn(options: { readonly refuseWith?: number } = {}): Promise<StandInProxy> {
  const started = await startStandInProxy({ toPort: await freePort(), credentials, ...options });
  held.proxies.push(started);
  return started;
}

function systemHttp(): SystemHttp {
  const made = createSystemHttp({ version: "2026.10.0-test" });
  held.adapters.push(made);
  return made;
}

// One `check` run with the proxy variable set as given: its `network.proxy` finding and its text.
async function checked(
  proxy: string | undefined,
  parts: HostParts,
): Promise<{ readonly finding: unknown; readonly printed: string }> {
  const machine = await machineWithProxy();
  const env = proxy === undefined ? {} : { TEST_PROXY: proxy };
  const json = hostWith(machine, ["check", "--json"], { env, parts });
  await runCli(json);
  const { findings } = z
    .object({ findings: z.array(findingSchema) })
    .parse(JSON.parse(json.stdout()));
  const text = hostWith(machine, ["check"], { env, parts });
  await runCli(text);
  return {
    finding: findings.find((finding) => finding.check === "network.proxy"),
    printed: `${json.stdout()}${text.stdout()}${text.stderr()}`,
  };
}

const through = (proxy: StandInProxy, userInfo = credentials): string =>
  proxy.url.replace("http://", `http://${userInfo}@`);

function adapterParts(): HostParts {
  const http = systemHttp();
  return { http, outbound: http };
}

describe("binference check with the owner's proxy", () => {
  it("says the proxy cannot be read", slow, async () => {
    const { finding, printed } = await checked(undefined, adapterParts());
    expect(finding).toStrictEqual({ check: "network.proxy", level: "fail", problem: "unread" });
    expect(printed).toContain("cannot read the proxy");
  });

  it("says the proxy is no proxy URL, without showing it", slow, async () => {
    const { finding, printed } = await checked("proxy.owner.test:3128", adapterParts());
    expect(finding).toStrictEqual({ check: "network.proxy", level: "fail", problem: "badUrl" });
    expect(printed).not.toContain("proxy.owner.test");
  });

  it("says the proxy refused its credentials, without showing them", slow, async () => {
    const proxy = await standIn();
    const { finding, printed } = await checked(through(proxy, "owner:wrong-pass"), adapterParts());
    expect(finding).toStrictEqual({ check: "network.proxy", level: "fail", problem: "auth" });
    expect(proxy.tunnels).toContain("api.telegram.org:443");
    expect(printed).not.toContain("wrong-pass");
    expect(printed).not.toContain(new URL(proxy.url).host);
  });

  it("names the status the proxy refused Telegram with", slow, async () => {
    const proxy = await standIn({ refuseWith: 403 });
    const { finding, printed } = await checked(through(proxy), adapterParts());
    expect(finding).toStrictEqual({
      check: "network.proxy",
      level: "fail",
      problem: "refused",
      status: 403,
    });
    expect(printed).toContain("The proxy answered 403");
  });

  it("says the proxy cannot be connected to, without its address", slow, async () => {
    const closed = `http://${credentials}@127.0.0.1:${String(await freePort())}`;
    const { finding, printed } = await checked(closed, adapterParts());
    expect(finding).toStrictEqual({
      check: "network.proxy",
      level: "fail",
      problem: "unreachable",
    });
    expect(printed).not.toContain("hunter2");
  });

  it("warns when the proxy opens the tunnel and Telegram does not answer", slow, async () => {
    // The stand-in's tunnel reaches a server that speaks no TLS, so no answer comes through it.
    const plain = await startStandInModelServer([{ status: 200, headers: {}, chunks: [] }]);
    const proxy = await startStandInProxy({
      toPort: Number(new URL(plain.origin).port),
      credentials,
    });
    held.proxies.push(proxy);
    try {
      const { finding } = await checked(through(proxy), adapterParts());
      expect(finding).toStrictEqual({ check: "network.proxy", level: "warn", problem: "noAnswer" });
    } finally {
      await plain.close();
    }
  });

  it(
    "passes once Telegram answers through the proxy, and leaves config's route in force",
    slow,
    async () => {
      const routes: OutboundRoute[] = [];
      const outbound: OutboundSwitch = {
        use: (route) => {
          routes.push(route);
        },
        openSocket: () => {
          throw new Error("The check opens no socket.");
        },
      };
      const answered: string[] = [];
      const http: Http = {
        request: async (request) => {
          answered.push(request.url);
          return Promise.resolve({ status: 302, headers: {}, body: "" });
        },
      };
      const { finding } = await checked("http://proxy.owner.test:3128", { http, outbound });
      expect(finding).toStrictEqual({ check: "network.proxy", level: "ok" });
      expect(answered).toContain("https://api.telegram.org/");
      const choices = routes.map((route) => routeChoiceOf(route, "https://example.org/"));
      expect(choices.slice(0, 2)).toStrictEqual(["proxy", "direct"]);
    },
  );
});
