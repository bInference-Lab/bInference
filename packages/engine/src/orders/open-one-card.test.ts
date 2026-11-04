import { err, ok } from "@binference/core";
import { describe, expect, it } from "vitest";
import { storedUnlessTaken } from "./open-one-card.js";

const taken = {
  code: "engine.order_not_stored",
  message: "The new order's id is taken.",
} as const;

describe("a record a store stored, or its refusal", () => {
  it("answers the stored record, and a refusal the caller can name, as they are", () => {
    expect(storedUnlessTaken(ok("stored"), taken)).toStrictEqual(ok("stored"));
    expect(storedUnlessTaken(err("frozen"), taken)).toStrictEqual(err("frozen"));
  });

  it("throws the taken fault for an id in use, which the id source never hands out twice", () => {
    expect(() => storedUnlessTaken(err("exists"), taken)).toThrow(
      expect.objectContaining({ code: "engine.order_not_stored" }),
    );
  });
});
