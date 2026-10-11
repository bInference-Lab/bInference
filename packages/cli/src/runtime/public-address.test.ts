import type { LookupAddress } from "node:dns";
import { describe, expect, it } from "vitest";
import {
  type HostLookup,
  isPublicAddress,
  publicOnlyLookup,
  resolvesToPublic,
} from "./public-address.js";

const live = { signal: new AbortController().signal };

// A lookup that answers each name from a table, as the system's resolver would.
function lookupFrom(table: Readonly<Record<string, readonly string[]>>): HostLookup {
  return (hostname, _options, callback) => {
    const addresses = table[hostname];
    if (addresses === undefined) {
      callback(Object.assign(new Error("not found"), { code: "ENOTFOUND" }), []);
      return;
    }
    const answered: LookupAddress[] = addresses.map((address) => ({
      address,
      family: address.includes(":") ? 6 : 4,
    }));
    callback(null, answered);
  };
}

const names = lookupFrom({
  "push.example.com": ["142.250.74.10", "2a00:1450:4001:82a::200a"],
  "127.0.0.1.nip.io": ["127.0.0.1"],
  "mixed.example.com": ["142.250.74.10", "192.168.1.20"],
});

describe("isPublicAddress", () => {
  it.each(["142.250.74.10", "1.1.1.1", "2a00:1450:4001:82a::200a"])(
    "lets %s through",
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );

  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fd00::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "64:ff9b::a00:1",
    "2002:7f00:1::",
    "localhost",
  ])("refuses %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});

describe("resolvesToPublic", () => {
  it("lets a name through when every address it resolves to is public", async () => {
    await expect(resolvesToPublic("push.example.com", { ...live, lookup: names })).resolves.toBe(
      true,
    );
  });

  it.each(["127.0.0.1.nip.io", "mixed.example.com", "unknown.example.com", "[::1]", "10.0.0.1"])(
    "refuses %s",
    async (host) => {
      await expect(resolvesToPublic(host, { ...live, lookup: names })).resolves.toBe(false);
    },
  );
});

describe("publicOnlyLookup", () => {
  it("hands a socket the public addresses it checked, one or all as asked", async () => {
    const lookup = publicOnlyLookup(names);
    const one = await new Promise((resolve) => {
      lookup("push.example.com", {}, (error, address, family) =>
        resolve({ error, address, family }),
      );
    });
    expect(one).toStrictEqual({ error: null, address: "142.250.74.10", family: 4 });
    const all = await new Promise((resolve) => {
      lookup("push.example.com", { all: true }, (error, address) => resolve({ error, address }));
    });
    expect(all).toMatchObject({ error: null, address: [{ address: "142.250.74.10" }, {}] });
  });

  it("fails a name that resolves to any address that is not public", async () => {
    const lookup = publicOnlyLookup(names);
    const failed = await new Promise((resolve) => {
      lookup("mixed.example.com", {}, (error) => resolve(error));
    });
    expect(failed).toMatchObject({ code: "http.private_address" });
  });
});
