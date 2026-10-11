import { describe, expect, it } from "vitest";
import { lastSeq } from "./last-seq";

// A ledger of `length` entries numbered from 1, counting the reads it answers.
function ledgerOf(length: number) {
  const reads: number[] = [];
  const read = async (after: number, limit: number): Promise<number> => {
    reads.push(after);
    return Math.max(0, Math.min(limit, length - after));
  };
  return { read, reads };
}

describe("the ledger's last entry", () => {
  it.each([0, 1, 2, 3, 50, 51, 1_000, 123_456])(
    "finds entry %i as the last one",
    async (length) => {
      const ledger = ledgerOf(length);
      await expect(lastSeq(ledger.read)).resolves.toBe(length);
    },
  );

  it("reads about twice per doubling of the ledger's length", async () => {
    const ledger = ledgerOf(123_456);
    await lastSeq(ledger.read);
    expect(ledger.reads.length).toBeLessThanOrEqual(2 * Math.ceil(Math.log2(123_456)) + 2);
  });
});
