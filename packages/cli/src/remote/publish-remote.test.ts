import { join } from "node:path";
import type { JsonValue } from "@binference/core";
import { testNowMs } from "@binference/engine/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  type FakeTailscale,
  type FakeTailscaleState,
  fakeStatus,
  fakeTailnetName,
  writeFakeTailscale,
} from "../e2e/fake-tailscale.js";
import { createTestMachines, testSystem } from "../e2e/test-host.js";
import { publishRemote, unpublishRemote } from "./publish-remote.js";
import type { RemotePart } from "./remote-handlers.js";
import { findTailscale } from "./tailscale-cli.js";

const live = new AbortController().signal;
const ports = { engine: 17_456, webhooks: 17_457 };
const machines = createTestMachines();
const mini = `${fakeTailnetName}:443`;
const hooks = `${fakeTailnetName}:8443`;
const theirs = `${fakeTailnetName}:10000`;
const engineUrl = "http://127.0.0.1:17456";

afterEach(async () => machines.removeAll());

async function fake(state: Partial<FakeTailscaleState> = {}): Promise<FakeTailscale> {
  const machine = await machines.create(testNowMs);
  const folder = join(machine.folder, "tailscale-bin");
  return writeFakeTailscale(folder, { status: fakeStatus(), serve: {}, ...state });
}

async function publish(at: FakeTailscale, parts: readonly RemotePart[], to = ports) {
  return publishRemote(await findTailscale(at.host), { parts, ports: to }, live);
}

async function unpublish(at: FakeTailscale) {
  return unpublishRemote(await findTailscale(at.host), { ports, isRecorded: true }, live);
}

async function changes(at: FakeTailscale): Promise<readonly (readonly string[])[]> {
  return (await at.calls()).filter((call) => !call.includes("status"));
}

const ourWeb = {
  [mini]: { Handlers: { "/": { Proxy: engineUrl } } },
  [hooks]: { Handlers: { "/hook/": { Proxy: "http://127.0.0.1:17457/hook/" } } },
};
const ourServe: JsonValue = {
  TCP: { "443": { HTTPS: true }, "8443": { HTTPS: true } },
  Web: ourWeb,
  AllowFunnel: { [hooks]: true },
};
const emptied = { TCP: {}, Web: {}, AllowFunnel: {} };

