import { EventEmitter } from "node:events";
// oxlint-disable-next-line eslint/no-restricted-imports -- the old machine's folder is a copy of the install made while no engine runs
import { cp } from "node:fs/promises";
import { join } from "node:path";
import { type Http, jsonValueSchema, type Secret } from "@binference/core";
import { createFormatter } from "@binference/i18n";
import { createFileSecretStore, writePrivateFile } from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { parseAgentKey } from "@binference/signer";
import { fakeBotToken } from "@binference/telegram/testing";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { runCli } from "../program/run-cli.js";
import { createScriptedPrompter } from "../term/scripted-prompter.js";
import { setUpWithOwnerKey, signsWith } from "./attach-fixtures.js";
import {
  configText,
  type InitMachine,
  machineOf,
  newInitMachine,
  newOwnerKey,
  runOn,
  secretEnv,
  storedInstall,
} from "./init-fixtures.js";
import { engineLogLines, freePort, hostWith, noPermissions } from "./test-host.js";
import { createTestSigner } from "./test-signer.js";
import { createRunningEngines, heldKey, removeAgentKey } from "./unlock-fixtures.js";

const slow = { timeout: 60_000 };
const engines = createRunningEngines();
const folders: TempFolder[] = [];
const live = { signal: new AbortController().signal };
const english = createFormatter({ locale: "en", timeZone: "UTC" });
const init = (key: string, values: Readonly<Record<string, string>> = {}): string =>
  english.message(`init.${key}`, values);
const wrongKey = `bnok1${"a".repeat(25)}`;

