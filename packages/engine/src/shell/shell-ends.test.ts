import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { createMemoryShellStore } from "../fakes/memory-shell-store.js";
import { testAgent } from "../intents/test-intents.js";
import { createTestShell, type TestShell, type TestShellOptions } from "./test-shell.js";

const live = { signal: new AbortController().signal };
const phrase = Array.from({ length: 12 }, () => "apple").join(" ");

// A shell with `serve`, a command that runs until it is stopped or finished, left running.
async function leftRunning(options: TestShellOptions = {}) {
  const shell = await createTestShell({
    ...options,
    script: { serve: { kind: "runs", output: "listening\n" } },
  });
  const answer = await shell.run({ command: "serve", background: true, surface: "telegram" });
  expect(answer).toMatchObject({ ok: true, value: { status: "running" } });
  await shell.clock.advance(0);
  return shell;
}

// The job of the one command left running.
async function watchedJob(shell: Readonly<TestShell>) {
  const [watch] = await shell.store.watched(live);
  return idSchema("shj").parse(watch?.job);
}

describe("the end of a command the agent left running", () => {
  it("wakes the agent with its exit code, how long it ran and its last lines, masked and marked", async () => {
    const shell = await leftRunning();
    await shell.clock.advance(125_000);
    const lines = Array.from({ length: 30 }, (_, at) => `line ${String(at + 1)}`).join("\n");
    shell.runner.finish("serve", { output: `${lines}\nwords: ${phrase}\n`, exitCode: 3 });
    await shell.clock.advance(0);
    expect(shell.woken()).toMatchObject([
      { kind: "inbox/message", agent: testAgent, surface: "telegram", outsideContent: true },
    ]);
    const [text] = shell.wokenTexts();
    expect(text).toContain('your command "serve" (job shj_');
    expect(text).toContain("ended with exit code 3 after 2 min 5 s.");
    expect(text).toContain("words: [recovery phrase hidden]");
    expect(text).toContain("line 30");
    expect(text).not.toContain("line 11\n");
    expect(text).toContain("(earlier lines left out)");
    expect(await shell.store.watched(live)).toStrictEqual([]);
  });

  it("wakes the agent with U+FFFD in place of each U+0000 its command printed", async () => {
    const shell = await leftRunning();
    shell.runner.finish("serve", { output: "a\u0000b\n", exitCode: 1 });
    await shell.clock.advance(0);
    expect(shell.wokenTexts()[0]).toContain(`a${String.fromCodePoint(0xfffd)}b`);
  });

  it("wakes nobody for a quiet success, unless the setting asks for it", async () => {
    const quiet = await leftRunning();
    await quiet.job({ job: await watchedJob(quiet), action: "poll" });
    quiet.runner.finish("serve", { exitCode: 0 });
    await quiet.clock.advance(0);
    expect(quiet.woken()).toStrictEqual([]);
    const told = await leftRunning({ settings: { tellOnQuietEnd: true } });
    await told.job({ job: await watchedJob(told), action: "poll" });
    told.runner.finish("serve", { exitCode: 0 });
    await told.clock.advance(0);
    expect(told.wokenTexts()[0]).toContain("It printed nothing new.");
    expect(told.woken()[0]).not.toHaveProperty("outsideContent");
  });

  it("wakes nobody for a command the agent stopped or read to its end", async () => {
    const stopped = await leftRunning();
    const [watch] = await stopped.store.watched(live);
    const job = idSchema("shj").parse(watch?.job);
    expect(await stopped.job({ job, action: "stop" })).toMatchObject({
      ok: true,
      value: { stoppedBy: "agent" },
    });
    await stopped.clock.advance(0);
    const read = await leftRunning();
    const polling = read.job({ job: await watchedJob(read), action: "poll", waitMs: 5_000 });
    read.runner.finish("serve", { output: "bye\n", exitCode: 1 });
    expect(await polling).toMatchObject({ ok: true, value: { status: "ended", exitCode: 1 } });
    await read.clock.advance(0);
    expect([stopped.woken(), read.woken(), await read.store.watched(live)]).toStrictEqual([
      [],
      [],
      [],
    ]);
  });

  it("stops the agent's commands on the owner's stop and a freeze, and wakes nobody", async () => {
    const shell = await leftRunning();
    const [watch] = await shell.store.watched(live);
    const job = idSchema("shj").parse(watch?.job);
    shell.part.stop(testAgent, "owner");
    await shell.clock.advance(0);
    expect(await shell.job({ job, action: "poll" })).toMatchObject({
      ok: true,
      value: { status: "ended", stopped: true, stoppedBy: "owner" },
    });
    const frozen = await leftRunning();
    frozen.change({ ask: "always" });
    await frozen.run({ command: "ls" });
    frozen.part.stop(undefined, "freeze");
    await frozen.clock.advance(0);
    expect([shell.woken(), frozen.woken()]).toStrictEqual([[], []]);
    expect(frozen.requestPushes().at(-1)).toMatchObject({
      kind: "chat/shellRequestClosed",
      data: { outcome: "stopped" },
    });
  });

  it("wakes no frozen agent", async () => {
    const shell = await leftRunning();
    shell.freeze();
    shell.runner.finish("serve", { output: "done\n", exitCode: 0 });
    await shell.clock.advance(0);
    expect(shell.woken()).toStrictEqual([]);
  });

  it("tells the agent of a command a restart lost, once", async () => {
    const store = createMemoryShellStore();
    await leftRunning({ store });
    const restarted = await createTestShell({ store });
    expect(await restarted.part.tellLost(live)).toBe(1);
    expect(await restarted.part.tellLost(live)).toBe(0);
    expect(restarted.woken()).toMatchObject([{ agent: testAgent, surface: "telegram" }]);
    expect(restarted.wokenTexts()[0]).toContain('binference restarted while your command "serve"');
  });
});
