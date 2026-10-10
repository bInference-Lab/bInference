import { describe, expect, it } from "vitest";
import { storedUpdateSchema } from "./stored-update.js";

describe("storedUpdateSchema", () => {
  it("parses a stored update and refuses any other payload", () => {
    const stored = { update: { update_id: 1 }, isRedacted: false };
    expect(storedUpdateSchema.parse(stored)).toStrictEqual(stored);
    expect(storedUpdateSchema.safeParse({ update_id: 1 }).success).toBe(false);
  });
});
