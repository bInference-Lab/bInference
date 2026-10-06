import { describe, expect, it } from "vitest";
import { checkBind, isLoopbackHost } from "./check-bind.js";

describe("isLoopbackHost", () => {
  it.each([
    "127.0.0.1",
    "127.8.9.10",
    "localhost",
    "LOCALHOST",
    "::1",
    "[::1]",
    "::ffff:127.0.0.1",
  ])("counts %s as this machine only", (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  it.each(["0.0.0.0", "::", "192.168.1.10", "10.0.0.1", "::ffff:10.0.0.1", "example.com", ""])(
    "counts %s as beyond loopback",
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
    },
  );
});

describe("checkBind", () => {
  it("lets a loopback host bind without auth", () => {
    expect(() => checkBind({ host: "127.0.0.1", hasAuth: false })).not.toThrow();
  });

  it("lets a host beyond loopback bind once auth is set", () => {
    expect(() => checkBind({ host: "0.0.0.0", hasAuth: true })).not.toThrow();
  });

  it.each(["0.0.0.0", "::", "192.168.1.10", "example.com"])(
    "refuses to bind %s without auth",
    (host) => {
      expect(() => checkBind({ host, hasAuth: false })).toThrow(
        expect.objectContaining({ code: "server.unsafe_bind", details: { host } }),
      );
    },
  );
});
