import { err, idSchema, type Result } from "@binference/core";
import type { ProtocolErrorCode, ResultOf } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { testAgent } from "../intents/test-intents.js";
import { testCall, testCallers } from "../operations/test-engine.js";
import { createTestShell } from "./test-shell.js";

const live = { signal: new AbortController().signal };

// The id of the request a view that asks carries.
function requestOf(view: ResultOf<"shell/run">): string {
  if (view.request === undefined) {
    throw new Error("the command does not ask");
  }
  return view.request.request;
}

// The view of an answer that must have one.
function viewOf(answer: Result<ResultOf<"shell/run">, ProtocolErrorCode>): ResultOf<"shell/run"> {
  if (!answer.ok) {
    throw new Error(`the shell refused: ${answer.error}`);
  }
  return answer.value;
}

describe("shell/run", () => {
  it("answers a command that ended within its wait with its output and exit code", async () => {
    const shell = await createTestShell({
      script: { "ls -l": { kind: "ends", output: "total 0\n", exitCode: 0 } },
    });
    expect(await shell.run({ command: "ls -l" })).toMatchObject({
      ok: true,
      value: {
        status: "ended",
        command: "ls -l",
        folder: "/home/owner",
        exitCode: 0,
        output: "total 0\n",
        outputCut: false,
      },
    });
  });

  it("answers a command still running once its wait is over, and stops it on shell/job", async () => {
    const shell = await createTestShell({ script: { serve: { kind: "runs", output: "up\n" } } });
    const started = shell.run({ command: "serve", waitMs: 2_000 });
    await shell.clock.advance(2_000);
    const answer = await started;
    expect(answer).toMatchObject({ ok: true, value: { status: "running", output: "up\n" } });
    const stopped = await shell.job({ job: viewOf(answer).job, action: "stop" });
    expect(stopped).toMatchObject({
      ok: true,
      value: { status: "ended", stopped: true, stoppedBy: "agent", signal: "SIGTERM" },
    });
  });

  it("refuses while the shell is off, and in a folder that does not exist", async () => {
    const off = await createTestShell({ settings: { run: "off" } });
    expect(await off.run({ command: "ls" })).toStrictEqual(err("shell.off"));
    const shell = await createTestShell();
    expect(await shell.run({ command: "ls", folder: "/nowhere" })).toStrictEqual(
      err("shell.folder_missing"),
    );
    expect(shell.runner.started).toStrictEqual([]);
  });

  it("masks a recovery phrase and keeps only the newest output, saying it cut", async () => {
    const phrase = Array.from({ length: 12 }, () => "apple").join(" ");
    const shell = await createTestShell({
      script: {
        phrase: { kind: "ends", output: `words: ${phrase}\n`, exitCode: 0 },
        long: { kind: "ends", output: "x".repeat(200_010), exitCode: 0 },
      },
    });
    expect(await shell.run({ command: "phrase" })).toMatchObject({
      value: { output: "words: [recovery phrase hidden]\n" },
    });
    const cut = viewOf(await shell.run({ command: "long" }));
    expect([cut.output.length, cut.outputCut]).toStrictEqual([200_000, true]);
  });
});

describe("shell/run under the owner's ask and run settings", () => {
  it("asks for a command not allowed, pushes the request, and starts nothing", async () => {
    const shell = await createTestShell({ settings: { ask: "unlisted" } });
    const asked = viewOf(await shell.run({ command: "git status", folder: "/srv/project" }));
    expect(asked).toMatchObject({
      status: "asking",
      command: "git status",
      folder: "/srv/project",
      request: {
        agent: testAgent,
        job: asked.job,
        reason: "unlisted",
        canAlwaysAllow: true,
        closesAt: asked.startedAt + 600_000,
      },
    });
    expect(shell.runner.started).toStrictEqual([]);
    expect(shell.requestPushes()).toMatchObject([
      { topic: `chat:${testAgent}`, kind: "chat/shellRequest", data: asked.request },
    ]);
  });

  it("says why it asks: always, a line it cannot judge, or PowerShell", async () => {
    const always = await createTestShell({ settings: { ask: "always" } });
    expect(viewOf(await always.run({ command: "ls" })).request?.reason).toBe("always");
    const unlisted = await createTestShell({ settings: { ask: "unlisted" } });
    const redirect = viewOf(await unlisted.run({ command: "ls > out.txt" })).request;
    expect(redirect).toMatchObject({ reason: "unreadable", canAlwaysAllow: false });
    const windows = await createTestShell({ settings: { ask: "unlisted" }, dialect: "powershell" });
    expect(viewOf(await windows.run({ command: "ls" })).request?.reason).toBe("powershell");
  });

  it("refuses an unlisted command under listed with never asking, and runs a listed one", async () => {
    const shell = await createTestShell({ settings: { run: "listed" } });
    expect(await shell.run({ command: "ls" })).toStrictEqual(err("shell.not_listed"));
    await shell.store.allow(
      [
        {
          id: idSchema("sac").parse("sac_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
          text: "ls",
          program: "/usr/bin/ls",
          args: [],
          folder: "/home/owner",
          allowedAtMs: 1,
        },
      ],
      live,
    );
    expect(await shell.run({ command: "ls" })).toMatchObject({
      ok: true,
      value: { status: "ended" },
    });
  });

  it("polls a command that waits with its request, and withdraws it on stop", async () => {
    const shell = await createTestShell({ settings: { ask: "always" } });
    const asked = viewOf(await shell.run({ command: "ls" }));
    expect(await shell.job({ job: asked.job, action: "poll" })).toMatchObject({
      ok: true,
      value: { status: "asking", request: asked.request },
    });
    expect(await shell.job({ job: asked.job, action: "stop" })).toMatchObject({
      ok: true,
      value: { status: "ended", stopped: true, stoppedBy: "agent" },
    });
    expect(shell.requestPushes().at(-1)).toMatchObject({
      kind: "chat/shellRequestClosed",
      data: { outcome: "withdrawn" },
    });
    expect(await shell.answer(requestOf(asked), "once")).toStrictEqual(err("shell.request_closed"));
  });

  it("replaces an agent's older request with its newer one", async () => {
    const shell = await createTestShell({ settings: { ask: "always" } });
    const first = viewOf(await shell.run({ command: "ls" }));
    await shell.run({ command: "pwd" });
    expect(shell.requestPushes()).toMatchObject([
      { kind: "chat/shellRequest" },
      {
        kind: "chat/shellRequestClosed",
        data: { request: first.request?.request, outcome: "replaced" },
      },
      { kind: "chat/shellRequest" },
    ]);
  });
});

describe("shell/job", () => {
  it("never shows one agent's command to another", async () => {
    const shell = await createTestShell({ script: { serve: { kind: "runs", output: "" } } });
    const answer = await shell.run({ command: "serve", background: true });
    const other = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000002");
    const call = { agent: other, job: viewOf(answer).job, action: "poll" } as const;
    expect(
      await shell.part.handlers["shell/job"](testCall(call, testCallers.runtime)),
    ).toStrictEqual(err("shell.job_not_found"));
  });
});
