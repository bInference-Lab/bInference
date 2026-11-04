import { describe, expect, it } from "vitest";
import { proposalSkipOf } from "./fill-ends.js";

describe("the skip of a fill the money path refused before any intent", () => {
  it.each([
    ["quote.no_route", "no_route"],
    ["quote.venue_down", "venue_down"],
    ["agent.archived", "fill_failed"],
    ["protocol.bad_args", "fill_failed"],
  ] as const)("names %s as %s", (code, reason) => {
    expect(proposalSkipOf(code)).toBe(reason);
  });
});
