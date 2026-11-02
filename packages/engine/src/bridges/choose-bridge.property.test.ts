import { err, ok } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { QuoteFailure } from "../intents/intent-reason.js";
import { bestRoute, type ChosenBridge, type QuotedRoute } from "./choose-bridge.js";

const reasons: readonly QuoteFailure[] = [
  "swap_rate",
  "price_impact",
  "amount_too_low",
  "amount_too_high",
  "bridge_liquidity",
  "venue_down",
  "bridge_no_route",
];

/** A route's least output in base units of a token with these decimals, or why it refused. */
type Spec = { readonly minOut: bigint; readonly decimals: number } | QuoteFailure;

// A route that quoted: its least output in base units of a token with these decimals.
function routeOf(index: number, minOut: bigint, decimals: number): ChosenBridge {
  return {
    candidate: { route: { decimals: { leaves: 18, arrives: decimals } }, index },
    quote: { minOut: { asset: "fake:2/slip44:1", base: minOut } },
  } as unknown as ChosenBridge;
}

const quotedOf = (specs: readonly Spec[]): readonly QuotedRoute[] =>
  specs.map((spec, index) =>
    typeof spec === "string" ? err(spec) : ok(routeOf(index, spec.minOut, spec.decimals)),
  );

const quoted: fc.Arbitrary<readonly QuotedRoute[]> = fc
  .array(
    fc.oneof(
      fc.record({
        minOut: fc.bigInt({ min: 0n, max: 10n ** 30n }),
        decimals: fc.constantFrom(6, 18),
      }),
      fc.constantFrom(...reasons),
    ),
    { maxLength: 8 },
  )
  .map(quotedOf);

// Each least output at 36 decimals, as the route's weight.
const weight = (chosen: ChosenBridge): bigint =>
  chosen.quote.minOut.base * 10n ** BigInt(36 - chosen.candidate.route.decimals.arrives);

// The first route taken whose weight no other route's passes, or none when no route was taken.
function expectedOf(routes: readonly QuotedRoute[]): ChosenBridge | undefined {
  const taken = routes.flatMap((route) => (route.ok ? [route.value] : []));
  return taken.find((route) => taken.every((other) => weight(other) <= weight(route)));
}

// What the pick took, or the reason it names when it took none.
const pickedOf = (routes: readonly QuotedRoute[]): ChosenBridge | QuoteFailure => {
  const picked = bestRoute(routes);
  return picked.ok ? picked.value : picked.error;
};

const expectedPickOf = (routes: readonly QuotedRoute[]): ChosenBridge | QuoteFailure =>
  expectedOf(routes) ?? (bestRoute(routes) as { readonly error: QuoteFailure }).error;

describe("the route a bridge takes", () => {
  it("is the quoted route with the best least output at the delivered decimals, the first of equal ones", () => {
    fc.assert(
      fc.property(quoted, (routes) => {
        expect(pickedOf(routes)).toBe(expectedPickOf(routes));
      }),
      { numRuns: 300 },
    );
  });
});
