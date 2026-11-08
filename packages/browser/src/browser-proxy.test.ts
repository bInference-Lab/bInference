import { createSecret } from "@binference/core";
import { describe, expect, it } from "vitest";
import { browserRouteOf } from "./browser-proxy.js";

describe("the route of the agent's browser", () => {
  it("goes direct without a proxy", () => {
    expect(browserRouteOf({ noProxy: ["localhost"] })).toStrictEqual({ kind: "direct" });
  });

  it("goes through the proxy with its sign-in apart and a name covering the names under it", () => {
    const proxy = createSecret("http://me:p%40ss@proxy.example:3128/");
    expect(
      browserRouteOf({ proxy, noProxy: ["127.0.0.1", "corp.example", "10.0.0.0/8"] }),
    ).toStrictEqual({
      kind: "proxy",
      proxy: {
        server: "http://proxy.example:3128",
        bypass: "127.0.0.1,corp.example,.corp.example,10.0.0.0/8",
        username: "me",
        password: "p@ss",
      },
    });
  });

  it("holds while the proxy cannot be read or is no proxy URL", () => {
    expect(browserRouteOf({ proxy: "unread", noProxy: [] })).toStrictEqual({ kind: "held" });
    const wrong = createSecret("socks5://proxy.example:1080");
    expect(browserRouteOf({ proxy: wrong, noProxy: [] })).toStrictEqual({ kind: "held" });
  });

  it("goes direct when every host skips the proxy", () => {
    const proxy = createSecret("https://proxy.example/");
    expect(browserRouteOf({ proxy, noProxy: ["*"] })).toStrictEqual({ kind: "direct" });
  });
});
