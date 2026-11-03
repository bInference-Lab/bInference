import { join } from "node:path";
import { createFormatter } from "@binference/i18n";
import { runCommandWithin } from "@binference/platform";
import { remoteViewSchema } from "@binference/protocol";
import { afterEach, describe, expect, it } from "vitest";
import type { ChoiceQuestion } from "../term/prompter.js";
import { createScriptedPrompter } from "../term/scripted-prompter.js";
import { fakeStatus, fakeTailnetName, writeFakeTailscale } from "./fake-tailscale.js";
import { configText, type InitMachine, runOn, secretEnv } from "./init-fixtures.js";
import { freePort } from "./test-host.js";
import { createRunningEngines } from "./unlock-fixtures.js";

const slow = { timeout: 90_000 };
const engines = createRunningEngines();
const english = createFormatter({ locale: "en", timeZone: "UTC" });
const words = (key: string, values = {}) => english.message(key, values);
const mini = `https://${fakeTailnetName}`;
const hooks = `https://${fakeTailnetName}:8443/hook/`;

afterEach(async () => {
  await engines.stopAll();
});

// An engine on the machine whose host runs the stand-in Tailscale on its PATH, at known ports.
async function exposedMachine() {
  const machine = await engines.setUp();
  const fake = await writeFakeTailscale(join(machine.folder, "tailscale-bin"), {
    status: fakeStatus({ caps: [] }),
    serve: {},
  });
  const ports = { engine: await freePort(), webhooks: await freePort() };
  const env = { ...secretEnv(machine), ...fake.env };
  const parts = { runProgram: runCommandWithin, webhookPort: ports.webhooks };
  expect(await engines.start(machine, { port: ports.engine, env, parts })).toMatchObject({
    state: "ready",
  });
  const run = async (argv: readonly string[], more: Parameters<typeof runOn>[2] = {}) =>
    runOn(machine, ["expose", ...argv], { env, ...more, parts: { ...parts, ...more.parts } });
  return { machine, fake, ports, env, run };
}

// The config's `remote` block as `binference expose` wrote it.
async function remoteOf(machine: InitMachine): Promise<string> {
  const text = (await configText(machine)) ?? "";
  return /remote: \{[^}]*\}/.exec(text)?.[0] ?? "";
}

