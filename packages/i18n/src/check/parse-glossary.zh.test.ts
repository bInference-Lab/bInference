import { describe, expect, it } from "vitest";
import { parseGlossary } from "./parse-glossary.js";

const glossary = [
  "# Glossary",
  "",
  "## Names",
  "",
  "| English | 中文 |",
  "| ------- | ---- |",
  "| ignored | 忽略 |",
  "",
  "## Chinese terms",
  "",
  "- Address the reader as 你.",
  "",
  "### Trading",
  "",
  "| English                       | 中文                   | Notes |",
  "| ----------------------------- | ---------------------- | ----- |",
  "| buy, sell, trade              | 买入, 卖出, 交易       |       |",
  "| network fee, gas              | 网络费                 |       |",
  "| token (crypto)                | 代币                   |       |",
  "| token (of a model)            | Token                  |       |",
  "| approve (an agent, an order)  | 批准                   |       |",
  "| brakes (pause, resume, stop)  | 刹车 (暂停, 恢复, 停止) |       |",
  "| expire, expires, expiry       | 过期, 到期             |       |",
  "| Mini App                      | Mini App               |       |",
  "",
  "## Later",
  "",
  "| English | 中文 |",
  "| ------- | ---- |",
  "| after   | 之后 |",
].join("\r\n");

describe("parseGlossary", () => {
  it("pairs the items of lists that have the same length", () => {
    expect(parseGlossary(glossary)).toContainEqual({ english: "sell", chinese: ["卖出"] });
  });

  it("gives every English item each Chinese word when the lists differ in length", () => {
    const terms = parseGlossary(glossary);
    expect(terms).toContainEqual({ english: "gas", chinese: ["网络费"] });
    expect(terms).toContainEqual({ english: "expiry", chinese: ["过期", "到期"] });
  });

  it("drops a bracket that names a sense, and merges the senses of one term", () => {
    const terms = parseGlossary(glossary);
    expect(terms).toContainEqual({ english: "token", chinese: ["代币", "Token"] });
    expect(terms).toContainEqual({ english: "approve", chinese: ["批准"] });
  });

  it("pairs the items of brackets in both cells", () => {
    const terms = parseGlossary(glossary);
    expect(terms).toContainEqual({ english: "brakes", chinese: ["刹车"] });
    expect(terms).toContainEqual({ english: "resume", chinese: ["恢复"] });
  });

  it("reads only the tables under Chinese terms, in lower case", () => {
    const english = parseGlossary(glossary).map((term) => term.english);
    expect(english).toContain("mini app");
    expect(english).not.toContain("ignored");
    expect(english).not.toContain("after");
    expect(english).not.toContain("english");
  });

  it("returns no terms without the section", () => {
    expect(parseGlossary("# Glossary\n\n| buy | 买入 |")).toStrictEqual([]);
  });
});
