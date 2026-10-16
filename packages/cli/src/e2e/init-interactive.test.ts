import { join } from "node:path";
import { messages } from "@binference/i18n";
import type { TempFolder } from "@binference/platform/testing";
import { fakeBotToken } from "@binference/telegram/testing";
import { afterEach, describe, expect, it } from "vitest";
import type { Transcript } from "../term/scripted-prompter.js";
import {
  configText,
  type InitMachine,
  newInitMachine,
  rescueAddress,
  secretVariables,
  storedInstall,
} from "./init-fixtures.js";
import {
  fileText,
  type InitScript,
  initScript,
  interactiveInit,
  lastSix,
  shownCode,
} from "./init-script.js";

const slow = { timeout: 60_000 };
const folders: TempFolder[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

const en = (key: string): string => messages.en[`init.${key}`] ?? `missing ${key}`;

// The check-back as a person may type it: in capitals, with a space in the middle.
function spacedCapitals(transcript: Transcript): string {
  const six = lastSix(transcript).toUpperCase();
  return `${six.slice(0, 3)} ${six.slice(3)}`;
}

const script = initScript;

async function interactive(
  machine: InitMachine,
  answers: InitScript,
  flags: readonly string[] = ["--unlock", "file"],
) {
  return interactiveInit(machine, answers, { flags });
}

describe("binference init with a person at the terminal", () => {
  it("takes every answer, the owner key's check-back and the limits", slow, async () => {
    const machine = await newInitMachine(folders);
    const run = await interactive(
      machine,
      script(machine, {
        rescue: ["not an address", rescueAddress],
        perTradeUsd: ["fifty", "50"],
      }),
    );
    expect(run.stderr).toBe("");
    expect(run.code).toBe(0);
    expect(shownCode(run.transcript)).toMatch(/^bnok1[a-z2-7]{5}( [a-z2-7]{1,5}){11}$/);
    expect(run.transcript.lines).toContain(en("rescue.invalid"));
    expect(run.transcript.lines).toContain(en("limits.invalid"));
    expect(run.transcript.lines).toContain(en("ownerKey.checked"));
    const config = await configText(machine);
    expect(config).toContain('perTradeUsd: "50",');
    expect(config).toContain('rollingDayUsd: "500",');
    expect(config).toContain(
      `appSecret: { fromFile: ${JSON.stringify(join(machine.folder, "keys", "privy-app-secret"))} },`,
    );
    await expect(fileText(machine, "keys", "privy-app-secret")).resolves.toBe(
      `${machine.privy.appSecret.reveal()}\n`,
    );
    await expect(fileText(machine, "keys", "telegram-bot")).resolves.toBe(`${fakeBotToken}\n`);
    const { agents } = await storedInstall(machine);
    expect(agents).toMatchObject([{ name: "main", mode: "paper" }]);
  });

  it("takes a check-back typed in capitals and with a space", slow, async () => {
    const machine = await newInitMachine(folders);
    const run = await interactive(machine, script(machine, { ownerKeyCheck: [spacedCapitals] }));
    expect(run.code).toBe(0);
  });

  it("blocks after three wrong check-backs, before Privy makes anything", slow, async () => {
    const machine = await newInitMachine(folders);
    const run = await interactive(
      machine,
      // Digits 0, 1, 8 and 9 never appear in base32: no typo here matches by chance.
      script(machine, { ownerKeyCheck: ["000000", "111111", "888 999"] }),
    );
    expect(run.code).toBe(1);
    expect(run.stderr).toBe(`${en("refused.ownerKeyUnconfirmed")}\n`);
    expect(run.transcript.asked.filter((id) => id === "ownerKeyCheck")).toHaveLength(3);
    expect(run.transcript.asked).not.toContain("rescue");
    expect(machine.privy.sent.map((request) => request.method)).toStrictEqual(["GET"]);
    await expect(configText(machine)).resolves.toBeUndefined();
    await expect(fileText(machine, "keys", "agent-key")).resolves.toBeUndefined();
    const { facts } = await storedInstall(machine);
    expect(facts).toStrictEqual({ wallets: [] });
  });

  it("asks again for a Privy secret Privy refuses", slow, async () => {
    const machine = await newInitMachine(folders);
    const run = await interactive(
      machine,
      script(machine, {
        privyAppId: [machine.privy.appId, machine.privy.appId],
        privyAppSecret: ["a wrong secret", machine.privy.appSecret.reveal()],
      }),
    );
    expect(run.code).toBe(0);
    expect(run.transcript.lines).toContain(en("privy.rejected"));
  });

  it("asks again for a bot token Telegram refuses or that is none", slow, async () => {
    const machine = await newInitMachine(folders);
    const unknown = "7012345678:AAE_anotherTokenTelegramDoesNotKnow_12";
    const run = await interactive(
      machine,
      script(machine, { botToken: ["not a token", unknown, fakeBotToken] }),
    );
    expect(run.code).toBe(0);
    expect(run.transcript.lines).toContain(en("bot.malformed"));
    expect(run.transcript.lines).toContain(en("bot.rejected"));
  });

  it("seals the agent key with a passphrase typed twice in the manual mode", slow, async () => {
    const machine = await newInitMachine(folders);
    const passphrase = "a passphrase of some length";
    const run = await interactive(
      machine,
      script(machine, {
        passphrase: ["short", passphrase, passphrase],
        passphraseAgain: ["another one", passphrase],
      }),
      [
        "--unlock",
        "manual",
        "--privy-app-secret",
        `{ fromEnv: "${secretVariables.appSecret}" }`,
        "--bot-token",
        `{ fromEnv: "${secretVariables.botToken}" }`,
      ],
    );
    expect(run.stderr).toBe("");
    expect(run.code).toBe(0);
    expect(run.transcript.lines).toContain(en("passphrase.short"));
    expect(run.transcript.lines).toContain(en("passphrase.mismatch"));
    const sealed = await fileText(machine, "keys", "agent-key.json");
    expect(sealed).toContain('"format": "binference-agent-key"');
    expect(sealed).not.toContain("MIG");
    await expect(configText(machine)).resolves.toContain('mode: "manual",');
  });

  it("stops without a word to Privy when the person cancels a question", slow, async () => {
    const machine = await newInitMachine(folders);
    const run = await interactive(machine, script(machine, { botToken: [] }));
    expect(run.code).toBe(1);
    expect(run.stderr).toBe(`${en("fault.cancelled")}\n`);
    expect(machine.privy.sent.map((request) => request.method)).toStrictEqual(["GET"]);
  });
});
