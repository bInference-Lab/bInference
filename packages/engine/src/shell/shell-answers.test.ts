import { err, idSchema } from "@binference/core";
import type { ResultOf } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { testAgent } from "../intents/test-intents.js";
import { testCallers } from "../operations/test-engine.js";
import { createTestShell, type TestShell } from "./test-shell.js";

const live = { signal: new AbortController().signal };

// Runs a command that asks the owner first, and answers its request's id and job.
async function asked(shell: Readonly<TestShell>, command: string, folder = "/srv/project") {
  const answer = await shell.run({ command, folder, surface: "telegram" });
  if (!answer.ok || answer.value.request === undefined) {
    throw new Error("the command did not ask");
  }
  return answer.value.request;
}

function closedOutcomes(shell: Readonly<TestShell>): readonly unknown[] {
  return shell
    .requestPushes()
    .filter((push) => push.kind === "chat/shellRequestClosed")
    .map((push) => (push.data as { readonly outcome: string }).outcome);
}

describe("the owner's answer to a shell request", () => {
  it("runs the command once as the request's job, and wakes the agent with its output", async () => {
    const shell = await createTestShell({
      settings: { ask: "always" },
      script: { "git status": { kind: "ends", output: "clean\n", exitCode: 0 } },
    });
    const request = await asked(shell, "git status");
    expect(await shell.answer(request.request, "once")).toStrictEqual({
      ok: true,
      value: { outcome: "allowed_once" },
    });
    await shell.clock.advance(0);
    expect(shell.runner.started).toStrictEqual(["git status"]);
    expect(closedOutcomes(shell)).toStrictEqual(["allowed_once"]);
    expect(shell.woken()).toMatchObject([
      { agent: testAgent, surface: "telegram", outsideContent: true },
    ]);
    const [text] = shell.wokenTexts();
    expect(text).toContain(
      `"git status" in /srv/project waited for the owner. The owner allowed it once. It ended with exit code 0`,
    );
    expect(text).toContain("clean");
    expect(await shell.job({ job: request.job, action: "poll" })).toMatchObject({
      ok: true,
      value: { status: "ended", exitCode: 0 },
    });
  });

  it("takes the first answer only, from any surface", async () => {
    const shell = await createTestShell({ settings: { ask: "always" } });
    const request = await asked(shell, "ls");
    expect((await shell.answer(request.request, "refuse")).ok).toBe(true);
    expect(await shell.answer(request.request, "once")).toStrictEqual(err("shell.request_closed"));
    expect(shell.runner.started).toStrictEqual([]);
  });

  it("keeps each step allowed always, journaled and announced, so it runs without asking next", async () => {
    const shell = await createTestShell({ settings: { ask: "unlisted" } });
    const request = await asked(shell, "git log -1 | head -n 3");
    expect(await shell.answer(request.request, "always")).toMatchObject({
      ok: true,
      value: { outcome: "allowed_always" },
    });
    expect((await shell.store.allowed(live)).map((each) => each.text)).toStrictEqual([
      "git log -1",
      "head -n 3",
    ]);
    const [entry] = await shell.journal.list({ after: 0, limit: 10 }, live);
    expect(entry).toMatchObject({ path: "shell.allowed", surface: "cli" });
    expect(shell.pushes.filter((push) => push.topic === "notice")).toMatchObject([
      {
        data: {
          key: "notice.shellAllowed",
          values: {
            count: "2",
            by: "cli",
            folder: "/srv/project",
            commands: "git log -1; head -n 3",
          },
        },
      },
    ]);
    const again = await shell.run({ command: "git log -1 | head -n 3", folder: "/srv/project" });
    expect(again).toMatchObject({ ok: true, value: { status: "ended" } });
  });

  it("refuses Always allow where it is not offered, and keeps the request open", async () => {
    const shell = await createTestShell({ settings: { ask: "unlisted" } });
    const request = await asked(shell, "bash -c 'rm -rf build'");
    expect(request.canAlwaysAllow).toBe(false);
    expect(await shell.answer(request.request, "always")).toStrictEqual(
      err("shell.always_unavailable"),
    );
    expect((await shell.answer(request.request, "once")).ok).toBe(true);
  });

  it("refuses the command and wakes the agent with the refusal, no outside content", async () => {
    const shell = await createTestShell({ settings: { ask: "always" } });
    const request = await asked(shell, "rm -rf build");
    expect(await shell.answer(request.request, "refuse", testCallers.cli)).toStrictEqual({
      ok: true,
      value: { outcome: "refused" },
    });
    expect(shell.runner.started).toStrictEqual([]);
    const [woken] = shell.woken();
    expect(woken).toMatchObject({ kind: "inbox/message", surface: "telegram" });
    expect(woken).not.toHaveProperty("outsideContent");
    expect(shell.wokenTexts()[0]).toContain("The owner refused it");
  });

  it("refuses to run the command of a frozen agent", async () => {
    const shell = await createTestShell({ settings: { ask: "always" } });
    const request = await asked(shell, "ls");
    shell.freeze();
    expect(await shell.answer(request.request, "once")).toStrictEqual(err("agent.frozen"));
    expect(shell.runner.started).toStrictEqual([]);
  });
});

