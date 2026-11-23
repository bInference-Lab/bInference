import { describe, expect, it } from "vitest";
import { writingSeconds, writtenText } from "./written-text";

describe("writtenText in Chinese", () => {
  it("writes one character at a time", () => {
    expect(writtenText("正在看着你", 0.035)).toBe("正在");
    expect(writingSeconds("正在看着你")).toBeCloseTo(0.17, 5);
  });
});
