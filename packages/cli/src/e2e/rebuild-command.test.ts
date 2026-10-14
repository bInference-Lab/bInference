import { EventEmitter } from "node:events";
import type { WalletRecord } from "@binference/engine/install";
import { createFormatter } from "@binference/i18n";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../program/run-cli.js";
import { createScriptedPrompter } from "../term/scripted-prompter.js";
import { setUpWithOwnerKey, signsWith } from "./attach-fixtures.js";
import {
  configText,
  type InitMachine,
  initFlags,
  machineOf,
  secretEnv,
  storedInstall,
} from "./init-fixtures.js";
import { hostWith } from "./test-host.js";
import { createRunningEngines, heldKey } from "./unlock-fixtures.js";

const slow = { timeout: 60_000 };
const engines = createRunningEngines();
const folders: TempFolder[] = [];
const english = createFormatter({ locale: "en", timeZone: "UTC" });
const init = (key: string): string => english.message(`init.${key}`);
const wrongKey = `bnok1${"a".repeat(25)}`;

afterEach(async () => {
  await engines.stopAll();
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

// A new machine with an empty state folder, which reaches the same Privy app as `old`.
async function emptyMachine(old: InitMachine): Promise<InitMachine> {
  const folder = await createTempFolder("bnf-rebuild-");
  folders.push(folder);
  return machineOf({ ...old, folder: folder.path, signals: new EventEmitter() });
}

// `binference wallet create` on the old machine's running engine, signed with the owner key; with
// `--launch` when asked.
async function createWallet(machine: InitMachine, ownerKey: string, flags: readonly string[] = []) {
  const prompter = createScriptedPrompter({ ownerKey: [ownerKey] });
  const host = hostWith(machine, ["wallet", "create", "--label", "spare", ...flags], {
    env: secretEnv(machine),
    parts: { http: machine.world, prompter },
  });
  expect(await runCli(host)).toBe(0);
}

// Each live wallet's Privy id and role, the agent wallets first.
function rolesOf(facts: { readonly wallets: readonly WalletRecord[] }): readonly string[] {
  return facts.wallets
    .filter((wallet) => wallet.archivedAtMs === undefined)
    .map((wallet) => `${wallet.custodyWalletId} ${wallet.role ?? "agent"}`)
    .toSorted((left, right) => Number(left.endsWith("launch")) - Number(right.endsWith("launch")));
}

// `binference init --attach` on a folder with no install: the app and the bot from flags, the
// owner key, the wallet count and the limits from the person.
async function rebuild(
  machine: InitMachine,
  answers: { readonly ownerKeys: readonly string[]; readonly count: string },
) {
  // Every flag of init's but the rescue address, which the rebuild reads from the ceilings, and
  // the owner key's public half, as attach asks for its code.
  const all = initFlags(machine);
  const dropped = new Set(["--rescue", "--owner-key-public"]);
  const flags = all.filter(
    (flag, index) => !dropped.has(flag) && !dropped.has(all[index - 1] ?? ""),
  );
  const argv = ["init", "--attach", ...flags];
  const prompter = createScriptedPrompter({
    ownerKey: answers.ownerKeys,
    rebuildConfirm: [answers.count],
    perTradeUsd: ["100"],
    rollingDayUsd: ["500"],
  });
  const host = hostWith(machine, argv, {
    env: secretEnv(machine),
    parts: { http: machine.world, prompter },
  });
  const code = await runCli(host);
  return { code, stderr: host.stderr(), prompter };
}

describe("binference init --attach on a folder with no install", () => {
  it(
    "rebuilds every wallet the owner key owns, signs for them, and starts a fresh history",
    slow,
    async () => {
      const { machine: old, ownerKey } = await setUpWithOwnerKey(folders);
      expect(await engines.start(old)).toMatchObject({ state: "ready" });
      await createWallet(old, ownerKey);
      const before = await storedInstall(old);
      const fresh = await emptyMachine(old);

      const rebuilt = await rebuild(fresh, { ownerKeys: [ownerKey], count: "2" });

      expect([rebuilt.code, rebuilt.stderr]).toStrictEqual([0, ""]);
      const notes = rebuilt.prompter.transcript.notes.map((note) => note.text).join("\n");
      expect(notes).toContain(init("rebuild.warning"));
      expect(rebuilt.prompter.transcript.asked).toContain("rebuildConfirm");
      const after = await storedInstall(fresh);
      // Each wallet shows the time Privy made it, as a date the owner's language writes.
      const made = english.dateTime(old.clock.now());
      const lines = rebuilt.prompter.transcript.lines.join("\n");
      for (const { address } of after.facts.wallets) {
        expect(lines).toContain(english.message("init.rebuild.foundWallet", { address, made }));
      }
      // Wallets made in the same millisecond list by their store ids, which each machine makes.
      const ids = (facts: typeof after.facts) =>
        facts.wallets.map((item) => item.custodyWalletId).toSorted();
      expect(ids(after.facts)).toStrictEqual(ids(before.facts));
      expect(after.facts.rescueAddress).toStrictEqual(before.facts.rescueAddress);
      expect(after.facts.custody?.ownerKeyPublic).toBe(before.facts.custody?.ownerKeyPublic);
      expect(after.agents).toHaveLength(1);
      expect(await signsWith(fresh, await heldKey(fresh))).toBe("signed");
      expect(await signsWith(old, await heldKey(old))).toBe("refused");
      expect(await engines.start(fresh)).toMatchObject({ state: "ready" });
    },
  );

  it("adopts the agent's launch wallet as one, after its agent wallets", slow, async () => {
    const { machine: old, ownerKey } = await setUpWithOwnerKey(folders);
    expect(await engines.start(old)).toMatchObject({ state: "ready" });
    await createWallet(old, ownerKey, ["--launch"]);
    const before = await storedInstall(old);
    const fresh = await emptyMachine(old);

    const rebuilt = await rebuild(fresh, { ownerKeys: [ownerKey], count: "2" });

    expect([rebuilt.code, rebuilt.stderr]).toStrictEqual([0, ""]);
    expect(rolesOf((await storedInstall(fresh)).facts)).toStrictEqual(rolesOf(before.facts));
    expect(rolesOf(before.facts).map((entry) => entry.split(" ")[1])).toStrictEqual([
      "agent",
      "launch",
    ]);
  });

  it("changes nothing for a key that owns no wallet, typed three times", slow, async () => {
    const { machine: old } = await setUpWithOwnerKey(folders);
    const fresh = await emptyMachine(old);
    const sent = old.privy.sent.length;

    const refused = await rebuild(fresh, { ownerKeys: [wrongKey, wrongKey, wrongKey], count: "1" });

    expect([refused.code, refused.stderr]).toStrictEqual([
      1,
      `${init("refused.rebuildNoWallets")}\n`,
    ]);
    expect(old.privy.sent.slice(sent).map((request) => request.method)).not.toContain("PATCH");
    expect(await configText(fresh)).toBeUndefined();
  });

  it("changes nothing on Privy when the wallet count is not typed", slow, async () => {
    const { machine: old, ownerKey } = await setUpWithOwnerKey(folders);
    const fresh = await emptyMachine(old);
    const sent = old.privy.sent.length;

    const refused = await rebuild(fresh, { ownerKeys: [ownerKey], count: "7" });

    expect([refused.code, refused.stderr]).toStrictEqual([
      1,
      `${init("refused.rebuildNotConfirmed")}\n`,
    ]);
    expect(old.privy.sent.slice(sent).map((request) => request.method)).not.toContain("PATCH");
    expect(await configText(fresh)).toBeUndefined();
    expect(await signsWith(old, await heldKey(old))).toBe("signed");
  });
});
