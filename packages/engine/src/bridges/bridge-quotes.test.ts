import { accountRefSchema, type Bridge, type NoBridgeRoute } from "@binference/chain";
import { err, ok } from "@binference/core";
import { describe, expect, it } from "vitest";
import { expectOk } from "../intents/test-intents.js";
import { testCall } from "../operations/test-engine.js";
import {
  type BridgeEngineOptions,
  bridgeEngine,
  testArrives,
  testBridge,
  testOtherArrives,
  testRoute,
} from "./test-bridges.js";

// The fake bridge, its quote or build changed as a test needs; each test makes it from the fake
// the engine started with.
async function proposeWith(
  change: (fake: Bridge) => Partial<Bridge>,
  options: BridgeEngineOptions = {},
) {
  const base = await bridgeEngine(options);
  const bridge = { ...base.bridge, ...change(base.bridge) };
  const { test } = await bridgeEngine({ ...options, bridge });
  return test.engine.handlers["intent/propose"](testCall(testBridge()));
}

// The fake's quote with its least output lowered to 90 of 100, past the agent's 2% slippage limit.
function keepsTen(fake: Bridge): Partial<Bridge> {
  return {
    quote: async (request, options) => {
      const quoted = await fake.quote(request, options);
      return quoted.ok
        ? ok({ ...quoted.value, minOut: { ...quoted.value.minOut, base: 90_000_000n } })
        : quoted;
    },
  };
}

// The fake's decode with a bound deposit's recipient moved to another address.
function paysElsewhere(fake: Bridge): Partial<Bridge> {
  return {
    decode: (draft) => {
      const decoded = fake.decode(draft);
      return decoded.ok && decoded.value.kind === "bound"
        ? ok({ ...decoded.value, recipient: accountRefSchema.parse("fake:2:0x000000b2") })
        : decoded;
    },
  };
}

// The fake's decode with every bound deposit read as an order, which names no recipient.
function readsAsOrder(fake: Bridge): Partial<Bridge> {
  return {
    decode: (draft) => {
      const decoded = fake.decode(draft);
      if (!decoded.ok) {
        return decoded;
      }
      const { contract, depositor, amountIn } = decoded.value;
      return ok({ kind: "order", contract, depositor, amountIn, orderId: "0x01" });
    },
  };
}

const answering = (answer: NoBridgeRoute) => (): Partial<Bridge> => ({
  quote: async () => Promise.resolve(err(answer)),
});
const throwing = (): Partial<Bridge> => ({
  quote: async () => Promise.reject(new Error("Across is down")),
});

// A second route to the destination, delivering another token.
const otherRoute = { ...testRoute, arrives: testOtherArrives };
const twoRoutes = { routes: [testRoute, otherRoute] };

// The fake's quote answering each route its own way: the route token by `first`, the other by
// `second`.
const byRoute =
  (first: (fake: Bridge) => Partial<Bridge>, second: (fake: Bridge) => Partial<Bridge>) =>
  (fake: Bridge): Partial<Bridge> => ({
    quote: async (request, options) => {
      const answer = request.deliveredAsset === testArrives ? first(fake) : second(fake);
      return answer.quote === undefined
        ? fake.quote(request, options)
        : answer.quote(request, options);
    },
  });

// The fake's quote with its fee named in the delivered token instead of the one sent.
function feeInAnotherToken(fake: Bridge): Partial<Bridge> {
  return {
    quote: async (request, options) => {
      const quoted = await fake.quote(request, options);
      return quoted.ok
        ? ok({
            ...quoted.value,
            fees: quoted.value.fees.map((fee) => ({
              ...fee,
              amount: { ...fee.amount, asset: request.deliveredAsset },
            })),
          })
        : quoted;
    },
  };
}

describe("quoting and building a bridge", () => {
  it.each<readonly [string, (fake: Bridge) => Partial<Bridge>, string]>([
    ["below the floor and no route", byRoute(keepsTen, answering("no_route")), "price_impact"],
    ["down and too low", byRoute(throwing, answering("amount_too_low")), "amount_too_low"],
    ["down and no route", byRoute(throwing, answering("no_route")), "venue_down"],
  ])(
    "ends a bridge whose routes answer %s with the reason that helps most",
    async (_, change, reason) => {
      const view = expectOk(await proposeWith(change, twoRoutes));
      expect(view.outcome?.reason).toBe(reason);
    },
  );

  it("takes no quote with a fee in another token than the one sent", async () => {
    const view = expectOk(await proposeWith(feeInAnotherToken));
    expect(view.outcome?.reason).toBe("venue_down");
  });

  it.each<readonly [NoBridgeRoute, string]>([
    ["no_route", "bridge_no_route"],
    ["amount_too_low", "amount_too_low"],
    ["amount_too_high", "amount_too_high"],
    ["low_liquidity", "bridge_liquidity"],
  ])("ends a bridge whose route answers %s with its own reason", async (answer, reason) => {
    const view = expectOk(await proposeWith(answering(answer)));
    expect([view.state, view.outcome?.reason]).toStrictEqual(["failed_check", reason]);
  });

  it("ends a bridge whose venue throws as the venue down", async () => {
    const view = expectOk(await proposeWith(throwing));
    expect(view.outcome?.reason).toBe("venue_down");
  });

  it("takes no quote that keeps more than the agent's slippage limit", async () => {
    const view = expectOk(await proposeWith(keepsTen));
    expect(view.outcome?.reason).toBe("price_impact");
  });

  it("ends a bridge whose deposit decodes to another recipient as a mismatch", async () => {
    const view = expectOk(await proposeWith(paysElsewhere));
    expect([view.state, view.outcome?.reason]).toStrictEqual(["failed_check", "decode_mismatch"]);
  });

  it("refuses an order deposit from a main wallet as a mismatch", async () => {
    const view = expectOk(await proposeWith(readsAsOrder));
    expect(view.outcome?.reason).toBe("decode_mismatch");
  });
});
