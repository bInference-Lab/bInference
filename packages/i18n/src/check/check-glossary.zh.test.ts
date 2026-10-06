import { describe, expect, it } from "vitest";
import { checkGlossary } from "./check-glossary.js";
import type { GlossaryTerm } from "./parse-glossary.js";

const terms: readonly GlossaryTerm[] = [
  { english: "swap", chinese: ["兑换"] },
  { english: "fee", chinese: ["手续费"] },
  { english: "network fee", chinese: ["网络费"] },
  { english: "token", chinese: ["代币", "Token"] },
  { english: "cancelled", chinese: ["已取消"] },
  { english: "paired with", chinese: ["与 X 配对交易"] },
  { english: "unlock", chinese: ["解锁"] },
];

function problemsFor(english: string, chinese: string): readonly string[] {
  const files = { en: { card: { line: english } }, zh: { card: { line: chinese } } };
  return checkGlossary(files, terms).map((item) => item.text);
}

describe("checkGlossary", () => {
  it("passes a message that uses the glossary's word", () => {
    expect(problemsFor("Swap {amount}", "兑换 {amount}")).toStrictEqual([]);
  });

  it("names a term translated another way", () => {
    expect(problemsFor("Swap {amount}", "交换 {amount}")).toStrictEqual([
      expect.stringMatching(/^The English uses "swap", which the glossary writes as 兑换/),
    ]);
  });

  it("reads plurals and any case as the term", () => {
    expect(problemsFor("Two TOKENS", "两个币")).toHaveLength(1);
    expect(problemsFor("Two tokens", "两个代币")).toStrictEqual([]);
  });

  it("accepts any of the term's senses", () => {
    expect(problemsFor("model token use", "模型 Token 用量")).toStrictEqual([]);
  });

  it("reads the longest term first, so a shorter one inside it is not checked", () => {
    expect(problemsFor("the network fee", "网络费")).toStrictEqual([]);
    expect(problemsFor("the fee", "网络费")).toHaveLength(1);
  });

  it("matches whole words only", () => {
    expect(problemsFor("swapped feed", "已换")).toStrictEqual([]);
  });

  it("accepts a finished-action word without its mark, before or after an argument", () => {
    expect(problemsFor("Cancelled on {surface}", "已在 {surface} 取消")).toStrictEqual([]);
  });

  it("matches a word written with X where an argument goes, in order", () => {
    expect(problemsFor("paired with {pair}", "与 {pair} 配对交易")).toStrictEqual([]);
    expect(problemsFor("paired with {pair}", "配对交易与 {pair}")).toHaveLength(1);
  });

  it("skips code spans and argument names", () => {
    expect(problemsFor("Run `binference unlock` for {token}", "运行 `binference unlock`")).toEqual(
      [],
    );
  });

  it("skips keys the Chinese lacks and messages that do not parse", () => {
    const files = {
      en: { card: { line: "Swap", other: "Swap {x" } },
      zh: { card: { other: "x" } },
    };
    expect(checkGlossary(files, terms)).toStrictEqual([]);
  });
});