describe("a shell request nobody answers in 10 minutes", () => {
  it("closes with no turn and runs nothing under refuse", async () => {
    const shell = await createTestShell({ settings: { ask: "always" } });
    await asked(shell, "ls");
    await shell.clock.advance(600_000);
    expect([closedOutcomes(shell), shell.runner.started, shell.woken()]).toStrictEqual([
      ["expired"],
      [],
      [],
    ]);
  });

  it("runs only a command listed by then under listed", async () => {
    const shell = await createTestShell({ settings: { ask: "always", onNoAnswer: "listed" } });
    await asked(shell, "ls");
    await shell.clock.advance(600_000);
    expect(closedOutcomes(shell)).toStrictEqual(["expired"]);
    await asked(shell, "pwd");
    await shell.store.allow(
      [
        {
          id: idSchema("sac").parse("sac_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
          text: "pwd",
          program: "/usr/bin/pwd",
          args: [],
          folder: "/srv/project",
          allowedAtMs: 1,
        },
      ],
      live,
    );
    await shell.clock.advance(600_000);
    expect([closedOutcomes(shell), shell.runner.started]).toStrictEqual([
      ["expired", "ran_unanswered"],
      ["pwd"],
    ]);
  });

  it("runs it under any, and wakes the agent with its end", async () => {
    const shell = await createTestShell({ settings: { ask: "always", onNoAnswer: "any" } });
    await asked(shell, "ls");
    await shell.clock.advance(600_000);
    expect(closedOutcomes(shell)).toStrictEqual(["ran_unanswered"]);
    expect(shell.wokenTexts()[0]).toContain(
      "No answer came in 10 minutes, and the owner's shell.onNoAnswer setting let it run.",
    );
  });

  it("never runs more than the run setting allows", async () => {
    const shell = await createTestShell({
      settings: { run: "listed", ask: "always", onNoAnswer: "any" },
    });
    await asked(shell, "ls");
    await shell.clock.advance(600_000);
    expect([closedOutcomes(shell), shell.runner.started]).toStrictEqual([["expired"], []]);
  });
});

describe("listing shell requests", () => {
  it("lists the open requests of an agent", async () => {
    const shell = await createTestShell({ settings: { ask: "always" } });
    const request = await asked(shell, "ls");
    const listed = await shell.part.handlers["shell/requests"]({
      args: { agent: testAgent },
      caller: testCallers.cli,
      signal: live.signal,
    });
    expect(listed).toStrictEqual({
      ok: true,
      value: { items: [request] satisfies ResultOf<"shell/requests">["items"] },
    });
  });
});