describe("publishRemote", () => {
  it("serves the Mini App on 443 and funnels only /hook/ on 8443", async () => {
    const at = await fake();
    await expect(publish(at, ["mini", "webhooks"])).resolves.toStrictEqual({
      ok: true,
      value: fakeTailnetName,
    });
    expect(await at.serve()).toStrictEqual(ourServe);
    expect(await changes(at)).toStrictEqual([
      ["serve", "--bg", "--yes", "--https=443", "--set-path=/", engineUrl],
      [
        "funnel",
        "--bg",
        "--yes",
        "--https=8443",
        "--set-path=/hook/",
        "http://127.0.0.1:17457/hook/",
      ],
    ]);
  });

  it("reads an older CLI's null serve config as empty", async () => {
    const at = await fake({ serve: null });
    await expect(publish(at, ["mini"])).resolves.toMatchObject({ ok: true });
  });

  it("changes nothing that is already published as binference set it", async () => {
    const at = await fake({ serve: ourServe });
    await expect(publish(at, ["mini", "webhooks"])).resolves.toMatchObject({ ok: true });
    expect(await changes(at)).toStrictEqual([]);
  });

  it("fails tailscale_missing with no Tailscale CLI on the PATH", async () => {
    const at = await fake();
    const run = await findTailscale({ env: {}, system: testSystem });
    await expect(publishRemote(run, { parts: ["mini"], ports }, live)).resolves.toStrictEqual({
      ok: false,
      error: "tailscale_missing",
    });
    expect(await at.calls()).toStrictEqual([]);
  });

  it.each<[string, Partial<FakeTailscaleState>, readonly RemotePart[]]>([
    ["logged_out", { daemon: "down" }, ["mini"]],
    ["logged_out", { status: fakeStatus({ backend: "NeedsLogin" }) }, ["mini"]],
    ["https_off", { status: fakeStatus({ caps: [] }) }, ["mini"]],
    ["funnel_denied", { status: fakeStatus({ caps: ["https"] }) }, ["mini", "webhooks"]],
    [
      "funnel_port",
      {
        status: fakeStatus({
          caps: ["https", "funnel", "https://tailscale.com/cap/funnel-ports?ports=443,10000"],
        }),
      },
      ["webhooks"],
    ],
    [
      "port_taken",
      { serve: { Web: { [mini]: { Handlers: { "/blog/": { Path: "/srv/blog" } } } } } },
      ["mini"],
    ],
    ["port_taken", { serve: { TCP: { "8443": { TCPForward: "127.0.0.1:22" } } } }, ["webhooks"]],
    ["port_taken", { serve: { AllowFunnel: { [mini]: true } } }, ["mini"]],
    [
      "port_taken",
      { serve: { Web: { [hooks]: { Handlers: { "/hook/": { Proxy: engineUrl } } } } } },
      ["webhooks"],
    ],
  ])("fails %s before any change", async (failure, state, parts) => {
    const at = await fake(state);
    await expect(publish(at, parts)).resolves.toStrictEqual({ ok: false, error: failure });
    expect(await changes(at)).toStrictEqual([]);
  });

  it("refuses to funnel the webhook path to the engine's own port", async () => {
    const at = await fake();
    const same = { engine: 17_456, webhooks: 17_456 };
    await expect(publish(at, ["mini", "webhooks"], same)).resolves.toStrictEqual({
      ok: false,
      error: "same_port",
    });
    expect(await changes(at)).toStrictEqual([]);
  });

  it("fails not_operator when Tailscale refuses the account, leaving nothing", async () => {
    const text = "sending serve config: Access denied: serve config denied";
    const at = await fake({ refuse: { command: "serve", text } });
    await expect(publish(at, ["mini"])).resolves.toStrictEqual({
      ok: false,
      error: "not_operator",
    });
    expect(await at.serve()).toStrictEqual({});
  });

  it("reads Windows' Access is denied as the account refused", async () => {
    const at = await fake({ refuse: { command: "serve", text: "Access is denied." } });
    await expect(publish(at, ["mini"])).resolves.toStrictEqual({
      ok: false,
      error: "not_operator",
    });
  });

  it("fails not_applied when Tailscale exits 0 but changes nothing", async () => {
    const at = await fake({ ignore: true });
    await expect(publish(at, ["mini"])).resolves.toStrictEqual({
      ok: false,
      error: "not_applied",
    });
  });

  it("takes the Mini App off again when the funnel then fails", async () => {
    const at = await fake({ refuse: { command: "funnel", text: "error: listener failed" } });
    await expect(publish(at, ["mini", "webhooks"])).resolves.toStrictEqual({
      ok: false,
      error: "not_applied",
    });
    expect((await changes(at)).at(-1)).toStrictEqual([
      "serve",
      "--yes",
      "--https=443",
      "--set-path=/",
      "off",
    ]);
    expect(await at.serve()).toStrictEqual(emptied);
  });

  it("undoes a funnel the CLI applied before its call ran out of time", async () => {
    const at = await fake({ hang: { command: "funnel", ms: 30_000 } });
    const run = await findTailscale(at.host, { timeoutMs: 1_500 });
    await expect(
      publishRemote(run, { parts: ["mini", "webhooks"], ports }, live),
    ).resolves.toStrictEqual({ ok: false, error: "not_applied" });
    expect(await at.serve()).toStrictEqual(emptied);
  });

  it("undoes what a stopped job applied, on time of its own", async () => {
    const at = await fake({ hang: { command: "funnel", ms: 30_000 } });
    const stop = new AbortController();
    const run = await findTailscale(at.host);
    const published = publishRemote(run, { parts: ["webhooks"], ports }, stop.signal);
    await at.untilServe((serve) => JSON.stringify(serve).includes(hooks));
    stop.abort();
    await expect(published).resolves.toStrictEqual({ ok: false, error: "not_applied" });
    expect(await at.serve()).toStrictEqual(emptied);
  });
});

