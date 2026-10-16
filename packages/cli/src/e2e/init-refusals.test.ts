import { join } from "node:path";
import { createSecret, type Http } from "@binference/core";
import { messages } from "@binference/i18n";
import { acquireFileLock, listFolderFiles } from "@binference/platform";
import type { TempFolder } from "@binference/platform/testing";
import { createP256KeyPair, formatAgentKey } from "@binference/signer";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  configText,
  initFlags,
  type InitMachine,
  newInitMachine,
  newOwnerKey,
  runOn,
  secretEnv,
  storedInstall,
} from "./init-fixtures.js";

const slow = { timeout: 60_000 };
const folders: TempFolder[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

const en = (key: string): string => messages.en[`init.${key}`] ?? `missing ${key}`;

async function init(machine: InitMachine, flags: readonly string[], env = secretEnv(machine)) {
  return runOn(machine, ["init", "--yes", "--json", ...flags], { env });
}

function errorCode(stdout: string): unknown {
  const answer: unknown = JSON.parse(stdout);
  return typeof answer === "object" && answer !== null && "error" in answer ? answer.error : answer;
}

// The flags without one flag and its value.
function withoutFlag(flags: readonly string[], flag: string): readonly string[] {
  const at = flags.indexOf(flag);
  return at === -1 ? flags : [...flags.slice(0, at), ...flags.slice(at + 2)];
}

// Holds the folder's engine lock, as a running engine does, until the answer is called.
function heldLock(machine: InitMachine): () => void {
  const lock = acquireFileLock(join(machine.folder, "engine.lock"));
  if (!lock.ok) {
    throw new Error("The test could not take the engine lock.");
  }
  return () => {
    lock.value.release();
  };
}

// The machine's world, except that every wallet the fake Privy reads back has no owner.
function ownerless(machine: InitMachine): Http {
  return {
    request: async (request) => {
      const answer = await machine.world.request(request);
      const isWalletRead = request.method === "GET" && /\/v1\/wallets\/[^/?]+$/.test(request.url);
      return isWalletRead
        ? { ...answer, body: JSON.stringify({ ...JSON.parse(answer.body), owner_id: null }) }
        : answer;
    },
  };
}

const posts = (machine: InitMachine): number =>
  machine.privy.sent.filter((request) => request.method === "POST").length;

describe("binference init on a folder set up before", () => {
  it("refuses a second run and changes nothing", slow, async () => {
    const machine = await newInitMachine(folders);
    await init(machine, initFlags(machine));
    const before = await configText(machine);
    const sent = machine.privy.sent.length;
    const again = await runOn(machine, ["init", "--yes", ...initFlags(machine)]);
    expect(again.code).toBe(1);
    expect(again.stderr).toBe(
      `${en("refused.alreadySetUp").replace("{folder}", machine.folder)}\n`,
    );
    expect(machine.privy.sent).toHaveLength(sent);
    await expect(configText(machine)).resolves.toBe(before);
  });

  it(
    "starts over with a new owner key and wallet, keeping the stored agent key",
    slow,
    async () => {
      const machine = await newInitMachine(folders);
      const first = await init(machine, initFlags(machine));
      const firstKey = (await storedInstall(machine)).facts.custody;
      const newOwner = ["--owner-key-public", newOwnerKey().publicKey];
      const flags = withoutFlag(initFlags(machine), "--owner-key-public");
      const again = await init(machine, [...flags, ...newOwner, "--start-over"]);
      expect(again.code).toBe(0);
      expect(JSON.parse(again.stdout)).toMatchObject({ agentKey: "kept" });
      const { facts, agents } = await storedInstall(machine);
      expect(facts.custody?.agentKeyPublic).toBe(firstKey?.agentKeyPublic);
      expect(facts.custody?.ownerKeyPublic).not.toBe(firstKey?.ownerKeyPublic);
      const firstAddress = z
        .object({ wallet: z.object({ address: z.string() }) })
        .parse(JSON.parse(first.stdout)).wallet.address;
      expect(facts.wallets).toHaveLength(2);
      expect(
        facts.wallets.find((wallet) => wallet.address === firstAddress)?.archivedAtMs,
      ).toBeTypeOf("number");
      expect(facts.wallets.filter((wallet) => wallet.archivedAtMs === undefined)).toHaveLength(1);
      expect(agents).toHaveLength(1);
    },
  );

  it("refuses while an engine holds the folder", slow, async () => {
    const machine = await newInitMachine(folders);
    const release = heldLock(machine);
    try {
      const run = await init(machine, initFlags(machine));
      expect(run.code).toBe(1);
      expect(errorCode(run.stdout)).toStrictEqual({ code: "engine.already_running" });
    } finally {
      release();
    }
    expect(machine.privy.sent).toHaveLength(0);
  });
});

describe("binference init refusals before anything is made", () => {
  it("makes no owner key with nobody at a terminal, and prints no code", slow, async () => {
    const machine = await newInitMachine(folders);
    const flags = withoutFlag(initFlags(machine), "--owner-key-public");

    const json = await init(machine, flags);
    const plain = await runOn(machine, ["init", "--yes", ...flags]);

    expect([json.code, errorCode(json.stdout)]).toStrictEqual([
      1,
      { code: "init.owner_key_needs_terminal" },
    ]);
    expect([plain.code, plain.stderr]).toStrictEqual([1, `${en("refused.ownerKeyTerminal")}\n`]);
    expect(`${json.stdout}${plain.stdout}${plain.stderr}`).not.toContain("bnok1");
    expect(posts(machine)).toBe(0);
    expect(await configText(machine)).toBeUndefined();
  });

  it("refuses an owner key public half that is no P-256 key", slow, async () => {
    const machine = await newInitMachine(folders);
    const flags = withoutFlag(initFlags(machine), "--owner-key-public");

    const run = await init(machine, [...flags, "--owner-key-public", "bnok1notakey"]);

    expect([run.code, errorCode(run.stdout)]).toStrictEqual([
      1,
      { code: "init.bad_owner_key_public" },
    ]);
    expect(posts(machine)).toBe(0);
  });

  it("refuses --owner-key-public with --attach", slow, async () => {
    const machine = await newInitMachine(folders);

    const run = await init(machine, ["--attach", ...initFlags(machine)]);

    expect([run.code, errorCode(run.stdout)]).toStrictEqual([
      1,
      { code: "init.attach_owner_key_public" },
    ]);
    expect(machine.privy.sent).toHaveLength(0);
  });

  it("names the flag a run with no person lacks", slow, async () => {
    const machine = await newInitMachine(folders);
    const flags = withoutFlag(initFlags(machine), "--rescue");
    const run = await runOn(machine, ["init", "--yes", ...flags]);
    expect(run.code).toBe(1);
    const words = en("refused.needsAnswer")
      .replace("{flag}", "--rescue")
      .replace("{variable}", "BINFERENCE_INIT_RESCUE")
      .replace("{key}", "rescue");
    expect(run.stderr).toBe(`${words}\n`);
    expect(posts(machine)).toBe(0);
  });

  it("stops when Privy refuses the app secret", slow, async () => {
    const machine = await newInitMachine(folders);
    const run = await init(machine, initFlags(machine), secretEnv(machine, createSecret("wrong")));
    expect(errorCode(run.stdout)).toStrictEqual({ code: "init.privy_rejected" });
    expect(posts(machine)).toBe(0);
  });

  it("stops when Telegram refuses the bot token", slow, async () => {
    const machine = await newInitMachine(folders);
    const env = {
      ...secretEnv(machine),
      TEST_BOT_TOKEN: "7012345678:AAE_anotherTokenTelegramDoesNotKnow_12",
    };
    const run = await init(machine, initFlags(machine), env);
    expect(errorCode(run.stdout)).toStrictEqual({ code: "init.bot_rejected" });
    expect(posts(machine)).toBe(0);
  });

  it.each([
    [["--set", "custody.privy.appId=another"], { code: "init.set_owned" }],
    [
      ["--set", "defaults.limits.perTradeUsd=abc"],
      {
        code: "config.invalid",
        details: [{ path: "defaults.limits.perTradeUsd", problem: "bad_value" }],
      },
    ],
    [["--rescue", "0x0000000000000000000000000000000000000000"], { code: "init.bad_rescue" }],
    [["--privy-app-secret", '{ fromVault: "privy" }'], { code: "init.bad_source" }],
    [["--unlock", "command", "--unlock-command", "op read"], { code: "init.bad_source" }],
    [["--privy-app-id", "not an id!"], { code: "init.bad_app_id" }],
    [["--bot-token", '{ fromEnv: "NOT_SET_ANYWHERE" }'], { code: "init.source_unavailable" }],
    [["--set", 'defaults.limits.venues=["nope"]'], { code: "init.unknown_venue" }],
    [["--set", 'chains.enabled=["eip155:1"]'], { code: "init.unknown_chain" }],
    [
      ["--set", "defaults.ceiling.perTxBnb=0.0000000000000000001"],
      { code: "init.bad_ceiling_cap" },
    ],
    [["--set", 'defaults.limits.gasReserve={"eip155:1":"0.1"}'], { code: "init.bad_gas_reserve" }],
    [["--set", 'defaults.limits.denyTokens=["USDT"]'], { code: "init.bad_token" }],
  ])("refuses %j and asks Privy to make nothing", slow, async (extra, error) => {
    const machine = await newInitMachine(folders);
    const run = await init(machine, [...initFlags(machine), ...extra]);
    expect(run.code).toBe(1);
    expect(errorCode(run.stdout)).toStrictEqual(error);
    expect(posts(machine)).toBe(0);
    await expect(configText(machine)).resolves.toBeUndefined();
    await expect(storedInstall(machine)).resolves.toMatchObject({ agents: [] });
  });

  it.each([
    [["--privy-app-secret", "PRIVY_SECRET"], { code: "config.secret_inline" }],
    [["--unlock", "command"], { code: "init.needs_flag" }],
  ])("refuses %j before it writes anything", slow, async (extra, error) => {
    const machine = await newInitMachine(folders);
    const run = await init(machine, [...initFlags(machine), ...extra]);
    expect([run.code, errorCode(run.stdout)]).toStrictEqual([1, error]);
    expect(machine.privy.sent).toHaveLength(0);
    await expect(
      listFolderFiles(machine.folder, new AbortController().signal),
    ).resolves.toStrictEqual([]);
  });

  it(
    "refuses to finish when Privy reads back a wallet that differs from what it asked for",
    slow,
    async () => {
      const machine = await newInitMachine(folders);
      const run = await runOn(machine, ["init", "--yes", "--json", ...initFlags(machine)], {
        parts: { http: ownerless(machine) },
      });
      expect(run.code).toBe(1);
      expect(errorCode(run.stdout)).toStrictEqual({ code: "init.read_back_failed" });
      await expect(configText(machine)).resolves.toBeUndefined();
      const { facts } = await storedInstall(machine);
      expect(facts).toStrictEqual({ wallets: [] });
    },
  );

  it("refuses the manual mode with no person to type a passphrase", slow, async () => {
    const machine = await newInitMachine(folders);
    const run = await init(machine, [...initFlags(machine), "--unlock", "manual"]);
    expect(errorCode(run.stdout)).toStrictEqual({ code: "init.manual_needs_terminal" });
    expect(posts(machine)).toBe(0);
  });
});

describe("binference init with flags for its config", () => {
  it("writes each --set flag into the config the first agent copies", slow, async () => {
    const machine = await newInitMachine(folders);
    const run = await init(machine, [
      ...initFlags(machine),
      "--set",
      "defaults.limits.perTradeUsd=50",
    ]);
    expect(run.code).toBe(0);
    await expect(configText(machine)).resolves.toContain('perTradeUsd: "50",');
  });

  it(
    "reads the agent key a command prints in the command mode, and stores none",
    slow,
    async () => {
      const machine = await newInitMachine(folders);
      const key = createP256KeyPair();
      const program = [
        process.execPath,
        "-e",
        `process.stdout.write(${JSON.stringify(formatAgentKey(key).reveal())})`,
      ];
      const command = JSON.stringify({ fromCommand: program });
      const run = await init(machine, [
        ...initFlags(machine),
        "--unlock",
        "command",
        "--unlock-command",
        command,
      ]);
      expect(run.stderr).toBe("");
      expect(run.code).toBe(0);
      const { facts } = await storedInstall(machine);
      expect(facts.custody?.agentKeyPublic).toBe(key.publicKey);
      await expect(configText(machine)).resolves.toContain(
        `command: { fromCommand: ${JSON.stringify(program).replaceAll(",", ", ")} },`,
      );
    },
  );
});
