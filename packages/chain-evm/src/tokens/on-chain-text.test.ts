import { describe, expect, it } from "vitest";
import { onChainText } from "./on-chain-text.js";

const nul = "\u0000";

describe("text read from the chain", () => {
  it("drops its trailing zero bytes and puts U+FFFD in place of a zero byte inside it", () => {
    expect(onChainText(`MKR${nul.repeat(29)}`)).toBe("MKR");
    expect(onChainText(`A${nul}B${nul}`)).toBe(`A${String.fromCodePoint(0xfffd)}B`);
    expect(onChainText(nul.repeat(3))).toBe("");
    expect(onChainText("Venus")).toBe("Venus");
  });
});
