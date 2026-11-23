import { describe, expect, it } from "vitest";
import { writingSeconds, writtenText } from "./written-text";

describe("writtenText", () => {
  it("writes the first letter at once and one more each beat", () => {
    expect(writtenText("watching you", 0)).toBe("w");
    expect(writtenText("watching you", 0.035)).toBe("wa");
    expect(writtenText("watching you", 0.2)).toBe("watchi");
  });

  it("has written everything once its time is up", () => {
    const text = "ready when you are";
    expect(writtenText(text, writingSeconds(text))).toBe(text);
    expect(writtenText(text, 60)).toBe(text);
  });
});