describe("binference expose", () => {
  it("refuses to publish the webhook path with no terminal and no --yes", slow, async () => {
    const machine = await engines.setUp();
    const refused = await runOn(machine, ["expose", "--webhooks"]);
    expect([refused.code, refused.stderr]).toStrictEqual([1, `${words("cli.expose.needsYes")}\n`]);
  });

  it(
    "publishes the Mini App, asks before the webhook path, and takes only its own handlers off",
    slow,
    async () => {
      const { machine, fake, ports, run } = await exposedMachine();

      const off = await run([]);
      expect([off.code, off.stderr]).toStrictEqual([1, `${words("error.remote.https_off")}\n`]);
      expect(await remoteOf(machine)).toBe("");

      await fake.set({ status: fakeStatus(), serve: {} });
      const people = await run([]);
      expect([people.code, people.stdout]).toStrictEqual([
        0,
        `${words("cli.expose.mini", { url: mini })}\n${words("cli.expose.restart", { url: mini })}\n`,
      ]);

      const questions: ChoiceQuestion[] = [];
      const scripted = createScriptedPrompter({ publishWebhooks: ["no", "yes"] });
      const prompter = {
        ...scripted,
        choose: async (question: ChoiceQuestion) => {
          questions.push(question);
          return scripted.choose(question);
        },
      };
      const kept = await run(["--webhooks"], { parts: { prompter } });
      expect([kept.code, kept.stdout]).toStrictEqual([1, `${words("cli.expose.kept")}\n`]);
      const asJson = await run(["--webhooks", "--json"], { parts: { prompter } });
      expect(asJson.code).toBe(1);
      const answered = await run(["--webhooks"], { parts: { prompter } });
      expect(answered.code).toBe(0);
      expect(answered.stdout).toContain(words("cli.expose.webhooks", { url: hooks }));
      expect(questions.map((question) => question.message)).toStrictEqual([
        words("cli.expose.askPublic", { url: hooks }),
        words("cli.expose.askPublic", { url: hooks }),
      ]);

      const again = await run(["--webhooks", "--yes", "--json"]);
      expect(remoteViewSchema.parse(JSON.parse(again.stdout))).toMatchObject({
        tailscale: "running",
        miniUrl: mini,
        webhookUrl: `https://${fakeTailnetName}:8443`,
        published: { mini: true, webhooks: true },
        problems: [],
      });
      expect(await fake.serve()).toStrictEqual({
        TCP: { "443": { HTTPS: true }, "8443": { HTTPS: true } },
        Web: {
          [`${fakeTailnetName}:443`]: {
            Handlers: { "/": { Proxy: `http://127.0.0.1:${String(ports.engine)}` } },
          },
          [`${fakeTailnetName}:8443`]: {
            Handlers: { "/hook/": { Proxy: `http://127.0.0.1:${String(ports.webhooks)}/hook/` } },
          },
        },
        AllowFunnel: { [`${fakeTailnetName}:8443`]: true },
      });
      const recorded = await remoteOf(machine);
      for (const member of ["mini: true", "webhooks: true", `publicUrl: "${mini}"`]) {
        expect(recorded).toContain(member);
      }

      const removed = await run(["--off"]);
      expect([removed.code, removed.stdout]).toStrictEqual([0, `${words("cli.expose.off")}\n`]);
      expect(await fake.serve()).toStrictEqual({ TCP: {}, Web: {}, AllowFunnel: {} });
      const cleared = await remoteOf(machine);
      expect(cleared).toContain("mini: false");
      expect(cleared).toContain("webhooks: false");
      expect(cleared).not.toContain("publicUrl");
    },
  );

  it(
    "stops a publish under way at --off, names what it leaves, and words its failures",
    slow,
    async () => {
      const { machine, fake, ports, env, run } = await exposedMachine();
      const engineUrl = `http://127.0.0.1:${String(ports.engine)}`;
      await fake.set({ status: fakeStatus(), serve: {}, hang: { command: "funnel", ms: 60_000 } });
      const abandoned = run(["--webhooks", "--yes"]);
      await fake.untilServe((serve) => JSON.stringify(serve).includes(`${fakeTailnetName}:8443`));
      const off = await run(["--off"]);
      expect([off.code, off.stdout]).toStrictEqual([0, `${words("cli.expose.off")}\n`]);
      expect((await abandoned).stderr).toBe(`${words("error.remote.not_applied")}\n`);
      expect(await fake.serve()).toStrictEqual({ TCP: {}, Web: {}, AllowFunnel: {} });
      expect(await remoteOf(machine)).toContain("webhooks: false");

      const byHand = `${fakeTailnetName}:443`;
      const serve = {
        TCP: { "443": { HTTPS: true } },
        Web: { [byHand]: { Handlers: { "/": { Proxy: engineUrl } } } },
        AllowFunnel: { [byHand]: true },
      };
      await fake.set({ status: fakeStatus(), serve });
      const left = await run(["--off"]);
      const values = {
        isPublic: "yes",
        port: 443,
        mount: "/",
        target: engineUrl,
        command: "funnel",
      };
      expect([left.code, left.stdout]).toStrictEqual([
        1,
        `${words("cli.expose.offLeft")}\n  ${words("cli.expose.offLeftHandler", values)}\n`,
      ]);
      expect(await fake.serve()).toStrictEqual(serve);

      await fake.set({ status: fakeStatus(), serve: {}, daemon: "down" });
      const down = await run(["--off"]);
      expect([down.code, down.stderr]).toStrictEqual([1, `${words("cli.expose.offLoggedOut")}\n`]);
      const chinese = createFormatter({ locale: "zh", timeZone: "UTC" });
      const inChinese = await run(["--off"], { env: { ...env, BINFERENCE_OWNER__LOCALE: "zh" } });
      expect(inChinese.stderr).toBe(`${chinese.message("cli.expose.offLoggedOut")}\n`);
    },
  );
});
