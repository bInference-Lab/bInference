import { describe, expect, it } from "vitest";
import { splitReasoningTags } from "./reasoning-tags.js";

const final = { isFinal: true };
const streaming = { isFinal: false };

function antml(name: string): string {
  return `antml:${name}`;
}

describe("splitReasoningTags", () => {
  it.each([
    { name: "a text with no tag", text: "No tag here.", shown: "No tag here.", reasoning: "" },
    { name: "think", text: "Hi <think>check</think> all!", shown: "Hi  all!", reasoning: "check" },
    { name: "thinking", text: "A <thinking>b</thinking> c", shown: "A  c", reasoning: "b" },
    { name: "thought", text: "A <thought>hmm</thought> B", shown: "A  B", reasoning: "hmm" },
    { name: "reasoning", text: "<reasoning>why</reasoning>Ok.", shown: "Ok.", reasoning: "why" },
    {
      name: "antthinking",
      text: "X <antthinking>in</antthinking> Y",
      shown: "X  Y",
      reasoning: "in",
    },
    {
      name: "antml forms",
      text: `<${antml("thinking")}>secret</${antml("thinking")}>Seen`,
      shown: "Seen",
      reasoning: "secret",
    },
    {
      name: "mm forms",
      text: "<mm:think>a</mm:think>A<mm:thought>b</mm:thought>B",
      shown: "AB",
      reasoning: "a\n\nb",
    },
    {
      name: "any case",
      text: "A <THINK>x</THINK> <Thinking>y</Thinking> B",
      shown: "A   B",
      reasoning: "x\n\ny",
    },
    {
      name: "attributes",
      text: "A <think id='t' c=\"a>b\">x</think> B",
      shown: "A  B",
      reasoning: "x",
    },
    { name: "spaces in the tag", text: "A < think >x< /think > B", shown: "A  B", reasoning: "x" },
    {
      name: "several sections",
      text: "<think>first</think>A<think>second</think>B",
      shown: "AB",
      reasoning: "first\n\nsecond",
    },
    {
      name: "nested sections",
      text: "<think>out <think>in</think> out</think>shown",
      shown: "shown",
      reasoning: "out\n\nin\n\nout",
    },
  ])("takes out $name", ({ text, shown, reasoning }) => {
    expect(splitReasoningTags(text, final)).toStrictEqual({
      text: shown,
      reasoning,
      isOpen: false,
    });
  });

  it("drops a private section without showing it as reasoning", () => {
    const split = splitReasoningTags("<internal>a note to itself</internal>Visible.", final);
    expect(split).toStrictEqual({ text: "Visible.", reasoning: "", isOpen: false });
  });

  it("makes the words before a close with no open reasoning", () => {
    expect(splitReasoningTags("leaked preamble</think>Real answer.", final).text).toBe(
      "Real answer.",
    );
    expect(splitReasoningTags("Before<think>x</think></think>After", final).text).toBe(
      "BeforeAfter",
    );
  });

  it("keeps the words of a final tag and drops the tag", () => {
    const split = splitReasoningTags("A <final data-x='1'>visible</final> B", final);
    expect(split.text).toBe("A visible B");
    expect(splitReasoningTags("<final-result>kept</final-result>", final).text).toBe(
      "<final-result>kept</final-result>",
    );
  });

  it("leaves tags inside code spans and fenced code blocks as text", () => {
    const span = "The `<think>` tag opens reasoning; `</think>` closes it.";
    const fence = "Example:\n```xml\n<think>\n  <thought>nested</thought>\n</think>\n```\nDone!";
    const tilde = "Example:\n~~~js\n<think>code</think>\n~~~";
    for (const text of [span, fence, tilde]) {
      expect(splitReasoningTags(text, final).text).toBe(text);
    }
  });

  it("takes out a real tag beside a quoted one", () => {
    const text = "<think>hidden</think>Visible text with `<think>` example.";
    expect(splitReasoningTags(text, final).text).toBe("Visible text with `<think>` example.");
    expect(splitReasoningTags("Start `unclosed <think>hidden</think> end", final).text).toBe(
      "Start `unclosed  end",
    );
  });

  it("leaves a word that only looks like a tag", () => {
    const text = "Here is how to use <think tags in your code";
    expect(splitReasoningTags(text, final).text).toBe(text);
    expect(splitReasoningTags("a <thinker>b</thinker>", final).text).toBe("a <thinker>b</thinker>");
  });

  it("makes a section never closed reasoning, unless it held the whole text", () => {
    const after = splitReasoningTags("Before <think>unclosed content after", final);
    expect(after).toStrictEqual({
      text: "Before",
      reasoning: "unclosed content after",
      isOpen: true,
    });
    expect(splitReasoningTags("<think>Answer after a broken tag", final).text).toBe(
      "Answer after a broken tag",
    );
    expect(splitReasoningTags("<reasoning>outer<think>secret</think>", final).text).toBe("");
  });

  it("holds back a tag a stream is still writing", () => {
    expect(splitReasoningTags("Hello <thi", streaming)).toStrictEqual({
      text: "Hello ",
      reasoning: "",
      isOpen: true,
    });
    expect(splitReasoningTags("1 < 2", streaming).text).toBe("1 < 2");
    expect(splitReasoningTags("<think>still thinking", streaming)).toStrictEqual({
      text: "",
      reasoning: "still thinking",
      isOpen: true,
    });
  });

  it("reads a long section in one pass", () => {
    const long = "x".repeat(10_000);
    expect(splitReasoningTags(`<think>${long}</think>visible`, final).text).toBe("visible");
    const ticks = `${"`".repeat(100)}<think>test</think>${"`".repeat(100)}`;
    expect(splitReasoningTags(ticks, final).text).toBe(ticks);
  });
});
