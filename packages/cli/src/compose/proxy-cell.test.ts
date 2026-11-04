import { inspect } from "node:util";
import {
  BinferenceError,
  createSecret,
  type Http,
  type OutboundRoute,
  routeChoiceOf,
} from "@binference/core";
import { createMemoryLogger } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import type { NetworkConfig } from "../config/schema/operations.schema.js";
import type { SecretReader } from "../config/secrets/secret-reader.js";
import { createSystemHttp, type OutboundSwitch } from "../runtime/system-http.js";
import { openProxyCell, type ProxyCellOptions } from "./proxy-cell.js";

const proxyUrl = "http://owner:hunter2-pass@proxy.owner.test:3128";
const telegram = "https://api.telegram.org/";
const live = (): AbortSignal => new AbortController().signal;

// Secrets by variable name; a name with no value cannot be read.
function readerOf(values: Readonly<Record<string, string>>): SecretReader {
  return {
    read: async (path, source) => {
      const value = "fromEnv" in source ? values[source.fromEnv] : undefined;
      if (value === undefined) {
        throw new BinferenceError({ code: "config.secret_unavailable", message: `No ${path}.` });
      }
      return Promise.resolve(createSecret(value));
    },
  };
}

function recorder(): { readonly outbound: OutboundSwitch; readonly routes: OutboundRoute[] } {
  const routes: OutboundRoute[] = [];
  const outbound: OutboundSwitch = {
    use: (route) => {
      routes.push(route);
    },
    openSocket: () => {
      throw new Error("No socket opens here.");
    },
  };
  return { outbound, routes };
}

// Telegram's answer to a probe through the proxy, or the failure a request through it meets.
function answering(failure?: BinferenceError): Http {
  return {
    request: async () =>
      failure === undefined
        ? Promise.resolve({ status: 302, headers: {}, body: "" })
        : Promise.reject(failure),
  };
}

function cellOptions(
  parts: Pick<ProxyCellOptions, "network" | "secrets" | "outbound"> & { readonly http?: Http },
): ProxyCellOptions {
  return {
    http: answering(),
    logger: createMemoryLogger({ subsystem: "engine" }),
    ...parts,
  };
}

describe("openProxyCell", () => {
  it("puts the proxy in force at once and hands its setting on", async () => {
    const { outbound, routes } = recorder();
    const network: NetworkConfig = { proxy: { fromEnv: "PROXY" }, noProxy: ["localhost"] };
    const cell = await openProxyCell(
      cellOptions({ network: () => network, secrets: readerOf({ PROXY: proxyUrl }), outbound }),
      live(),
    );
    expect(routes.map((route) => routeChoiceOf(route, telegram))).toStrictEqual(["proxy"]);
    expect(cell.current()).toMatchObject({ noProxy: ["localhost"] });
  });

  it("puts the direct route in force without a proxy", async () => {
    const { outbound, routes } = recorder();
    await openProxyCell(
      cellOptions({ network: () => ({ noProxy: [] }), secrets: readerOf({}), outbound }),
      live(),
    );
    expect(routes.map((route) => routeChoiceOf(route, telegram))).toStrictEqual(["direct"]);
  });

  it.each([
    ["cannot be read", {}, "config.secret_unavailable"],
    ["is no proxy URL", { PROXY: "proxy.owner.test:3128" }, "http.proxy_unusable"],
  ])(
    "holds every request when the proxy %s, and logs only its code",
    async (_case, values, code) => {
      const { outbound, routes } = recorder();
      const logger = createMemoryLogger({ subsystem: "engine" });
      await openProxyCell(
        {
          ...cellOptions({
            network: () => ({ proxy: { fromEnv: "PROXY" }, noProxy: [] }),
            secrets: readerOf(values),
            outbound,
          }),
          logger,
        },
        live(),
      );
      expect(routes.map((route) => routeChoiceOf(route, telegram))).toStrictEqual(["held"]);
      expect(logger.records()).toMatchObject([
        { level: "warn", event: "network.proxy_held", fields: { errorCode: code } },
      ]);
      expect(JSON.stringify(logger.records())).not.toContain("proxy.owner.test");
    },
  );

  it("reads network again only after a reload changed a key under it", async () => {
    const { outbound, routes } = recorder();
    const held: { network: NetworkConfig } = { network: { noProxy: [] } };
    const cell = await openProxyCell(
      cellOptions({
        network: () => held.network,
        secrets: readerOf({ PROXY: proxyUrl }),
        outbound,
      }),
      live(),
    );
    held.network = { proxy: { fromEnv: "PROXY" }, noProxy: [] };
    await expect(cell.follow(["models.main"], live())).resolves.toBeUndefined();
    await expect(cell.follow(["network.proxy"], live())).resolves.toBeUndefined();
    expect(routes.map((route) => routeChoiceOf(route, telegram))).toStrictEqual([
      "direct",
      "proxy",
    ]);
  });

  it.each([
    ["held", {}, undefined],
    ["auth", { PROXY: proxyUrl }, new BinferenceError({ code: "http.proxy_auth", message: "407" })],
    [
      "unreachable",
      { PROXY: proxyUrl },
      new BinferenceError({ code: "http.proxy_unreachable", message: "down" }),
    ],
  ] as const)(
    "answers %s as a changed proxy's first use, for the reload's notice",
    async (use, values, failure) => {
      const held: { network: NetworkConfig } = { network: { noProxy: [] } };
      const cell = await openProxyCell(
        cellOptions({
          network: () => held.network,
          secrets: readerOf(values),
          outbound: recorder().outbound,
          http: answering(failure),
        }),
        live(),
      );
      held.network = { proxy: { fromEnv: "PROXY" }, noProxy: [] };
      await expect(cell.follow(["network.proxy"], live())).resolves.toBe(use);
    },
  );

  it("keeps the proxy and its password out of the log and every failure through it", async () => {
    // A proxy at a port no one listens at: each request through it fails as the connection does.
    const password = "correct-horse-battery-staple-4417";
    const logger = createMemoryLogger({ subsystem: "engine" });
    const http = createSystemHttp({ version: "test" });
    try {
      const cell = await openProxyCell(
        {
          network: () => ({ proxy: { fromEnv: "PROXY" }, noProxy: [] }),
          secrets: readerOf({ PROXY: `http://owner:${password}@127.0.0.1:1` }),
          outbound: http,
          http,
          logger,
        },
        live(),
      );
      const failure = await http
        .request({ method: "GET", url: telegram, signal: live() })
        .catch((error: unknown) => error);
      expect(failure).toMatchObject({ code: "http.proxy_unreachable" });
      const printed = inspect([failure, cell.current(), logger.records()], { depth: null });
      expect(printed).not.toContain(password);
      expect(printed).not.toContain("127.0.0.1:1");
    } finally {
      await http.close();
    }
  });
});
