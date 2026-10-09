import { BinferenceError, createSecret, type Http, idSchema } from "@binference/core";
import { messages } from "@binference/i18n";
import { afterEach, describe, expect, it } from "vitest";
import type { StartSigner } from "../compose/start-signer.js";
import { runOn, secretEnv } from "./init-fixtures.js";
import { connectClient } from "./test-host.js";
import { brokenSigner, createTestSigner } from "./test-signer.js";
import { createRunningEngines, stateOf } from "./unlock-fixtures.js";

const slow = { timeout: 60_000 };
const engines = createRunningEngines();
const call = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });
const testWallet = idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const testIntent = idSchema("int").parse("int_0190f1c2-3a4b-7c5d-8e6f-000000000001");

afterEach(async () => {
  await engines.stopAll();
});

// No outside service answers until the test brings the network up.
function networkThatComesUp(privy: Http, network: { readonly isUp: boolean }): Http {
  const down = new BinferenceError({
    code: "http.unreachable",
    message: "No network yet.",
    retryable: true,
  });
  return {
    request: async (request) => (network.isUp ? privy.request(request) : Promise.reject(down)),
  };
}

// A signer that fails to start until the test fixes it, then starts as the test signer does.
function fixableSigner() {
  const signer = createTestSigner();
  const state = { isFixed: false };
  const start: StartSigner = async (begin) =>
    state.isFixed ? signer.start(begin) : brokenSigner(begin);
  return { start, signer, fix: () => (state.isFixed = true) };
}

describe("the startup order", () => {
  it(
    "answers that it is starting until the signer has started, then turns ready",
    slow,
    async () => {
      const machine = await engines.setUp();
      const release = { open: (): void => undefined };
      const hold = new Promise<void>((resolve) => {
        release.open = resolve;
      });
      const signer = createTestSigner(hold);
      const starting = engines.start(machine, { parts: { startSigner: signer.start } });
      await signer.reached;
      const client = await connectClient(machine);
      try {
        await expect(client.call("engine/status", {}, call())).resolves.toMatchObject({
          state: "starting",
        });
        await expect(client.call("wallet/list", {}, call())).rejects.toMatchObject({
          code: "engine.starting",
        });
        release.open();
        await expect(starting).resolves.toMatchObject({ state: "ready" });
        const ready = await client.call("engine/status", {}, call());
        expect(ready.state).toBe("ready");
        expect(ready.health).toContainEqual({ signal: "custody", state: "ok" });
      } finally {
        client.close();
      }
    },
  );

  it(
    "runs locked when the signer fails at start, and unlock starts it once fixed",
    slow,
    async () => {
      const machine = await engines.setUp();
      const fixable = fixableSigner();
      await expect(
        engines.start(machine, { parts: { startSigner: fixable.start } }),
      ).resolves.toMatchObject({ state: "locked", lockReason: "signer_failed" });
      const refused = await runOn(machine, ["unlock"]);
      expect(refused.code).toBe(1);
      expect(refused.stderr).toContain("the signer did not start");
      fixable.fix();
      await expect(runOn(machine, ["unlock"])).resolves.toMatchObject({ code: 0 });
      expect(fixable.signer.starts()).toBe(1);
      await expect(stateOf(machine)).resolves.toBe("ready");
    },
  );

  it("runs locked when Privy refuses the app secret", slow, async () => {
    const machine = await engines.setUp();
    const env = secretEnv(machine, createSecret("not the app secret"));
    await expect(engines.start(machine, { env })).resolves.toMatchObject({
      state: "locked",
      lockReason: "app_secret_rejected",
    });
  });

  it("locks again when the signer stops, and tells the owner", slow, async () => {
    const machine = await engines.setUp();
    const signer = createTestSigner();
    await engines.start(machine, { parts: { startSigner: signer.start } });
    signer.crash();
    await expect(stateOf(machine)).resolves.toBe("locked");
    const status = await runOn(machine, ["status"]);
    expect(status.stdout).toContain(String(messages.en["cli.status.locked"]));
    await expect(runOn(machine, ["unlock"])).resolves.toMatchObject({ code: 0 });
    expect(signer.starts()).toBe(2);
    await expect(stateOf(machine)).resolves.toBe("ready");
  });

  it("tells every client when the signer refuses a step, naming the rule", slow, async () => {
    const machine = await engines.setUp();
    const signer = createTestSigner();
    await engines.start(machine, { parts: { startSigner: signer.start } });
    const client = await connectClient(machine);
    try {
      const subscribed = { done: (): void => undefined };
      const loaded = new Promise<void>((resolve) => {
        subscribed.done = resolve;
      });
      const heard = new Promise<unknown>((resolve) => {
        client.subscribe("notice", {
          onPush: (push) => resolve(push.data),
          refetch: async () => {
            subscribed.done();
            return Promise.resolve();
          },
        });
      });
      await loaded;
      await client.call("engine/status", {}, call());
      signer.refuse({ wallet: testWallet, intent: testIntent, refused: "rule_2" });
      await expect(heard).resolves.toStrictEqual({
        key: "notice.signerRefused",
        values: { rule: "rule_2" },
        intent: testIntent,
      });
    } finally {
      client.close();
    }
  });

  it(
    "runs locked while Privy is out of reach, and unlocks by hand once it answers",
    slow,
    async () => {
      const machine = await engines.setUp();
      const network = { isUp: false };
      const http = networkThatComesUp(machine.privy.http, network);
      await expect(engines.start(machine, { parts: { http } })).resolves.toMatchObject({
        state: "locked",
        lockReason: "custody_unreachable",
      });
      network.isUp = true;
      await expect(runOn(machine, ["unlock"])).resolves.toMatchObject({ code: 0 });
      await expect(stateOf(machine)).resolves.toBe("ready");
    },
  );
});
