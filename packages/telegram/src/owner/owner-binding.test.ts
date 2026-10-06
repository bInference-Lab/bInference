import { describe, expect, it } from "vitest";
import { storedUpdateSchema } from "../updates/stored-update.js";
import { ownerBindingSchema } from "./owner-binding.js";

describe("the shapes the stores keep", () => {
  it("parses an owner binding and refuses one without a numeric user id", () => {
    const binding = { userId: 7_100_000_001, pairedAtMs: 1_760_000_000_000 };
    expect(ownerBindingSchema.parse(binding)).toStrictEqual(binding);
    expect(ownerBindingSchema.safeParse({ ...binding, userId: "@owner" }).success).toBe(false);
    expect(ownerBindingSchema.safeParse({ ...binding, username: "owner" }).success).toBe(false);
  });

  it("parses a stored update and refuses any other payload", () => {
    const stored = { update: { update_id: 1 }, isRedacted: false };
    expect(storedUpdateSchema.parse(stored)).toStrictEqual(stored);
    expect(storedUpdateSchema.safeParse({ update_id: 1 }).success).toBe(false);
  });
});
