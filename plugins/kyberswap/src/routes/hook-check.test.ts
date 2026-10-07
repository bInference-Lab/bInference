import * as fc from "fast-check";
import { type Address, getAddress, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import type { RouteHop } from "../api/route-answer.schema.js";
import { unlistedHookSources } from "./hook-check.js";

const fairflow: Address = "0x44428C6ce391915D51F963C0Dd395Cd0f95fdFD2";
const unlisted: Address = "0xb0BAa371b899950B4Ef6A27c21bAf5ef7c434d0f";
const allowed: ReadonlySet<Address> = new Set([fairflow]);

function infinityHop(hookAddress: string, exchange = "pancake-infinity-cl-x"): RouteHop {
  return { exchange, poolType: "pancake-infinity-cl", hookAddress };
}

const hookArbitrary = fc
  .uint8Array({ minLength: 20, maxLength: 20 })
  .map((bytes) => getAddress(`0x${Buffer.from(bytes).toString("hex")}`));

// What the allowlist should drop: the sources of pools whose hook is neither zero nor listed.
function expectedSources(hooks: readonly Address[], listed: ReadonlySet<Address>): string[] {
  const dropped = hooks
    .map((address, index) => ({ address, source: `dex-${String(index)}` }))
    .filter(({ address }) => address !== zeroAddress && !listed.has(address))
    .map(({ source }) => source);
  return [...new Set(dropped)].toSorted();
}

describe("the hook allowlist", () => {
  it.each<[string, RouteHop]>([
    ["a pool of no hooked kind", { exchange: "pancake-v3", poolType: "pancake-v3" }],
    ["an Infinity pool with no hook", infinityHop(zeroAddress)],
    ["an allowed hook in lower case", infinityHop(fairflow.toLowerCase())],
    ["an allowed hook in checksum case", infinityHop(fairflow)],
  ])("passes %s", (_case, hop) => {
    expect(unlistedHookSources([hop], allowed)).toStrictEqual([]);
  });

  it.each<[string, RouteHop, string]>([
    ["an unlisted hook", infinityHop(unlisted), "pancake-infinity-cl-x"],
    ["a hook it cannot read", infinityHop(""), "pancake-infinity-cl-x"],
    [
      "an Infinity pool that names no hook",
      { exchange: "pancake-infinity-bin", poolType: "pancake-infinity-bin" },
      "pancake-infinity-bin",
    ],
    [
      "a v4 pool that names no hook",
      { exchange: "uniswap-v4-fee", poolType: "uniswap-v4" },
      "uniswap-v4-fee",
    ],
    [
      "a hook on a pool of no known hooked kind",
      { exchange: "new-dex", poolType: "new-dex", hookAddress: unlisted },
      "new-dex",
    ],
  ])("drops %s", (_case, hop, source) => {
    expect(unlistedHookSources([hop], allowed)).toStrictEqual([source]);
  });

  it("names each dropped source once, in order", () => {
    const hops = [
      infinityHop(unlisted, "b"),
      infinityHop(unlisted, "a"),
      infinityHop(unlisted, "b"),
    ];
    expect(unlistedHookSources(hops, allowed)).toStrictEqual(["a", "b"]);
  });

  it("drops a route exactly when one of its pools runs a hook off the list", () => {
    const hooks = fc.array(hookArbitrary, { maxLength: 6 });
    fc.assert(
      fc.property(hooks, hooks, (routeHooks, list) => {
        const hops = routeHooks.map((address, index) =>
          infinityHop(address, `dex-${String(index)}`),
        );
        const listed = new Set(list);
        expect(unlistedHookSources(hops, listed)).toStrictEqual(
          expectedSources(routeHooks, listed),
        );
      }),
    );
  });
});
