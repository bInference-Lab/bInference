import { join } from "node:path";
import { listFolderFiles, readTextFile, writePrivateFile } from "@binference/platform";
import { fakeBotToken } from "@binference/telegram/testing";
import { afterEach, describe, expect, it } from "vitest";
import { newOwnerKey, runOn, secretEnv, storedInstall } from "./init-fixtures.js";
import { testModelKey } from "./model-fixtures.js";
import { noPermissions, testSystem, type TestMachine } from "./test-host.js";
import { createRunningEngines } from "./unlock-fixtures.js";

const slow = { timeout: 60_000 };
const engines = createRunningEngines();

afterEach(async () => {
  await engines.stopAll();
});

// A value of every kind the install holds that no bundle may carry.
const seeded = {
  rpcKey: "4f9Qx2LmZ8vR1tY6uI0oP3aSdFgHjK",
  privateHost: "node7.ana-private.example",
  publicHost: "ana-laptop.tail1234.ts.net",
  proxyPassword: "Pr0xyPassw0rdForTests",
  keyFilePath: "/srv/ana/keys/brave-search-key",
  commandItem: "op://vault/zerox-routing",
  savedAddress: "0x9f8E7d6C5b4A39281706f5e4D3c2B1a098765432",
  savedLabel: "Grandma cold storage",
  chatText: "please buy 100 PEPE before dinner",
  ownerKeyCode: newOwnerKey().code,
};

const extraConfig = [
  `  chains: { rpc: { "eip155:56": { urls: ["https://${seeded.privateHost}:8545/v1/${seeded.rpcKey}"] } } },`,
  `  search: { keys: { brave: { fromFile: "${seeded.keyFilePath}" } } },`,
  `  venues: { keys: { zerox: { fromCommand: ["op", "read", "${seeded.commandItem}"] } } },`,
  `  network: { proxy: { fromEnv: "TEST_PROXY" } },`,
  `  defaults: { limits: { denyTokens: ["eip155:56/erc20:${seeded.savedAddress}"] } },`,
  `  backups: { copyTo: "/srv/ana/backup copies" },`,
  `  remote: { publicUrl: "https://${seeded.publicHost}" },`,
].join("\n");

const signal = (): AbortSignal => new AbortController().signal;

async function readText(path: string): Promise<string> {
  const read = await readTextFile(path, signal());
  if (!read.ok) {
    throw new Error(`Expected ${path} to be there.`);
  }
  return read.value;
}

async function appendText(path: string, text: string): Promise<void> {
  const before = await readTextFile(path, signal());
  const files = { permissions: noPermissions, signal: signal() };
  await writePrivateFile(path, `${before.ok ? before.value : ""}${text}`, files);
}

async function seedConfig(folder: string): Promise<void> {
  const file = join(folder, "config.json5");
  const text = await readText(file);
  const end = text.lastIndexOf("}");
  const files = { permissions: noPermissions, signal: signal() };
  await writePrivateFile(file, `${text.slice(0, end)}${extraConfig}\n}\n`, files);
}

// The address of the install's first wallet, as `engine.sqlite` holds it.
async function walletOf(machine: TestMachine): Promise<string> {
  const [wallet] = (await storedInstall(machine)).facts.wallets;
  if (wallet === undefined) {
    throw new Error("Expected binference init to make a wallet.");
  }
  return wallet.address;
}

