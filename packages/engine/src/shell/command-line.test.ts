import { describe, expect, it } from "vitest";
import { readCommandLine } from "./command-line.js";

function wordsOf(line: string): readonly (readonly string[])[] | "unreadable" {
  const read = readCommandLine(line);
  return read.kind === "read" ? read.steps.map((step) => step.words) : read.kind;
}

describe("reading a command line", () => {
  it("splits a line into steps at pipes, chains and line breaks", () => {
    expect(wordsOf("git status && git log -1 | head -n 3; ls\nwc -l")).toStrictEqual([
      ["git", "status"],
      ["git", "log", "-1"],
      ["head", "-n", "3"],
      ["ls"],
      ["wc", "-l"],
    ]);
    expect(wordsOf("a || b |& c")).toStrictEqual([["a"], ["b"], ["c"]]);
  });

  it("reads quotes and backslashes as the shell does, a quoted space inside one word", () => {
    expect(wordsOf(`echo 'a b' "c \\"d\\" \\\\" e\\ f ''`)).toStrictEqual([
      ["echo", "a b", 'c "d" \\', "e f", ""],
    ]);
    expect(wordsOf(`grep -e '$HOME' "a|b"`)).toStrictEqual([["grep", "-e", "$HOME", "a|b"]]);
  });

  it("keeps each step as it was written", () => {
    expect(readCommandLine("  ls   -l  |  wc -l ")).toMatchObject({
      steps: [{ text: "ls   -l" }, { text: "wc -l" }],
    });
  });

  it.each([
    "echo $HOME",
    'echo "$HOME"',
    "echo $(id)",
    "echo `id`",
    "cat <(ls)",
    "ls > out.txt",
    "ls 2>&1",
    "cat <<EOF",
    "sleep 10 &",
    "(ls)",
    "{ ls; }",
    "ls *.txt",
    "ls file?.txt",
    "ls [ab]",
    "echo {a,b}",
    "ls ~/x",
    "ls a~b",
    "ls # comment",
    "=ls",
    "! ls",
    "ls ^x",
    "ls \\\n -l",
    "echo 'open",
    'echo "open',
    "ls |",
    "| ls",
    "ls && && pwd",
    "case x in a) ;; esac",
    "PATH=/tmp ls",
    "FOO+=1 ls",
    "if true; then ls; fi",
    "eval ls",
    "source ./env",
    ". ./env",
    "cd /tmp && rm -rf x",
    "export A=1",
    "exec ls",
    "printf -v PATH x",
    "ls\r",
    "",
    "   ",
  ])("cannot judge %j", (line) => {
    expect(readCommandLine(line)).toStrictEqual({ kind: "unreadable" });
  });

  it("takes an empty line or a trailing ; as no step", () => {
    expect(wordsOf("ls;\n\npwd\n")).toStrictEqual([["ls"], ["pwd"]]);
  });
});
