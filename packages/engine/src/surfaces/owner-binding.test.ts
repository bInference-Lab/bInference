import { describe, expect, it } from "vitest";
import { ownerBindingSchema } from "./owner-binding.js";

describe("ownerBindingSchema", () => {
  it("parses an owner binding and refuses one without a numeric user id", () => {
    const binding = { userId: 7_100_000_001, pairedAtMs: 1_760_000_000_000 };
    expect(ownerBindingSchema.parse(binding)).toStrictEqual(binding);
    expect(ownerBindingSchema.safeParse({ ...binding, userId: "@owner" }).success).toBe(false);
    expect(ownerBindingSchema.safeParse({ ...binding, username: "owner" }).success).toBe(false);
  });
});
