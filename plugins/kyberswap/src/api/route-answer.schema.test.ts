import { describe, expect, it } from "vitest";
import { buyRoute } from "../testing/recorded-buy.js";
import { hookedRoute } from "../testing/recorded-routes.js";
import { type FoundRoute, readRouteAnswer } from "./route-answer.schema.js";

const hookedHop = {
  exchange: "pancake-infinity-cl-fairflow",
  poolType: "pancake-infinity-cl",
  poolExtra: { hookAddress: "0x44428c6ce391915d51f963c0dd395cd0f95fdfd2" },
};
const plainHop = { exchange: "pancake-v3", poolType: "pancake-v3", poolExtra: { swapFee: 100 } };

// The recorded route with its one pool replaced by `hop`.
function routeWith(hop: object): string {
  const answer = JSON.parse(buyRoute) as { data: { routeSummary: { route: object[][] } } };
  answer.data.routeSummary.route = [[{ tokenIn: "x", tokenOut: "y", extra: null, ...hop }]];
  return JSON.stringify(answer);
}

function routeOf(body: string): FoundRoute {
  const route = readRouteAnswer(body);
  if (route === undefined) {
    throw new Error("The answer is no route.");
  }
  return route;
}

function nested(depth: number): object {
  return depth === 0 ? plainHop : { inner: nested(depth - 1) };
}

describe("kyberswap's routes answer", () => {
  it("reads the recorded route, its pool and its summary as JSON text", () => {
    const route = routeOf(buyRoute);
    expect(route).toMatchObject({
      routerAddress: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5",
      tokenIn: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      tokenOut: "0x55d398326f99059fF775485246999027B3197955",
      amountIn: 10n ** 17n,
      amountInUsd: "76.75563175843",
      chargesFee: false,
      hops: [{ exchange: "pancake-v3", poolType: "pancake-v3" }],
    });
    expect(route).toHaveProperty(
      "summary",
      expect.stringContaining('"routeID":"6a335978Y0ZPxrhr"'),
    );
  });

  it("reads a pool's hook", () => {
    expect(routeOf(hookedRoute).hops).toStrictEqual([
      {
        exchange: "pancake-infinity-cl-fairflow",
        poolType: "pancake-infinity-cl",
        hookAddress: "0x44428c6ce391915d51f963c0dd395cd0f95fdfd2",
      },
    ]);
  });

  it("reads the candidate pools nested in a pool's extra data", () => {
    const route = routeWith({ ...plainHop, extra: { _ce: { ces: [hookedHop] }, _ss: plainHop } });
    expect(routeOf(route).hops.map((hop) => hop.exchange)).toStrictEqual([
      "pancake-v3",
      "pancake-infinity-cl-fairflow",
      "pancake-v3",
    ]);
  });

  it("keeps a hook field it cannot read as an empty hook", () => {
    const route = routeWith({ ...hookedHop, poolExtra: { hookAddress: 7 } });
    expect(routeOf(route).hops.map((hop) => hop.hookAddress)).toStrictEqual([""]);
  });

  it("reads nesting as deep as KyberSwap's, and refuses an answer nested deeper", () => {
    expect(routeOf(routeWith({ ...plainHop, extra: nested(28) })).hops).toHaveLength(2);
    expect(readRouteAnswer(routeWith({ ...plainHop, extra: nested(40) }))).toBeUndefined();
  });

  it.each([
    ["a fee", buyRoute.replace('"feeAmount": ""', '"feeAmount": "8"'), true],
    ["no fee field", buyRoute.replace(/"extraFee": \{[^}]*\},/, ""), false],
  ])("tells whether the route takes %s", (_case, route, chargesFee) => {
    expect(routeOf(route).chargesFee).toBe(chargesFee);
  });

  it.each([
    ["an error answer", '{"code":4008,"message":"route not found"}'],
    [
      "a route with no path",
      buyRoute.replace(/"route": \[[\s\S]*\],\s*"routerAddress"/, '"route": [], "routerAddress"'),
    ],
    [
      "an amount in another form",
      buyRoute.replace('"amountIn": "100000000000000000"', '"amountIn": "1e17"'),
    ],
    ["text that is no JSON", "{"],
  ])("refuses %s", (_case, body) => {
    expect(readRouteAnswer(body)).toBeUndefined();
  });
});
