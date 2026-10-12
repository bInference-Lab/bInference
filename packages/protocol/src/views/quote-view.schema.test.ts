import { describe, expect, it } from "vitest";
import { quoteView } from "../examples/wire-values.js";
import { quoteViewSchema } from "./quote-view.schema.js";

describe("quoteViewSchema", () => {
  it("reads a swap's quote, which names no place", () => {
    expect(quoteViewSchema.parse(quoteView)).not.toHaveProperty("place");
  });

  it.each([[{ kind: "curve", launchpad: "flap" }], [{ kind: "pools" }]] as const)(
    "reads the place of a buy or a sell: %o",
    (place) => {
      expect(quoteViewSchema.parse({ ...quoteView, place }).place).toStrictEqual(place);
    },
  );

  it.each([
    ["a curve with no launchpad", { kind: "curve" }],
    ["a place of another kind", { kind: "orderBook" }],
    ["a launchpad id that is not a venue id", { kind: "curve", launchpad: "Flap Curve" }],
  ] as const)("refuses %s", (_name, place) => {
    expect(quoteViewSchema.safeParse({ ...quoteView, place }).success).toBe(false);
  });
});
