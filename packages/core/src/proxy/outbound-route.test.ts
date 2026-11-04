import { describe, expect, it } from "vitest";
import { createSecret } from "../secret/secret.js";
import {
  directRoute,
  isProxyUrl,
  outboundRouteOf,
  proxyUnusable,
  routeChoiceOf,
} from "./outbound-route.js";

const proxyText = "http://owner:hunter2-proxy@proxy.owner.test:3128";

describe("isProxyUrl", () => {
  it.each([
    "http://proxy.test:3128",
    "https://proxy.test:8443/",
    "http://user:pass@127.0.0.1:7890",
    "http://[::1]:3128",
  ])("takes %s", (url) => {
    expect(isProxyUrl(url)).toBe(true);
  });

  it.each([
    "proxy.test:3128",
    "socks5://proxy.test:1080",
    "ftp://proxy.test",
    "http://proxy.test:3128/path",
    "http://proxy.test:3128/?a=1",
    "http://proxy.test:3128/#top",
    "",
  ])("refuses %j", (url) => {
    expect(isProxyUrl(url)).toBe(false);
  });
});

describe("outboundRouteOf", () => {
  it("goes direct without a proxy, whatever the no-proxy list holds", () => {
    const route = outboundRouteOf({ noProxy: ["example.com"] });
    expect(route).toBe(directRoute);
    expect(routeChoiceOf(route, "https://api.telegram.org/")).toBe("direct");
  });

  it("sends through the proxy all but this machine and the listed hosts", () => {
    const route = outboundRouteOf({ proxy: createSecret(proxyText), noProxy: ["example.com"] });
    expect(routeChoiceOf(route, "https://api.telegram.org/bot/getMe")).toBe("proxy");
    expect(routeChoiceOf(route, "https://api.example.com/")).toBe("direct");
    expect(routeChoiceOf(route, "http://127.0.0.1:8545/")).toBe("direct");
  });

  it.each([
    ["unread", "unread" as const],
    ["no proxy URL", createSecret("proxy.owner.test:3128")],
  ])("holds every request but the direct ones when the proxy is %s", (_case, proxy) => {
    const route = outboundRouteOf({ proxy, noProxy: ["example.com"] });
    expect(route.kind).toBe("held");
    expect(routeChoiceOf(route, "https://api.telegram.org/")).toBe("held");
    expect(routeChoiceOf(route, "https://example.com/")).toBe("direct");
    expect(routeChoiceOf(route, "http://localhost:3000/")).toBe("direct");
  });

  it("never shows the proxy in the route", () => {
    const route = outboundRouteOf({ proxy: createSecret(proxyText), noProxy: [] });
    expect(JSON.stringify(route)).not.toContain("hunter2");
    expect(JSON.stringify(route)).not.toContain("proxy.owner.test");
  });
});

describe("proxyUnusable", () => {
  it("names the request's origin and the next step, never its path", () => {
    const error = proxyUnusable({ method: "GET", url: "https://api.telegram.org/botSECRET/getMe" });
    expect(error).toMatchObject({
      code: "http.proxy_unusable",
      details: { method: "GET", origin: "https://api.telegram.org" },
    });
    expect(error.message).toContain("binference check");
    expect(JSON.stringify(error.details)).not.toContain("SECRET");
  });
});
