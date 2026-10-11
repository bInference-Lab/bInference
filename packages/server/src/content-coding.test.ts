import { describe, expect, it } from "vitest";
import { pickCoding } from "./content-coding.js";

const both = ["br", "gzip"] as const;

describe("picking a content coding", () => {
  it.each([
    { name: "a browser's usual header", header: "gzip, deflate, br, zstd", coding: "br" },
    { name: "a client that takes gzip only", header: "gzip", coding: "gzip" },
    { name: "weights that put gzip first", header: "br;q=0.5, gzip;q=0.9", coding: "gzip" },
    { name: "Brotli refused", header: "br;q=0, gzip", coding: "gzip" },
    { name: "any coding", header: "*", coding: "br" },
    { name: "any coding but Brotli", header: "*;q=0.8, br;q=0", coding: "gzip" },
    { name: "case and spaces", header: " BR ; Q=1 ", coding: "br" },
  ] as const)("answers in the best one for $name", ({ header, coding }) => {
    expect(pickCoding(header, both)).toBe(coding);
  });

  it("answers in the one coding a file is kept in", () => {
    expect(pickCoding("br, gzip", ["gzip"])).toBe("gzip");
  });

  it.each([
    ["no header", undefined, both],
    ["identity only", "identity", both],
    ["every coding refused", "br;q=0, gzip;q=0", both],
    ["a file kept in no coding", "br, gzip", []],
    ["a weight that is no number", "br;q=x, gzip;q=x", both],
  ] as const)("answers the file's own bytes for %s", (_name, header, available) => {
    expect(pickCoding(header, available)).toBeUndefined();
  });
});