describe("unpublishRemote", () => {
  it("takes off only binference's handlers, and names nothing left", async () => {
    const other = { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } } };
    const at = await fake({
      serve: {
        TCP: { "443": { HTTPS: true }, "8443": { HTTPS: true }, "10000": { HTTPS: true } },
        Web: { ...ourWeb, [theirs]: other },
        AllowFunnel: { [hooks]: true },
      },
    });
    await expect(unpublish(at)).resolves.toStrictEqual({
      ok: true,
      value: { published: { mini: false, webhooks: false }, left: [], name: fakeTailnetName },
    });
    expect(await at.serve()).toStrictEqual({
      TCP: { "10000": { HTTPS: true } },
      Web: { [theirs]: other },
      AllowFunnel: {},
    });
  });

  it.each<[string, JsonValue, object]>([
    [
      "a second mount on 443",
      {
        TCP: { "443": { HTTPS: true } },
        Web: { [mini]: { Handlers: { "/": { Proxy: engineUrl }, "/blog/": { Path: "/srv" } } } },
      },
      { port: 443, mount: "/", target: engineUrl, isPublic: false },
    ],
    [
      "funnel on 443",
      {
        TCP: { "443": { HTTPS: true } },
        Web: { [mini]: { Handlers: { "/": { Proxy: engineUrl } } } },
        AllowFunnel: { [mini]: true },
      },
      { port: 443, mount: "/", target: engineUrl, isPublic: true },
    ],
    [
      "the 8443 handler pointed at the engine",
      {
        TCP: { "8443": { HTTPS: true } },
        Web: { [hooks]: { Handlers: { "/hook/": { Proxy: engineUrl } } } },
        AllowFunnel: { [hooks]: true },
      },
      { port: 8443, mount: "/hook/", target: engineUrl, isPublic: true },
    ],
  ])("names what still publishes the engine with %s, and leaves it", async (_case, serve, left) => {
    const at = await fake({ serve });
    const done = await unpublish(at);
    expect(done).toMatchObject({ ok: true, value: { published: { mini: false }, left: [left] } });
    expect(await changes(at)).toStrictEqual([]);
  });

  it("has nothing to take off without Tailscale or a record, and fails while it is down", async () => {
    const none = { ports, isRecorded: false };
    await expect(unpublishRemote(undefined, none, live)).resolves.toMatchObject({ ok: true });
    await expect(
      unpublishRemote(undefined, { ports, isRecorded: true }, live),
    ).resolves.toStrictEqual({ ok: false, error: "tailscale_missing" });
    const down = await fake({ daemon: "down" });
    await expect(unpublish(down)).resolves.toStrictEqual({ ok: false, error: "logged_out" });
  });

  it("fails not_operator when Tailscale refuses the account, leaving both", async () => {
    const at = await fake({ serve: ourServe, refuseOff: "Access denied: serve config denied" });
    await expect(unpublish(at)).resolves.toStrictEqual({ ok: false, error: "not_operator" });
    expect(await at.serve()).toStrictEqual(ourServe);
  });

  it("names its own handler as left when the CLI fails to take it off", async () => {
    const at = await fake({ serve: ourServe, refuseOff: "error: something broke" });
    await expect(unpublish(at)).resolves.toMatchObject({
      ok: true,
      value: {
        published: { mini: true, webhooks: true },
        left: [
          { port: 443, mount: "/", isPublic: false },
          { port: 8443, mount: "/hook/", isPublic: true },
        ],
      },
    });
  });
});
