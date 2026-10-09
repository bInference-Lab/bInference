import { describe, expect, it } from "vitest";
import { startNodeProgram } from "./node-program.js";

// Echoes each line back in capitals, prints its variables' names at "env", and exits 3 once its
// input ends.
const echo = `
process.stdin.setEncoding("utf8");
let text = "";
process.stdin.on("data", (chunk) => {
  text += chunk;
  const lines = text.split("\\n");
  text = lines.pop();
  for (const line of lines) {
    process.stdout.write(line === "env" ? JSON.stringify(Object.keys(process.env)) + "\\n" : line.toUpperCase() + "\\n");
  }
});
process.stdin.on("end", () => { process.exitCode = 3; });
`;

const live = (): AbortSignal => new AbortController().signal;

async function firstLines(output: AsyncIterable<Uint8Array>, count: number): Promise<string[]> {
  const lines: string[] = [];
  let text = "";
  for await (const chunk of output) {
    text += Buffer.from(chunk).toString("utf8");
    lines.push(...text.split("\n").slice(0, -1));
    text = text.slice(text.lastIndexOf("\n") + 1);
    if (lines.length >= count) {
      break;
    }
  }
  return lines;
}

describe("a Node program", () => {
  it("talks over its standard input and output, and ends with its exit code", async () => {
    const program = startNodeProgram({
      args: ["--input-type=module", "-e", echo],
      parentEnv: {},
      signal: live(),
    });
    await program.write("hello\n");
    await program.write("signer\n");
    await expect(firstLines(program.output, 2)).resolves.toStrictEqual(["HELLO", "SIGNER"]);
    await program.end();
    await expect(program.exited).resolves.toBe(3);
  });

  it("gets only the variables it is given, and none of its parent's", async () => {
    const program = startNodeProgram({
      args: ["--input-type=module", "-e", echo],
      parentEnv: { BINFERENCE_SECRET_THING: "parent only", PATH: "/usr/bin" },
      env: { BINFERENCE_GIVEN: "1" },
      signal: live(),
    });
    await program.write("env\n");
    const [names = "[]"] = await firstLines(program.output, 1);
    const seen: unknown = JSON.parse(names);
    expect(seen).toContain("BINFERENCE_GIVEN");
    expect(seen).not.toContain("BINFERENCE_SECRET_THING");
    expect(seen).not.toContain("PATH");
    program.kill();
    await expect(program.exited).resolves.toBeUndefined();
  });

  it("ends at once when its signal aborts, and refuses writes after", async () => {
    const stop = new AbortController();
    const program = startNodeProgram({
      args: ["--input-type=module", "-e", echo],
      parentEnv: {},
      signal: stop.signal,
    });
    stop.abort();
    await expect(program.exited).resolves.toBeUndefined();
    await expect(program.write("late\n")).rejects.toMatchObject({
      code: "platform.program_input_closed",
    });
  });
});
