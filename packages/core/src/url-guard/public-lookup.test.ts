import { describe, expect, it } from "vitest";
import { type HostLookup, publicOnlyLookup, resolvesToPublic } from "./public-lookup.js";

const live = { signal: new AbortController().signal };

// A lookup that answers each name from a table, as the system's resolver would.
function lookupFrom(table: Readonly<Record<string, readonly string[]>>): HostLookup {
  return (hostname, _options, callback) => {
    const addresses = table[hostname];
    if (addresses === undefined) {
      callback(Object.assign(new Error("not found"), { code: "ENOTFOUND" }), []);
      return;
    }
    callback(
      null,
      addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
    );
  };
}

// A name that answers a public address first and a private one after: DNS rebinding.
function rebinding(): HostLookup {
  const answers = [["93.184.215.14"], ["127.0.0.1"]];
  return (_hostname, _options, callback) => {
    const address = answers.shift() ?? ["127.0.0.1"];
    callback(
      null,
      address.map((text) => ({ address: text, family: 4 })),
    );
  };
}

const never: HostLookup = () => undefined;

const names = lookupFrom({
  "push.example.com": ["142.250.74.10", "2a00:1450:4001:82a::200a"],
  "127.0.0.1.nip.io": ["127.0.0.1"],
  "mixed.example.com": ["142.250.74.10", "192.168.1.20"],
  "metadata.example.com": ["169.254.169.254"],
  "empty.example.com": [],
});

async function socketAnswer(
  lookup: HostLookup,
  hostname: string,
  options: { readonly all: boolean } = { all: false },
) {
  return new Promise((resolve) => {
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a socket's callback, as node:net types it
    publicOnlyLookup(lookup)(hostname, options, (error, address, family) => {
      resolve({ error, address, family });
    });
  });
}

describe("resolvesToPublic", () => {
  it("lets a name through when every address it resolves to is public", async () => {
    await expect(resolvesToPublic("push.example.com", { ...live, lookup: names })).resolves.toBe(
      true,
    );
  });

  it.each([
    "127.0.0.1.nip.io",
    "mixed.example.com",
    "metadata.example.com",
    "empty.example.com",
    "unknown.example.com",
    "[::1]",
    "10.0.0.1",
  ])("refuses %s", async (host) => {
    await expect(resolvesToPublic(host, { ...live, lookup: names })).resolves.toBe(false);
  });

  it("rejects with the signal's reason when it aborts", async () => {
    const stop = new AbortController();
    const waiting = resolvesToPublic("slow.example.com", { signal: stop.signal, lookup: never });
    stop.abort(new Error("stopped"));
    await expect(waiting).rejects.toThrow("stopped");
  });
});

describe("publicOnlyLookup", () => {
  it("hands a socket the public addresses it checked, one or all as asked", async () => {
    await expect(socketAnswer(names, "push.example.com")).resolves.toStrictEqual({
      error: null,
      address: "142.250.74.10",
      family: 4,
    });
    await expect(socketAnswer(names, "push.example.com", { all: true })).resolves.toMatchObject({
      error: null,
      address: [{ address: "142.250.74.10" }, { address: "2a00:1450:4001:82a::200a" }],
    });
  });

  it.each(["mixed.example.com", "metadata.example.com", "empty.example.com"])(
    "fails %s, which resolves to an address that is not public",
    async (hostname) => {
      await expect(socketAnswer(names, hostname)).resolves.toMatchObject({
        error: { code: "http.private_address", details: { host: hostname } },
      });
    },
  );

  it("passes a resolver's own failure on", async () => {
    await expect(socketAnswer(names, "unknown.example.com")).resolves.toMatchObject({
      error: { code: "ENOTFOUND" },
    });
  });

  it("fails the connection of a name that rebinds to loopback after a check passed", async () => {
    const lookup = rebinding();
    await expect(resolvesToPublic("rebind.example.com", { ...live, lookup })).resolves.toBe(true);
    await expect(socketAnswer(lookup, "rebind.example.com")).resolves.toMatchObject({
      error: { code: "http.private_address" },
    });
  });
});
