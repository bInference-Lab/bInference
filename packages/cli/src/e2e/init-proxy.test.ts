import { join } from "node:path";
import type { OutboundRoute } from "@binference/core";
import { createFileSecretStore, writePrivateFile } from "@binference/platform";
import {
  type TempFolder,
  type StandInProxy,
  startStandInProxy,
} from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../program/run-cli.js";
import { createSystemHttp, type OutboundSwitch, type SystemHttp } from "../runtime/system-http.js";
import { createScriptedPrompter } from "../term/scripted-prompter.js";
import { setUpWithOwnerKey } from "./attach-fixtures.js";
import {
  configText,
  type InitMachine,
  initFlags,
  newInitMachine,
  runOn,
  secretEnv,
} from "./init-fixtures.js";
import { freePort, hostWith, noPermissions } from "./test-host.js";

// `binference init --proxy` (decision 0347): init's checks go through the owner's proxy, and an
// attach goes through the one the install's config names, or `--proxy` without one.
const slow = { timeout: 60_000 };
const folders: TempFolder[] = [];
const held: { proxies: StandInProxy[]; adapters: SystemHttp[] } = { proxies: [], adapters: [] };
const live = { signal: new AbortController().signal };
const password = "hunter2-proxy-pass";
const ownedProxy = "http://proxy.owner.test:3128";
const otherProxy = "http://other.owner.test:8080";

