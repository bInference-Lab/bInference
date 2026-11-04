import { describe, expect, it } from "vitest";
import { bypassListOf, goesDirect, isBypassEntry } from "./bypass-list.js";

describe("isBypassEntry", () => {
  it.each([
    "*",
    "example.com",
    ".example.com",
    "*.example.com",
    "Example.COM.",
    "rpc.example.com:8545",
    "203.0.113.7",
    "203.0.113.7:8545",
    "2001:db8::1",
    "[2001:db8::1]",
    "[2001:db8::1]:8545",
    "10.0.0.0/8",
    "fd00::/8",
    "0.0.0.0/0",
  ])("reads %s", (entry) => {
    expect(isBypassEntry(entry)).toBe(true);
  });

  it.each([
    "",
    "http://example.com",
    "example.com:0",
    "example.com:65536",
    "example.com:port",
    "exa mple.com",
    "-example.com",
    "10.0.0.0/33",
    "fd00::/129",
    "10.0.0.0/8/8",
    "example.com/8",
    "[example.com]",
    "1.1",
    "node.10",
  ])("refuses %j", (entry) => {
    expect(isBypassEntry(entry)).toBe(false);
  });
});

describe("goesDirect", () => {
  const list = bypassListOf([
    "example.com",
    ".corp.test",
    "rpc.node.test:8545",
    "198.51.200.9",
    "[2606:4700::1]:443",
    "2001:4860::/32",
    "not an entry",
  ]);

  it.each([
    ["http://localhost:3000/", "this machine by name"],
    ["http://node.localhost/", "a name under .localhost"],
    ["http://127.0.0.1:8545/", "loopback"],
    ["http://[::1]:8545/", "loopback IPv6"],
    ["http://192.168.1.20:8545/", "a private address"],
    ["http://10.1.2.3/", "a private address"],
    ["http://[fd12::1]/", "a unique local address"],
    ["http://169.254.169.254/", "a link-local address"],
    ["https://example.com/", "a listed name"],
    ["https://api.example.com/", "a name under a listed one"],
    ["https://EXAMPLE.com./", "a listed name in another case, with its root dot"],
    ["https://a.corp.test/", "a name under a listed one written with a dot"],
    ["http://rpc.node.test:8545/", "a listed name on its port"],
    ["https://198.51.200.9/", "a listed address"],
    ["https://[2606:4700::1]/", "a listed IPv6 address on its default port"],
    ["https://[2001:4860::8888]/", "an address in a listed block"],
  ])("goes direct to %s: %s", (url) => {
    expect(goesDirect(list, url)).toBe(true);
  });

  it.each([
    ["https://api.telegram.org/", "a name no entry covers"],
    ["https://notexample.com/", "a name that only ends with a listed one's letters"],
    ["https://corp.test.evil.example/", "a listed name inside another name"],
    ["https://rpc.node.test/", "a listed name on another port"],
    ["https://[2606:4700::1]:8443/", "a listed IPv6 address on another port"],
    ["https://198.51.200.10/", "another public address"],
    ["https://8.8.8.8/", "a public address outside every block"],
  ])("sends %s through the proxy: %s", (url) => {
    expect(goesDirect(list, url)).toBe(false);
  });

  it("goes direct to a public address in a listed IPv4 block", () => {
    expect(goesDirect(bypassListOf(["8.8.0.0/16"]), "https://8.8.8.8/")).toBe(true);
  });

  it("covers a name with a name entry alone, never an address", () => {
    expect(goesDirect(bypassListOf(["8.8"]), "https://8.8.8.8/")).toBe(false);
    expect(goesDirect(bypassListOf(["dns.google"]), "https://8.8.8.8/")).toBe(false);
  });

  it("matches an IPv4 address in its IPv4-mapped form either way", () => {
    expect(goesDirect(bypassListOf(["::ffff:8.8.8.8"]), "https://8.8.8.8/")).toBe(true);
    expect(goesDirect(bypassListOf(["8.8.8.8"]), "https://[::ffff:8.8.8.8]/")).toBe(true);
  });

  it("goes direct to every host with *", () => {
    expect(goesDirect(bypassListOf(["*"]), "https://api.telegram.org/")).toBe(true);
  });

  it("covers no host with an empty list but this machine and addresses off the internet", () => {
    const empty = bypassListOf([]);
    expect(goesDirect(empty, "https://example.com/")).toBe(false);
    expect(goesDirect(empty, "http://127.0.0.1/")).toBe(true);
  });
});
