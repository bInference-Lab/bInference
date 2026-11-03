import { describe, expect, it } from "vitest";
import type { TailscaleState } from "./read-tailscale.js";
import { type RemoteFacts, remoteViewOf } from "./remote-view.js";
import { type ServeConfig, serveConfigOf } from "./serve-config.js";
import { tailscaleNodeOf } from "./tailscale-node.js";

const name = "box.tail1234.ts.net";
const ports = { engine: 7456, webhooks: 7457 };
const now = 1_762_000_000_000;
const run = async () => Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
const nothing = { mini: false, webhooks: false };
const both = { mini: true, webhooks: true };

function config(json: object): ServeConfig {
  const read = serveConfigOf(JSON.stringify(json));
  expect(read).toBeDefined();
  return read ?? { ports: [], handlers: [], funnel: new Set() };
}

function running(serve: object, caps = ["https", "funnel"]): TailscaleState {
  const status = { BackendState: "Running", Self: { DNSName: `${name}.`, Capabilities: caps } };
  const node = tailscaleNodeOf(`warning: client version differs\n${JSON.stringify(status)}`);
  expect(node).toBeDefined();
  return {
    kind: "running",
    run,
    node: node ?? { running: true, https: true, funnel: true, funnelPorts: [] },
    config: config(serve),
  };
}

function facts(record = both, engineAnswers = false): RemoteFacts {
  return { record, ports, engineAnswers, now };
}

const ours = {
  TCP: { "443": { HTTPS: true }, "8443": { HTTPS: true } },
  Web: {
    [`${name}:443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:7456" } } },
    [`${name}:8443`]: { Handlers: { "/hook/": { Proxy: "http://127.0.0.1:7457/hook/" } } },
  },
  AllowFunnel: { [`${name}:8443`]: true },
};

describe("remoteViewOf", () => {
  it("shows both addresses while binference's handlers are published, with no problem", () => {
    expect(remoteViewOf(running(ours), facts())).toStrictEqual({
      tailscale: "running",
      miniUrl: `https://${name}`,
      webhookUrl: `https://${name}:8443`,
      published: { mini: true, webhooks: true },
      problems: [],
      checkedAt: now,
    });
  });

  it("names a funnel beyond the webhook path, whoever set it", () => {
    const extra = {
      ...ours,
      TCP: { ...ours.TCP, "10000": { HTTPS: true } },
      Web: { ...ours.Web, [`${name}:10000`]: { Handlers: { "/": { Text: "hi" } } } },
      AllowFunnel: { ...ours.AllowFunnel, [`${name}:10000`]: true },
    };
    expect(remoteViewOf(running(extra), facts(nothing)).problems).toStrictEqual(["funnel_extra"]);
  });

  it("names the engine's port reached beyond binference's private Mini App handler", () => {
    const forward = { TCP: { "2222": { TCPForward: "localhost:7456" } } };
    const publicMini = { ...ours, AllowFunnel: { [`${name}:443`]: true } };
    expect(remoteViewOf(running(forward), facts(nothing)).problems).toStrictEqual([
      "engine_exposed",
    ]);
    expect(remoteViewOf(running(publicMini), facts()).problems).toStrictEqual([
      "funnel_extra",
      "engine_exposed",
      "serve_changed",
    ]);
    expect(remoteViewOf(running(ours), facts(both, true)).problems).toStrictEqual([
      "engine_exposed",
    ]);
  });

  it("names what the record says binference published and Tailscale lacks", () => {
    expect(remoteViewOf(running({}, []), facts()).problems).toStrictEqual([
      "https_off",
      "funnel_denied",
      "serve_changed",
    ]);
    expect(remoteViewOf(running({}, []), facts(nothing)).problems).toStrictEqual([]);
  });

  it("reads a stopped Tailscale as signed out only when binference recorded something", () => {
    expect(remoteViewOf({ kind: "stopped", run }, facts())).toStrictEqual({
      tailscale: "stopped",
      problems: ["logged_out"],
      checkedAt: now,
    });
    expect(remoteViewOf({ kind: "stopped", run }, facts(nothing)).problems).toStrictEqual([]);
    expect(remoteViewOf({ kind: "absent" }, facts(nothing, true))).toStrictEqual({
      tailscale: "absent",
      problems: ["engine_exposed"],
      checkedAt: now,
    });
  });
});

describe("tailscaleNodeOf", () => {
  it("reads the funnel ports capability, ranges included, from CapMap", () => {
    const status = {
      BackendState: "Running",
      Self: {
        DNSName: `${name}.`,
        CapMap: {
          https: null,
          funnel: null,
          "https://tailscale.com/cap/funnel-ports?ports=443,8000-9000": null,
        },
      },
    };
    expect(tailscaleNodeOf(JSON.stringify(status))).toStrictEqual({
      running: true,
      https: true,
      funnel: true,
      funnelPorts: [
        { from: 443, to: 443 },
        { from: 8000, to: 9000 },
      ],
      name,
    });
    expect(tailscaleNodeOf("failed to connect to local tailscaled")).toBeUndefined();
  });
});

describe("serveConfigOf", () => {
  it("keeps every session's entry of a port, so a foreground one hides no forward", () => {
    const status = {
      TCP: { "443": { TCPForward: "127.0.0.1:7456" } },
      Foreground: { session: { TCP: { "443": { HTTPS: true } } } },
    };
    expect(serveConfigOf(JSON.stringify(status))?.ports).toStrictEqual([
      { port: "443", https: false, forward: "127.0.0.1:7456" },
      { port: "443", https: true },
    ]);
  });

  it("reads an older CLI's null as an empty config, and other text as none", () => {
    expect(serveConfigOf("null\n")).toStrictEqual({ ports: [], handlers: [], funnel: new Set() });
    expect(serveConfigOf("failed to connect to local tailscaled")).toBeUndefined();
  });
});
