import { ok } from "@binference/core";
import { isPrivyId, type PrivyId } from "@binference/custody-privy";
import { createFormatter } from "@binference/i18n";
import type { TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../program/run-cli.js";
import { createScriptedPrompter } from "../term/scripted-prompter.js";
import { apiOf, ownerSigns, setUpWithOwnerKey, signsWith } from "./attach-fixtures.js";
import { type InitMachine, secretEnv, storedInstall } from "./init-fixtures.js";
import { hostWith } from "./test-host.js";
import { createRunningEngines, heldKey } from "./unlock-fixtures.js";

const slow = { timeout: 60_000 };
const engines = createRunningEngines();
const folders: TempFolder[] = [];
const live = { signal: new AbortController().signal };
const english = createFormatter({ locale: "en", timeZone: "UTC" });

afterEach(async () => {
  await engines.stopAll();
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

function privyIdOf(text: string | undefined): PrivyId {
  if (text === undefined || !isPrivyId(text)) {
    throw new Error("Expected a Privy id.");
  }
  return text;
}

// The install's wallet, its ceiling and its signer, and a second key quorum to add as a signer.
async function secondSigner(machine: InitMachine) {
  const { facts } = await storedInstall(machine);
  const api = apiOf(machine);
  const [first] = facts.wallets;
  const publicKey = facts.custody?.ownerKeyPublic ?? "";
  const other = await api.createKeyQuorum({ publicKey, displayName: "other" }, live);
  return {
    api,
    wallet: privyIdOf(first?.custodyWalletId),
    policy: privyIdOf(first?.policyId),
    own: privyIdOf(facts.custody?.agentQuorumId),
    other: other.id,
  };
}

async function revoke(machine: InitMachine, signer: string, ownerKey: string) {
  const prompter = createScriptedPrompter({ ownerKey: [ownerKey] });
  const host = hostWith(machine, ["signer", "revoke", signer], {
    env: secretEnv(machine),
    parts: { http: machine.world, prompter },
  });
  const code = await runCli(host);
  return { code, stdout: host.stdout(), stderr: host.stderr() };
}

describe("binference signer revoke", () => {
  it(
    "removes a second signer from every wallet, and refuses this machine's own key",
    slow,
    async () => {
      const { machine, ownerKey } = await setUpWithOwnerKey(folders);
      const { api, wallet, own, policy, other } = await secondSigner(machine);
      const signers = [own, other].map((signer) => ({ signer, policies: [policy] }));
      const change = { wallet, signers, expiresAtMs: machine.clock.now() + 60_000 };
      await api.setSigners(change, { authorize: ownerSigns(ownerKey), ...live });
      expect(await engines.start(machine)).toMatchObject({ state: "ready" });

      const removed = await revoke(machine, other, ownerKey);
      const ownRefused = await revoke(machine, own, ownerKey);

      expect([removed.code, removed.stderr]).toStrictEqual([0, ""]);
      expect(removed.stdout).toContain("On that machine, run `binference service remove`");
      expect(await api.wallet(wallet, live)).toMatchObject(ok({ signers: [{ signerId: own }] }));
      expect([ownRefused.code, ownRefused.stderr]).toStrictEqual([
        1,
        `${english.message("error.signer.own_key")}\n`,
      ]);
      expect(await signsWith(machine, await heldKey(machine))).toBe("signed");
    },
  );
});
