import { describe, expect, it } from "vitest";
import { replaceNul, replaceNulDeep, replaceNulInJsonText } from "./nul-text.js";

const nul = "\u0000";
const replacement = String.fromCodePoint(0xfffd);

describe("replaceNul", () => {
  it("puts U+FFFD in place of each U+0000 and leaves other text as it is", () => {
    expect(replaceNul(`a${nul}b${nul}${nul}`)).toBe(`a${replacement}b${replacement}${replacement}`);
    expect(replaceNul("plain")).toBe("plain");
    expect(replaceNul(String.raw`\u0000`)).toBe(String.raw`\u0000`);
  });

  it("replaces U+0000 in every string and key of a JSON document, however deep", () => {
    const document = { [`k${nul}`]: [`v${nul}`, { inner: nul }], n: 1, t: true, z: null };
    expect(replaceNulDeep(document)).toStrictEqual({
      [`k${replacement}`]: [`v${replacement}`, { inner: replacement }],
      n: 1,
      t: true,
      z: null,
    });
    expect(replaceNulDeep(nul)).toBe(replacement);
  });

  it("reads U+0000 in JSON text as U+FFFD, raw or escaped, and changes nothing else", () => {
    const text = String.raw`{"a": "x\u0000y", "b": "\\u0000", "c": "\\\u0000", "n": 1.50}`;
    const read = replaceNulInJsonText(`${text}${nul}`);
    expect(read).toBe(
      `{"a": "x${replacement}y", "b": "\\\\u0000", "c": "\\\\${replacement}", "n": 1.50}${replacement}`,
    );
    expect(JSON.parse(read.slice(0, -1))).toStrictEqual({
      a: `x${replacement}y`,
      b: String.raw`\u0000`,
      c: `\\${replacement}`,
      n: 1.5,
    });
  });
});