// Log lines a careless write could leave: secrets, a saved address and its label, chat text and a
// whole wallet address, in the engine log and in the service's own output.
async function seedLogs(folder: string, wallet: string): Promise<void> {
  const time = "2026-10-20T08:00:00.000Z";
  const lines = [
    { time, level: "warn", subsystem: "engine.chat", event: seeded.chatText },
    {
      time,
      level: "info",
      subsystem: "engine",
      event: "rescue.set",
      fields: { accountId: `eip155:56:${wallet}` },
    },
    {
      time,
      level: "info",
      subsystem: "engine",
      event: "address.added",
      fields: { accountId: `eip155:56:${seeded.savedAddress}`, sourceId: seeded.savedLabel },
    },
    {
      time,
      level: "error",
      subsystem: "engine",
      event: "owner.key",
      fields: { errorCode: seeded.ownerKeyCode },
    },
    { time, level: "info", subsystem: "engine", event: "chat.in", text: seeded.chatText },
  ];
  const free = `Error: ${fakeBotToken} ${seeded.ownerKeyCode} ${seeded.savedLabel} ${seeded.chatText}`;
  await appendText(
    join(folder, "logs", "engine.log"),
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n${free}\n`,
  );
  await appendText(join(folder, "logs", "service.log"), `${free} ${wallet}\n`);
}

async function filesUnder(folder: string, names: readonly string[]): Promise<readonly string[]> {
  return Promise.all(names.map(async (name) => (await readText(join(folder, name))).trim()));
}

describe("binference report", () => {
  it(
    "writes a bundle that holds no secret, saved address, label or chat text it was seeded with",
    slow,
    async () => {
      const machine = await engines.setUp();
      await seedConfig(machine.folder);
      const env = {
        ...secretEnv(machine),
        TEST_PROXY: `http://ana:${seeded.proxyPassword}@proxy.example.com:3128`,
      };
      expect(await engines.start(machine, { env })).toMatchObject({ state: "ready" });
      const wallet = await walletOf(machine);
      expect(wallet).toMatch(/^0x[0-9a-fA-F]{40}$/);
      await seedLogs(machine.folder, wallet);

      const reported = await runOn(machine, ["report", "--json"], { env });
      expect([reported.code, reported.stderr]).toStrictEqual([0, ""]);
      const { file } = JSON.parse(reported.stdout) as { file: string };
      expect(file.startsWith(join(machine.folder, "reports", "report-"))).toBe(true);
      const text = await readText(file);

      const keys = await filesUnder(machine.folder, [
        "keys/agent-key",
        "keys/web-push-vapid",
        "auth/cli.token",
      ]);
      const secrets = [
        ...Object.values(seeded),
        machine.privy.appSecret.reveal(),
        fakeBotToken,
        testModelKey,
        ...keys,
        wallet,
      ];
      for (const secret of secrets) {
        expect(text.toLowerCase()).not.toContain(secret.toLowerCase());
      }
      const bundle = JSON.parse(text) as Record<string, unknown>;
      expect(bundle).toMatchObject({
        format: "binference-report",
        version: 1,
        versions: { binference: "2026.10.0-test", ...testSystem },
        config: {
          chains: { rpc: { "eip155:56": { urls: ["[url:rpc]"] } } },
          search: { keys: { brave: "fromFile" } },
          venues: { keys: { zerox: "fromCommand" } },
          network: { proxy: "fromEnv" },
          telegram: { botToken: "fromEnv" },
          backups: { copyTo: "[path]" },
          remote: { publicUrl: "[url:public_address]" },
        },
        engine: { answered: true, status: { state: "ready" } },
      });
      expect(text).toContain(`eip155:56:${wallet.slice(0, 6)}…${wallet.slice(-4)}`);
      expect(bundle["check"]).toContainEqual({ check: "config.valid", level: "ok" });
      expect(bundle["logs"]).toMatchObject({ engineLog: "read", omittedLines: 2 });
    },
  );

  it("writes a bundle while the engine is stopped and says where it is", slow, async () => {
    const machine = await engines.setUp();
    const reported = await runOn(machine, ["report"]);
    expect(reported.code).toBe(0);
    const names = await listFolderFiles(join(machine.folder, "reports"), signal());
    expect(names).toHaveLength(1);
    const file = join(machine.folder, "reports", names.join(""));
    expect(reported.stdout).toContain(`The support bundle is at ${file}.`);
    const bundle = JSON.parse(await readText(file)) as Record<string, unknown>;
    expect(bundle["engine"]).toStrictEqual({ answered: false, reason: "not_running" });
  });
});
