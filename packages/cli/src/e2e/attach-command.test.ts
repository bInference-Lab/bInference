import { EventEmitter } from "node:events";
// oxlint-disable-next-line eslint/no-restricted-imports -- the old machine's folder is a copy of the install made while no engine runs
import { cp } from "node:fs/promises";
import { join } from "node:path";
import { jsonValueSchema, type Secret } from "@binference/core";
import { createFormatter } from "@binference/i18n";
import { createFileSecretStore, writePrivateFile } from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { parseAgentKey } from "@binference/signer";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../program/run-cli.js";
import { createScriptedPrompter } from "../term/scripted-prompter.js";
import { setUpWithOwnerKey, signsWith } from "./attach-fixtures.js";
import {
  configText,
  type InitMachine,
  machineOf,
  newInitMachine,
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
async function copyOf(machine: InitMachine): Promise<InitMachine> {
  const folder = await createTempFolder("bnf-old-");
  folders.push(folder);
  await cp(machine.folder, folder.path, { recursive: true, force: true });
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
    readonly env?: Readonly<Record<string, string>>;
  } = {},
) {
  const prompter = createScriptedPrompter({
    ownerKey: ownerKeys,
    privyAppSecret: options.appSecrets ?? [],
  });
  const host = hostWith(machine, ["init", "--attach", ...(options.argv ?? [])], {
    env: options.env ?? secretEnv(machine),
    parts: { http: machine.world, prompter },
  });
  const code = await runCli(host);
  return { code, stderr: host.stderr(), prompter };
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

      expect([twice.code, twice.stderr]).toStrictEqual([1, `${init("refused.attachedAlready")}\n`]);
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

  it("refuses a folder that holds no install", slow, async () => {
    const empty = await newInitMachine(folders);

    const refused = await attach(empty, ["unused"]);

    expect([refused.code, refused.stderr]).toStrictEqual([
      1,
      `${init("refused.attachNeedsInstall", { folder: empty.folder })}\n`,
    ]);
  });
});
