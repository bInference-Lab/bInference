import { PassThrough } from "node:stream";
import type { ChatTerminal } from "@binference/tui";
import { afterEach, describe, expect, it } from "vitest";
import { skeletonCompositions } from "../compose/test-skeleton.js";
import { runCli } from "../program/run-cli.js";
import { type ServedSkeleton, serveSkeleton } from "./skeleton-machine.js";
import { createTestMachines, hostWith, runOn, type TestMachine } from "./test-host.js";

// `binference chat` in this process: the refusals before any chat, and a chat on a terminal of
// streams that the owner leaves with Ctrl+C. The pseudo-terminal round trip is terminal-chat.test.ts.

const machines = createTestMachines();
const served: ServedSkeleton[] = [];

afterEach(async () => {
  await Promise.all(served.splice(0).map(async (skeleton) => skeleton.close()));
  await machines.removeAll();
});

async function servedMachine(): Promise<TestMachine> {
  const machine = await machines.create(0);
  const [composition] = skeletonCompositions;
  if (composition !== undefined) {
    served.push(await serveSkeleton(machine, composition));
  }
  return machine;
}

// A terminal of streams 100 columns wide, the keys it was given, and what it showed.
function streamTerminal(keys: string): { readonly terminal: ChatTerminal; shown: () => string } {
  const input = new PassThrough();
  const output = new PassThrough();
  const written: Buffer[] = [];
  output.on("data", (chunk: Buffer) => {
    written.push(chunk);
    if (Buffer.concat(written).toString("utf8").includes("Ctrl+C leaves.")) {
      input.write(keys);
    }
  });
  const terminal: ChatTerminal = {
    input,
    output,
    enterRawMode: () => undefined,
    leaveRawMode: () => undefined,
    size: () => ({ columns: 100, rows: 30 }),
    onResize: () => () => undefined,
  };
  return { terminal, shown: () => Buffer.concat(written).toString("utf8") };
}

describe("binference chat", () => {
  it("needs a terminal on both ends, so a pipe and --json are refused", async () => {
    const machine = await servedMachine();
    const piped = await runOn(machine, ["chat"]);
    expect(piped.code).toBe(1);
    expect(piped.stderr).toContain(
      "binference chat needs a terminal on both its input and its output.",
    );
    const json = await runOn(machine, ["chat", "--json"]);
    expect(json.code).toBe(1);
    expect(json.stdout).toContain('"code":"cli.chat_needs_terminal"');
  });

  it("refuses an agent the engine does not have", async () => {
    const machine = await servedMachine();
    const { terminal } = streamTerminal("");
    const unknown = "agt_0190f1c2-3a4b-7c5d-8e6f-0000000000ff";
    const host = hostWith(machine, ["chat", "--agent", unknown], {
      env: {},
      parts: { chatTerminal: terminal },
    });
    await expect(runCli(host)).resolves.toBe(1);
    expect(host.stderr()).toContain("This agent does not exist.");
  });

  it("chats with the only agent in the owner's language and exits 0 on Ctrl+C", async () => {
    const machine = await servedMachine();
    const { terminal, shown } = streamTerminal("\u0003");
    const host = hostWith(machine, ["chat"], { env: {}, parts: { chatTerminal: terminal } });
    await expect(runCli(host)).resolves.toBe(0);
    expect(shown()).toContain("Chat with main.");
    expect(shown()).toContain("Chat closed.");
  });
});
