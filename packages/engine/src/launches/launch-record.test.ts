import { chainRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { launchReadRecordSchema } from "./launch-record.js";

const read = {
  chain: chainRefSchema.parse("fake:1"),
  toHash: "0x01",
  atMs: 1_800_000_000_000,
  launches: [],
  changes: [],
};

describe("launchReadRecordSchema", () => {
  it("takes a read of 1 to 1,000 blocks, and no other", () => {
    expect(launchReadRecordSchema.safeParse({ ...read, from: "5", to: "5" }).success).toBe(true);
    expect(launchReadRecordSchema.safeParse({ ...read, from: "1", to: "1000" }).success).toBe(true);
    expect(launchReadRecordSchema.safeParse({ ...read, from: "1", to: "1001" }).success).toBe(
      false,
    );
    expect(launchReadRecordSchema.safeParse({ ...read, from: "6", to: "5" }).success).toBe(false);
  });
});