afterEach(async () => {
  await Promise.all(held.adapters.splice(0).map(async (made) => made.close()));
  await Promise.all(held.proxies.splice(0).map(async (made) => made.close()));
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

// A route as a test reads it: the proxy URL it goes through, or its kind.
function shown(route: OutboundRoute): string {
  return route.kind === "proxy" ? route.proxy.reveal() : route.kind;
}

/** Every route a command put in force on its outbound adapter, oldest first, as shown. */
function recordedOutbound(): {
  readonly outbound: OutboundSwitch;
  readonly routes: () => readonly string[];
} {
  const routes: OutboundRoute[] = [];
  const outbound: OutboundSwitch = {
    use: (route) => {
      routes.push(route);
    },
    openSocket: () => {
      throw new Error("Init opens no socket.");
    },
  };
  return { outbound, routes: () => routes.map(shown) };
}

async function initWith(
  machine: InitMachine,
  run: {
    readonly argv: readonly string[];
    readonly env?: Readonly<Record<string, string>>;
    readonly outbound: OutboundSwitch;
  },
) {
  const env = { ...secretEnv(machine), ...run.env };
  const argv = ["init", "--yes", ...initFlags(machine), ...run.argv];
  return runOn(machine, argv, { env, parts: { outbound: run.outbound } });
}

// The proxy URL init kept in `keys/`, or `none`.
async function keptProxy(machine: InitMachine): Promise<string> {
  const keys = join(machine.folder, "keys");
  const store = createFileSecretStore({ folder: keys, permissions: noPermissions });
  const read = await store.read("network-proxy", live.signal);
  return read.ok ? read.value.reveal() : "none";
}

// Adds `network.proxy` to the install's config.json5, from the variable TEST_PROXY.
async function proxyInConfig(machine: InitMachine): Promise<void> {
  const text = (await configText(machine)) ?? "";
  const network = `  network: { proxy: { fromEnv: "TEST_PROXY" } },\n}`;
  const files = { permissions: noPermissions, signal: live.signal };
  const file = join(machine.folder, "config.json5");
  await writePrivateFile(file, text.replace(/\}\s*$/, network), files);
}

// Attaches with the owner key typed; the route is in force before attach reaches Privy.
async function attachWith(
  machine: InitMachine,
  run: { readonly ownerKey: string; readonly argv: readonly string[] },
): Promise<readonly string[]> {
  const recorded = recordedOutbound();
  const prompter = createScriptedPrompter({ ownerKey: [run.ownerKey] });
  const host = hostWith(machine, ["init", "--attach", ...run.argv], {
    env: { ...secretEnv(machine), TEST_PROXY: ownedProxy, OTHER_PROXY: otherProxy },
    parts: { http: machine.world, prompter, outbound: recorded.outbound },
  });
  await runCli(host);
  return recorded.routes();
}

describe("binference init --proxy", () => {
  it("sends init's model check through the proxy, and prints none of it", slow, async () => {
    const machine = await newInitMachine(folders);
    // The proxy refuses every tunnel, so the check fails there and nothing reaches a host.
    const proxy = await startStandInProxy({
      toPort: await freePort(),
      credentials: `owner:${password}`,
      refuseWith: 502,
    });
    held.proxies.push(proxy);
    const http = createSystemHttp({ version: "2026.10.0-test" });
    held.adapters.push(http);
    const argv = ["init", "--yes", ...initFlags(machine), "--proxy", '{ fromEnv: "TEST_PROXY" }'];
    const host = hostWith(machine, argv, {
      env: { ...secretEnv(machine), TEST_PROXY: proxy.url.replace("//", `//owner:${password}@`) },
      parts: { http, outbound: http },
    });
    await expect(runCli(host)).resolves.toBe(1);
    expect(proxy.tunnels).toContain("api.openai.com:443");
    const printed = `${host.stdout()}${host.stderr()}`;
    expect(printed).not.toContain(password);
    expect(printed).not.toContain(new URL(proxy.url).host);
    await expect(configText(machine)).resolves.toBeUndefined();
  });

  it("checks through the proxy a secret source names, and writes that source", slow, async () => {
    const machine = await newInitMachine(folders);
    const recorded = recordedOutbound();
    const run = await initWith(machine, {
      argv: ["--proxy", '{ fromEnv: "TEST_PROXY" }'],
      env: { TEST_PROXY: ownedProxy },
      outbound: recorded.outbound,
    });
    expect([run.code, run.stderr]).toStrictEqual([0, ""]);
    expect(recorded.routes()).toStrictEqual([ownedProxy]);
    await expect(configText(machine)).resolves.toContain('fromEnv: "TEST_PROXY"');
    expect(run.stdout).not.toContain("proxy.owner.test");
  });

  it(
    "keeps a URL its variable gives where init keeps typed secrets, never in the config",
    slow,
    async () => {
      const machine = await newInitMachine(folders);
      const recorded = recordedOutbound();
      const run = await initWith(machine, {
        argv: [],
        env: { BINFERENCE_INIT_PROXY: ownedProxy },
        outbound: recorded.outbound,
      });
      expect([run.code, run.stderr]).toStrictEqual([0, ""]);
      expect(recorded.routes()).toStrictEqual([ownedProxy]);
      await expect(keptProxy(machine)).resolves.toBe(ownedProxy);
      const config = await configText(machine);
      expect(config).toContain(join(machine.folder, "keys", "network-proxy"));
      expect(config).not.toContain("proxy.owner.test");
    },
  );

  it("refuses a URL with a password before any check, and shows it nowhere", slow, async () => {
    const machine = await newInitMachine(folders);
    const recorded = recordedOutbound();
    const run = await initWith(machine, {
      argv: [],
      env: { BINFERENCE_INIT_PROXY: `http://owner:${password}@proxy.owner.test:3128` },
      outbound: recorded.outbound,
    });
    expect(run.code).toBe(1);
    expect(run.stderr).toContain("holds a secret as plain text");
    expect(`${run.stdout}${run.stderr}`).not.toContain(password);
    expect(recorded.routes()).toStrictEqual([]);
  });

  it("refuses a proxy that is no proxy URL", slow, async () => {
    const machine = await newInitMachine(folders);
    const recorded = recordedOutbound();
    const run = await initWith(machine, {
      argv: [],
      env: { BINFERENCE_INIT_PROXY: "proxy.owner.test:3128" },
      outbound: recorded.outbound,
    });
    expect(run.code).toBe(1);
    expect(run.stderr).toContain("names no http:// or https:// proxy URL");
    expect(recorded.routes()).toStrictEqual([]);
  });

  it(
    "takes only a secret source on the command line, and points to the variable for a URL",
    slow,
    async () => {
      const machine = await newInitMachine(folders);
      const recorded = recordedOutbound();
      const run = await initWith(machine, {
        argv: ["--proxy", ownedProxy],
        outbound: recorded.outbound,
      });
      expect(run.code).toBe(1);
      expect(run.stderr).toContain("takes the proxy only as a secret source");
      expect(run.stderr).toContain("BINFERENCE_INIT_PROXY");
      expect(`${run.stdout}${run.stderr}`).not.toContain("proxy.owner.test");
      expect(recorded.routes()).toStrictEqual([]);
    },
  );
});

describe("binference init --attach with a proxy", () => {
  it("goes through the proxy the install's config names, over --proxy", slow, async () => {
    const { machine, ownerKey } = await setUpWithOwnerKey(folders);
    await proxyInConfig(machine);
    const routes = await attachWith(machine, {
      ownerKey,
      argv: ["--proxy", '{ fromEnv: "OTHER_PROXY" }'],
    });
    // The flag's proxy is in force from the start, the config's once attach has read it.
    expect(routes).toStrictEqual([otherProxy, ownedProxy]);
  });

  it("goes through --proxy when the install's config names none", slow, async () => {
    const { machine, ownerKey } = await setUpWithOwnerKey(folders);
    const routes = await attachWith(machine, {
      ownerKey,
      argv: ["--proxy", '{ fromEnv: "OTHER_PROXY" }'],
    });
    expect(new Set(routes)).toStrictEqual(new Set([otherProxy]));
  });
});