afterEach(async () => {
  await engines.stopAll();
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

// The same install on a second folder, as the machine it was copied from left it.
async function copyOf(
  machine: InitMachine,
  options: { readonly withKeys: boolean } = { withKeys: true },
): Promise<InitMachine> {
  const folder = await createTempFolder("bnf-copy-");
  folders.push(folder);
  const keys = join(machine.folder, "keys");
  // A running engine's IPC socket is no file to copy.
  const socket = join(machine.folder, "run");
  const filter = (source: string): boolean =>
    !source.startsWith(socket) && (options.withKeys || !source.startsWith(keys));
  await cp(machine.folder, folder.path, { recursive: true, force: true, filter });
  return machineOf({ ...machine, folder: folder.path, signals: new EventEmitter() });
}

// Writes config.json5 over with `edit` applied to its text.
async function editConfig(machine: InitMachine, edit: (text: string) => string): Promise<void> {
  const text = (await configText(machine)) ?? "";
  const files = { permissions: noPermissions, signal: live.signal };
  await writePrivateFile(join(machine.folder, "config.json5"), edit(text), files);
}

// The app secret `keys/privy-app-secret` holds, if any.
async function keptAppSecret(machine: InitMachine): Promise<string | undefined> {
  const keys = join(machine.folder, "keys");
  const store = createFileSecretStore({ folder: keys, permissions: noPermissions });
  const read = await store.read("privy-app-secret", live.signal);
  return read.ok ? read.value.reveal() : undefined;
}

async function attach(
  machine: InitMachine,
  ownerKeys: readonly string[],
  options: {
    readonly argv?: readonly string[];
    readonly appSecrets?: readonly string[];
    readonly botTokens?: readonly string[];
    readonly env?: Readonly<Record<string, string>>;
    readonly http?: Http;
  } = {},
) {
  const prompter = createScriptedPrompter({
    ownerKey: ownerKeys,
    privyAppSecret: options.appSecrets ?? [],
    botToken: options.botTokens ?? [],
  });
  const host = hostWith(machine, ["init", "--attach", ...(options.argv ?? [])], {
    env: options.env ?? secretEnv(machine),
    parts: { http: options.http ?? machine.world, prompter },
  });
  const code = await runCli(host);
  return { code, stderr: host.stderr(), prompter };
}

// The machine's world, except that each key quorum made through it reads back with a second key.
function quorumsWithAnotherKey(machine: InitMachine): Http {
  const made = new Set<string>();
  const extra = { public_key: newOwnerKey().publicKey };
  return {
    request: async (request) => {
      const answer = await machine.world.request(request);
      const path = new URL(request.url).pathname;
      if (request.method === "POST" && path === "/v1/key_quorums") {
        made.add(z.object({ id: z.string() }).parse(JSON.parse(answer.body)).id);
        return answer;
      }
      const id = path.split("/").at(-1) ?? "";
      if (request.method !== "GET" || !made.has(id)) {
        return answer;
      }
      const quorum = z.looseObject({ authorization_keys: z.array(z.unknown()) });
      const read = quorum.parse(JSON.parse(answer.body));
      const keys = [...read.authorization_keys, extra];
      return { ...answer, body: JSON.stringify({ ...read, authorization_keys: keys }) };
    },
  };
}

function publicOf(key: Secret): string {
  const pair = parseAgentKey(key);
  if (!pair.ok) {
    throw new Error("Expected an agent key.");
  }
  return pair.value.publicKey;
}

// Starts the engine in the foreground, as the background service would, until `stop` is called.
async function started(machine: InitMachine) {
  const port = String(await freePort());
  const argv = ["start", "--foreground", "--json", "--set", `engine.port=${port}`];
  const host = hostWith(machine, argv, {
    env: secretEnv(machine),
    parts: { http: machine.world, startSigner: createTestSigner().start },
  });
  const exit = runCli(host);
  const line = await host.waitForLine((text) => text.includes('"state":'));
  const stop = async (): Promise<number> => {
    machine.signals.emit("SIGINT", "SIGINT");
    return exit;
  };
  return { first: jsonValueSchema.parse(JSON.parse(line)), stop };
}

describe("binference init --attach", () => {
  it(
    "moves every wallet to this machine's new key: it signs, Privy refuses the old one, and the old machine stays locked without the bot",
    slow,
    async () => {
      const { machine, ownerKey } = await setUpWithOwnerKey(folders);
      const before = await storedInstall(machine);
      const oldKey = await heldKey(machine);
      const old = await copyOf(machine);
      await removeAgentKey(machine);

      const attached = await attach(machine, [ownerKey]);

      expect([attached.code, attached.stderr]).toStrictEqual([0, ""]);
      expect(attached.prompter.transcript.asked).toStrictEqual(["ownerKey"]);
      const notes = attached.prompter.transcript.notes.map((note) => note.text).join("\n");
      expect(notes).toContain("on the old machine, run `binference service remove`");
      const newKey = await heldKey(machine);
      const after = await storedInstall(machine);
      const { custody } = after.facts;
      expect(custody?.agentKeyPublic).toBe(publicOf(newKey));
      expect(custody?.agentQuorumId).not.toBe(before.facts.custody?.agentQuorumId);
      const signers = after.facts.wallets.map((item) => [item.custodyWalletId, item.signerId]);
      expect(signers).toStrictEqual(
        before.facts.wallets.map((item) => [item.custodyWalletId, custody?.agentQuorumId]),
      );
      expect(await signsWith(machine, newKey)).toBe("signed");
      expect(await signsWith(machine, oldKey)).toBe("refused");
      const oldEngine = await started(old);
      expect(oldEngine.first).toMatchObject({ state: "locked", lockReason: "signer_revoked" });
      expect(await oldEngine.stop()).toBe(0);
      expect(old.bot.calls()).toStrictEqual([]);
      expect((await engineLogLines(old)).join("\n")).toContain("unlock.signer_revoked");
      expect(await engines.start(machine)).toMatchObject({ state: "ready" });
    },
  );

  it(
    "goes on with the key an earlier attach left, and refuses a machine attached already",
    slow,
    async () => {
      const { machine, ownerKey } = await setUpWithOwnerKey(folders);
      await removeAgentKey(machine);
      const again = await attach(machine, [ownerKey]);
      expect(again.code).toBe(0);

      const twice = await attach(machine, [ownerKey]);

      const keys = join(machine.folder, "keys");
      expect([twice.code, twice.stderr]).toStrictEqual([
        1,
        `${init("refused.attachCopiedKeys", { folder: keys })}\n`,
      ]);
    },
  );

  it(
    "changes nothing for a wrong owner key, typed three times, and never makes a key",
    slow,
    async () => {
      const { machine } = await setUpWithOwnerKey(folders);
      await removeAgentKey(machine);
      const sent = machine.privy.sent.length;

      const wrong = await attach(machine, [wrongKey, wrongKey, wrongKey]);

      expect([wrong.code, wrong.stderr]).toStrictEqual([1, `${init("refused.attachOwnerKey")}\n`]);
      expect(machine.privy.sent.slice(sent).map((request) => request.method)).not.toContain(
        "PATCH",
      );
      await expect(heldKey(machine)).rejects.toThrow(/agent key/);
    },
  );

  it("moves no wallet when Privy holds the new key quorum with another key", slow, async () => {
    const { machine, ownerKey } = await setUpWithOwnerKey(folders);
    await removeAgentKey(machine);
    const sent = machine.privy.sent.length;

    const refused = await attach(machine, [ownerKey], { http: quorumsWithAnotherKey(machine) });

    expect([refused.code, refused.stderr]).toStrictEqual([1, `${init("refused.attachQuorum")}\n`]);
    expect(machine.privy.sent.slice(sent).map((request) => request.method)).not.toContain("PATCH");
  });

  it("never takes the owner key without a person, nor with a start over", slow, async () => {
    const { machine } = await setUpWithOwnerKey(folders);

    const scripted = await runOn(machine, ["init", "--attach", "--yes"]);
    const both = await attach(machine, [], { argv: ["--start-over"] });

    expect([scripted.code, scripted.stderr]).toStrictEqual([
      1,
      `${init("refused.attachOwnerKeyTerminal")}\n`,
    ]);
    expect([both.code, both.stderr]).toStrictEqual([1, `${init("refused.attachStartOver")}\n`]);
  });

  it(
    "asks for an app secret this machine lacks and keeps it where the config names it",
    slow,
    async () => {
      const { machine, ownerKey } = await setUpWithOwnerKey(folders);
      await removeAgentKey(machine);
      const file = join(machine.folder, "keys", "privy-app-secret");
      await editConfig(machine, (text) =>
        text.replace(/appSecret: \{[^}]*\}/u, `appSecret: { fromFile: ${JSON.stringify(file)} }`),
      );
      const secret = machine.privy.appSecret.reveal();

      const attached = await attach(machine, [ownerKey], { appSecrets: [secret] });

      expect([attached.code, attached.stderr]).toStrictEqual([0, ""]);
      expect(attached.prompter.transcript.asked).toStrictEqual(["privyAppSecret", "ownerKey"]);
      expect(await keptAppSecret(machine)).toBe(secret);
    },
  );

  it(
    "refuses another Privy app, and an app secret it cannot keep where config names it",
    slow,
    async () => {
      const { machine, ownerKey } = await setUpWithOwnerKey(folders);
      const appId = machine.privy.appId;

      const unread = await attach(machine, [ownerKey], { env: {} });
      await editConfig(machine, (text) => text.replace(appId, "otherapp0000000000000000"));
      const other = await attach(machine, [ownerKey]);

      expect([unread.code, unread.stderr]).toStrictEqual([
        1,
        `${init("refused.attachAppSecret")}\n`,
      ]);
      expect([other.code, other.stderr]).toStrictEqual([
        1,
        `${init("refused.attachOtherApp", { appId })}\n`,
      ]);
    },
  );

  it("refuses a folder with a config file but no install", slow, async () => {
    const empty = await newInitMachine(folders);
    const files = { permissions: noPermissions, signal: live.signal };
    await writePrivateFile(join(empty.folder, "config.json5"), "{ version: 1 }\n", files);

    const refused = await attach(empty, ["unused"]);

    expect([refused.code, refused.stderr]).toStrictEqual([
      1,
      `${init("refused.attachConfigOnly", { folder: empty.folder })}\n`,
    ]);
  });

  it("attaches a copy of the stopped folder made without keys, on another path", slow, async () => {
    const { machine: old, ownerKey } = await setUpWithOwnerKey(folders);
    const moved = await copyOf(old, { withKeys: false });

    const attached = await attach(moved, [ownerKey]);

    expect([attached.code, attached.stderr]).toStrictEqual([0, ""]);
    expect(await signsWith(moved, await heldKey(moved))).toBe("signed");
    expect(await signsWith(old, await heldKey(old))).toBe("refused");
  });

  it("refuses a copy that brought the old keys along, and changes nothing", slow, async () => {
    const { machine: old, ownerKey } = await setUpWithOwnerKey(folders);
    const moved = await copyOf(old);
    const sent = old.privy.sent.length;

    const refused = await attach(moved, [ownerKey]);

    const keys = join(moved.folder, "keys");
    expect([refused.code, refused.stderr]).toStrictEqual([
      1,
      `${init("refused.attachCopiedKeys", { folder: keys })}\n`,
    ]);
    expect(old.privy.sent.slice(sent).map((request) => request.method)).not.toContain("PATCH");
  });

  it("refuses a copy made while the engine ran, before it opens the database", slow, async () => {
    const { machine: old, ownerKey } = await setUpWithOwnerKey(folders);
    expect(await engines.start(old)).toMatchObject({ state: "ready" });
    const moved = await copyOf(old, { withKeys: false });

    const refused = await attach(moved, [ownerKey]);

    const file = join(moved.folder, "engine.sqlite");
    expect([refused.code, refused.stderr]).toStrictEqual([
      1,
      `${init("refused.attachLeftOpen", { file })}\n`,
    ]);
    expect(refused.prompter.transcript.asked).toStrictEqual([]);
  });

  it(
    "moves secret sources from the old keys folder to this one and asks for those secrets",
    slow,
    async () => {
      const { machine: old, ownerKey } = await setUpWithOwnerKey(folders);
      const oldKeys = join(old.folder, "keys");
      await editConfig(old, (text) =>
        text
          .replace(
            /appSecret: \{[^}]*\}/u,
            `appSecret: { fromFile: ${JSON.stringify(join(oldKeys, "privy-app-secret"))} }`,
          )
          .replace(
            /botToken: \{[^}]*\}/u,
            `botToken: { fromFile: ${JSON.stringify(join(oldKeys, "telegram-bot"))} }`,
          ),
      );
      const moved = await copyOf(old, { withKeys: false });
      const secret = old.privy.appSecret.reveal();

      const attached = await attach(moved, [ownerKey], {
        appSecrets: [secret],
        botTokens: [fakeBotToken],
        env: {},
      });

      expect([attached.code, attached.stderr]).toStrictEqual([0, ""]);
      expect(attached.prompter.transcript.asked).toStrictEqual([
        "privyAppSecret",
        "botToken",
        "ownerKey",
      ]);
      expect(await keptAppSecret(moved)).toBe(secret);
      const config = String(await configText(moved));
      expect(config).toContain(JSON.stringify(join(moved.folder, "keys", "telegram-bot")));
      expect(config).not.toContain(JSON.stringify(oldKeys).slice(0, -1));
      expect(attached.prompter.transcript.lines.join("\n")).toContain("binference now reads them");
    },
  );

  it("attaches without the bot when nobody can fill its token, and says so", slow, async () => {
    const { machine, ownerKey } = await setUpWithOwnerKey(folders);
    await removeAgentKey(machine);
    const env = { TEST_PRIVY_APP_SECRET: machine.privy.appSecret.reveal() };

    const attached = await attach(machine, [ownerKey], { env });

    expect(attached.code).toBe(0);
    const notes = attached.prompter.transcript.notes.map((note) => note.text).join("\n");
    expect(notes).toContain(init("attach.done.noBot"));
  });
});
