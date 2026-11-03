import { join } from "node:path";
import { createFormatter } from "@binference/i18n";
import { runCommandWithin } from "@binference/platform";
import { afterEach, describe, expect, it } from "vitest";
import {
  type FakeTailscale,
  type FakeTailscaleState,
  fakeStatus,
  fakeTailnetName,
  writeFakeTailscale,
} from "./fake-tailscale.js";
import { type InitMachine, runOn, secretEnv } from "./init-fixtures.js";
import { freePort } from "./test-host.js";
import { createRunningEngines } from "./unlock-fixtures.js";

const slow = { timeout: 60_000 };
const engines = createRunningEngines();
const english = createFormatter({ locale: "en", timeZone: "UTC" });
const mini = `${fakeTailnetName}:443`;
const hooks = `${fakeTailnetName}:8443`;
const both = { mini: true, webhooks: true };

afterEach(async () => {
  await engines.stopAll();
});

interface Remote {
  readonly machine: InitMachine;
  readonly fake: FakeTailscale;
  readonly ports: { readonly engine: number; readonly webhooks: number };
}

async function remoteMachine(state: (ports: Remote["ports"]) => FakeTailscaleState) {
  const machine = await engines.setUp();
  const ports = { engine: await freePort(), webhooks: await freePort() };
  const fake = await writeFakeTailscale(join(machine.folder, "tailscale-bin"), state(ports));
  return { machine, fake, ports };
}

// `binference check` with the stand-in Tailscale on its PATH, the ports and the remote record set
// through the config's variables.
async function check(
  at: Remote,
  record: { readonly mini: boolean; readonly webhooks: boolean },
  argv: readonly string[],
) {
  const env = {
    ...secretEnv(at.machine),
    ...at.fake.env,
    BINFERENCE_ENGINE__PORT: String(at.ports.engine),
    BINFERENCE_ENGINE__WEBHOOK_PORT: String(at.ports.webhooks),
    BINFERENCE_REMOTE__MINI: String(record.mini),
    BINFERENCE_REMOTE__WEBHOOKS: String(record.webhooks),
  };
  return runOn(at.machine, ["check", ...argv], { env, parts: { runProgram: runCommandWithin } });
}

// The remote findings `check --json` printed.
async function remoteFindingsOf(
  at: Remote,
  record: { readonly mini: boolean; readonly webhooks: boolean },
) {
  const checked = await check(at, record, ["--json"]);
  const { findings } = JSON.parse(checked.stdout) as { findings: { check: string }[] };
  return {
    code: checked.code,
    findings: findings.filter((each) => each.check.startsWith("remote.")),
  };
}

// binference's own handlers on the stand-in's ports, with what a test adds.
function served(
  ports: Remote["ports"],
  extra: { readonly [key: string]: object } = {},
): FakeTailscaleState {
  return {
    status: fakeStatus(),
    serve: {
      TCP: { "443": { HTTPS: true }, "8443": { HTTPS: true }, ...extra["TCP"] },
      Web: {
        [mini]: { Handlers: { "/": { Proxy: `http://127.0.0.1:${String(ports.engine)}` } } },
        [hooks]: {
          Handlers: { "/hook/": { Proxy: `http://127.0.0.1:${String(ports.webhooks)}/hook/` } },
        },
        ...extra["Web"],
      },
      AllowFunnel: { [hooks]: true, ...extra["AllowFunnel"] },
    },
  };
}

describe("binference check on remote access", () => {
  it("passes binference's own handlers", slow, async () => {
    const at = await remoteMachine((ports) => served(ports));
    expect((await remoteFindingsOf(at, both)).findings).toStrictEqual([
      { check: "remote.funnel", level: "ok" },
      { check: "remote.loopback", level: "ok" },
      { check: "remote.serve", level: "ok" },
    ]);
  });

  it("fails when funnel publishes anything but the webhook path", slow, async () => {
    const blog = `${fakeTailnetName}:10000`;
    const at = await remoteMachine((ports) =>
      served(ports, {
        TCP: { "10000": { HTTPS: true } },
        Web: { [blog]: { Handlers: { "/": { Path: "/srv/blog" } } } },
        AllowFunnel: { [blog]: true },
      }),
    );
    const failed = await remoteFindingsOf(at, both);
    expect(failed.code).toBe(1);
    expect(failed.findings[0]).toStrictEqual({ check: "remote.funnel", level: "fail" });
    const people = await check(at, both, []);
    expect(people.stdout).toContain(english.message("cli.check.remote.funnelExtra"));
  });

  it("fails what the config records and Tailscale lacks", slow, async () => {
    const at = await remoteMachine(() => ({ status: fakeStatus(), serve: {} }));
    const gone = await remoteFindingsOf(at, { mini: true, webhooks: false });
    expect(gone.findings[2]).toStrictEqual({
      check: "remote.serve",
      level: "fail",
      problems: ["serve_changed"],
    });
  });

  it(
    "reads Tailscale whatever the records say, and fails the engine's port funneled by hand",
    slow,
    async () => {
      const at = await remoteMachine((ports) => {
        const byHand = `${fakeTailnetName}:443`;
        return {
          status: fakeStatus(),
          serve: {
            TCP: { "443": { HTTPS: true } },
            Web: {
              [byHand]: {
                Handlers: { "/": { Proxy: `http://127.0.0.1:${String(ports.engine)}` } },
              },
            },
            AllowFunnel: { [byHand]: true },
          },
        };
      });
      const none = await remoteFindingsOf(at, { mini: false, webhooks: false });
      expect(none.code).toBe(1);
      expect(none.findings).toStrictEqual([
        { check: "remote.funnel", level: "fail" },
        { check: "remote.loopback", level: "fail" },
        { check: "remote.serve", level: "ok" },
      ]);
      expect(await at.fake.calls()).not.toStrictEqual([]);
    },
  );

  it("reads the running engine's view, at the ports the engine runs on", slow, async () => {
    const machine = await engines.setUp();
    const fake = await writeFakeTailscale(join(machine.folder, "tailscale-bin"), {
      status: fakeStatus(),
      serve: {},
    });
    const env = { ...secretEnv(machine), ...fake.env };
    const parts = { runProgram: runCommandWithin, webhookPort: await freePort() };
    await engines.start(machine, { env, parts });
    expect((await runOn(machine, ["expose"], { env, parts })).code).toBe(0);
    const checked = await runOn(machine, ["check", "--json"], { env, parts });
    const { findings } = JSON.parse(checked.stdout) as { findings: { check: string }[] };
    expect(findings.filter((each) => each.check.startsWith("remote."))).toStrictEqual([
      { check: "remote.funnel", level: "ok" },
      { check: "remote.loopback", level: "ok" },
      { check: "remote.serve", level: "ok" },
    ]);
  });
});
