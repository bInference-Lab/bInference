import { describe, expect, it } from "vitest";
import { clockText } from "./clock-text";

describe("clockText", () => {
  it("reads the start, the middle and the end of the day", () => {
    expect(clockText(0)).toBe("00:00");
    expect(clockText(0.5)).toBe("12:00");
    expect(clockText(1)).toBe("23:59");
  });

  it("holds outside the day", () => {
    expect(clockText(-0.2)).toBe("00:00");
    expect(clockText(1.4)).toBe("23:59");
  });
});
