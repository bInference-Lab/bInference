import type { HttpRequest } from "@binference/core";
import { describe, expect, it } from "vitest";
import { createFakeCommandRunner } from "../fakes/fake-command-runner.js";
import { expectOk, testAgent } from "../intents/test-intents.js";
import { startTestEngine, testCall, testCallers } from "../operations/test-engine.js";
import { openShell } from "./test-shell.js";

// A test engine whose shell runs `serve` until a stop.
async function engineWithServe() {
  const runner = createFakeCommandRunner({ script: { serve: { kind: "runs", output: "" } } });
  const test = await startTestEngine({ shell: { runner, settings: () => openShell } });
  const run = test.engine.handlers["shell/run"];
  const args = { agent: testAgent, command: "serve", background: true } as const;
  const started = expectOk(await run(testCall(args, testCallers.runtime)));
  const poll = async () =>
    test.engine.handlers["shell/job"](
      testCall(
        { agent: testAgent, job: started.job, action: "poll" } as const,
        testCallers.runtime,
      ),
    );
  return { test, poll };
}

describe("the agent's shell in the engine", () => {
  it("stops the agent's running commands on the owner's stop", async () => {
    const { test, poll } = await engineWithServe();
    expectOk(await test.engine.handlers["chat/stop"](testCall({ agent: testAgent })));
    await test.clock.advance(0);
    expect(await poll()).toMatchObject({
      ok: true,
      value: { status: "ended", stoppedBy: "owner" },
    });
  });

  it("stops the agent's running commands on a freeze", async () => {
    const { test, poll } = await engineWithServe();
    expectOk(await test.engine.handlers["safety/freeze"](testCall({ agent: testAgent })));
    await test.clock.advance(0);
    expect(await poll()).toMatchObject({
      ok: true,
      value: { status: "ended", stoppedBy: "freeze" },
    });
  });

  it("sends the agent's API calls through the requests the shell gives", async () => {
    const sent: HttpRequest[] = [];
    const http = {
      request: async (request: HttpRequest) => {
        sent.push(request);
        return Promise.resolve({ status: 204, headers: {}, body: "" });
      },
    };
    const requests = { http, reveal: async () => Promise.resolve(undefined), ownHosts: () => [] };
    const runner = createFakeCommandRunner({ script: {} });
    const test = await startTestEngine({ shell: { runner, settings: () => openShell, requests } });
    const args = { agent: testAgent, method: "GET", url: "https://api.example.com/" } as const;
    const answer = await test.engine.handlers["http/request"](testCall(args, testCallers.runtime));
    expect(answer).toMatchObject({ ok: true, value: { kind: "answer", status: 204 } });
    expect(sent.map(({ url }) => url)).toStrictEqual(["https://api.example.com/"]);
  });
});
