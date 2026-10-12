import { join } from "node:path";
import { bsc } from "@binference/chains";
import { createSecret, type Http } from "@binference/core";
import {
  buildCeiling,
  type Ceiling,
  type ChainCaps,
  createPrivyApi,
  isPrivyId,
  type PrivyApi,
  type PrivyId,
  readBackWallet,
  readCeiling,
  registryCeilingChain,
} from "@binference/custody-privy";
import { createFormatter } from "@binference/i18n";
import {
  createFileSecretStore,
  createPlatform,
  listFolderFiles,
  readTextFile,
} from "@binference/platform";
import type { TempFolder } from "@binference/platform/testing";
import { openAgentKey } from "@binference/signer";
import { fakeBotToken, fakeBotUsername } from "@binference/telegram/testing";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { loadConfig } from "../config/load-config.js";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import { coreVenues } from "../init/ceiling-request.js";
import { createSystemHttp } from "../runtime/system-http.js";
import {
  configText,
  initFlags,
  type InitMachine,
  newInitMachine,
  rescueAddress,
  runOn,
  secretVariables,
  storedInstall,
} from "./init-fixtures.js";
import { isUnlocked } from "./test-host.js";

const slow = { timeout: 60_000 };
const folders: TempFolder[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

// Strict: the answer carries no owner key code, nor any field this does not name.
const answerSchema = z.strictObject({
  state: z.literal("set_up"),
  wallet: z.strictObject({ address: z.string(), privyWalletId: z.string() }),
  unlockMode: z.string(),
  agentKey: z.enum(["made", "kept"]),
  pairing: z.strictObject({ link: z.string(), expiresAtMs: z.number() }),
  configFile: z.string(),
});

type InitAnswer = z.infer<typeof answerSchema>;

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

/** Runs init with no person and answers its JSON; throws when init did not finish. */
async function initOn(
  machine: InitMachine,
  extra: readonly string[] = [],
  options: Parameters<typeof runOn>[2] = {},
): Promise<InitAnswer> {
  const argv = ["init", "--yes", "--json", ...initFlags(machine), ...extra];
  const run = await runOn(machine, argv, options);
  if (run.code !== 0 || run.stderr !== "") {
    throw new Error(`init failed: ${run.stdout} ${run.stderr}`);
  }
  return answerSchema.parse(JSON.parse(run.stdout));
}

function walletIdOf(answer: InitAnswer): PrivyId {
  const id = answer.wallet.privyWalletId;
  if (!isPrivyId(id)) {
    throw new Error(`${id} is no Privy id.`);
  }
  return id;
}

async function agentKeyOf(machine: InitMachine): Promise<string> {
  const store = createFileSecretStore({
    folder: join(machine.folder, "keys"),
    permissions: createPlatform().permissions,
  });
  const opened = await openAgentKey(store, new AbortController().signal);
  if (!opened.ok) {
    throw new Error("No agent key was stored.");
  }
  return opened.value.publicKey;
}

async function loadedConfig(machine: InitMachine): Promise<BinferenceConfig> {
  const loaded = await loadConfig({
    file: join(machine.folder, "config.json5"),
    env: {},
    sets: [],
    system: { locale: "en", timezone: "UTC", unlockMode: "file" },
    signal: new AbortController().signal,
  });
  if (!loaded.ok) {
    throw new Error("The config init wrote does not load.");
  }
  return loaded.config;
}

const bnb = 10n ** 18n;

// The 24-hour caps the wallet's ceiling names on Privy, read from its policy. Their limits are
// twice the default $500 day: 10 BNB and 10 WBNB at the $100 floor, 1,000 USDT and 1,000 USDC.
async function heldCaps(api: PrivyApi, wallet: PrivyId): Promise<ChainCaps> {
  const record = await api.wallet(wallet, live());
  const policyId = record.ok ? record.value.policyIds[0] : undefined;
  const policy = policyId === undefined ? undefined : await api.policy(policyId, live());
  const [held] = policy?.ok === true ? (readCeiling(policy.value.rules)?.caps ?? []) : [];
  if (held === undefined) {
    throw new Error("The wallet's ceiling names no caps.");
  }
  expect(held.caps.native.limitBase).toBe(10n * bnb);
  expect(held.caps.approvals.map((cap) => cap.limitBase)).toStrictEqual([
    10n * bnb,
    1_000n * bnb,
    1_000n * bnb,
  ]);
  return held.caps;
}

// The ceiling init asks for: KyberSwap's calls on BSC, a cap of 1 BNB, the caps Privy holds and
// the rescue address.
function expectedCeiling(http: Http, caps: ChainCaps): Ceiling {
  const chain = registryCeilingChain({
    definition: bsc,
    venues: coreVenues(http, { keys: {}, kyberClientId: "binference" }),
    perTxNativeCapBase: bnb,
  });
  const ceiling = chain.ok
    ? buildCeiling({ chains: [{ ...chain.value, caps }], rescue: rescueAddress, saved: [] })
    : undefined;
  if (ceiling?.ok !== true) {
    throw new Error("The expected ceiling does not build.");
  }
  return ceiling.value;
}

describe("binference init with no person at the terminal", () => {
  it("sets up a new install end to end against a fake Privy", slow, async () => {
    const machine = await newInitMachine(folders);
    const answer = await initOn(machine);
    expect(answer).toMatchObject({ unlockMode: "file", agentKey: "made" });
    expect(answer.pairing.link).toMatch(
      new RegExp(`^https://t\\.me/${fakeBotUsername}\\?start=[A-Za-z0-9_-]{22}$`),
    );
    const config = await loadedConfig(machine);
    expect(config.custody.privy).toStrictEqual({
      appId: machine.privy.appId,
      appSecret: { fromEnv: secretVariables.appSecret },
      ownerKeyPublic: machine.ownerKey.publicKey,
    });
    expect(config.telegram.botToken).toStrictEqual({ fromEnv: secretVariables.botToken });
    expect(config.engine.unlock).toStrictEqual({ mode: "file" });
    await expect(configText(machine)).resolves.toContain("// The owner's Privy app.");
    expect(isUnlocked(machine.folder)).toBe(true);
  });

  it("reads back from Privy the wallet init asked for", slow, async () => {
    const machine = await newInitMachine(folders);
    const answer = await initOn(machine);
    const api = createPrivyApi({
      http: machine.privy.http,
      clock: machine.clock,
      appId: machine.privy.appId,
      appSecret: machine.privy.appSecret,
    });
    const wallet = walletIdOf(answer);
    const expected = {
      ownerKey: machine.ownerKey.publicKey,
      agentKey: await agentKeyOf(machine),
      ceiling: expectedCeiling(machine.privy.http, await heldCaps(api, wallet)),
    };
    await expect(readBackWallet(api, { wallet, expected }, live())).resolves.toMatchObject({
      ok: true,
      value: { address: answer.wallet.address },
    });
    const otherSigner = { ...expected, agentKey: expected.ownerKey };
    await expect(
      readBackWallet(api, { wallet, expected: otherSigner }, live()),
    ).resolves.toStrictEqual({ ok: false, error: "signer" });
  });

  it("records the custody, the rescue address, the first agent and its wallet", slow, async () => {
    const machine = await newInitMachine(folders);
    const answer = await initOn(machine);
    const { facts, agents } = await storedInstall(machine);
    expect(facts.rescueAddress).toBe(`eip155:56:${rescueAddress}`);
    expect(facts.custody).toMatchObject({
      provider: "privy",
      appId: machine.privy.appId,
      ownerKeyPublic: machine.ownerKey.publicKey,
      agentKeyPublic: await agentKeyOf(machine),
    });
    expect(facts.wallets).toMatchObject([
      {
        address: answer.wallet.address,
        custodyWalletId: answer.wallet.privyWalletId,
        ceiling: { perTxNativeBase: 10n ** 18n },
      },
    ]);
    expect(agents).toMatchObject([{ name: "main", mode: "paper" }]);
    const workspace = join(machine.folder, "workspace");
    const made = ["FIRST-CHAT.md", "NOTES.md", "OWNER.md", "PERSONA.md", "RULES.md", "STRATEGY.md"];
    const signal = new AbortController().signal;
    expect((await listFolderFiles(workspace, signal)).toSorted()).toStrictEqual(
      agents.flatMap((agent) => made.map((file) => `${agent.id}/${file}`)),
    );
    const rules = await Promise.all(
      agents.map(async (agent) => readTextFile(join(workspace, agent.id, "RULES.md"), signal)),
    );
    const expected = createFormatter({ locale: "en", timeZone: "UTC" }).message("workspace.rules", {
      agent: "main",
    });
    expect(rules).toStrictEqual([{ ok: true, value: expected }]);
  });
});

// The live half: init against the owner's Privy test app, only when this switch is set with the
// app's id and secret in the environment, never in the repository. Each run makes two key
// quorums, one policy and one wallet on the app; the bot stays the fake Bot API.
const environment = process.env;
const {
  BINFERENCE_PRIVY_TESTS: switchOn,
  BINFERENCE_PRIVY_APP_ID: liveAppId = "",
  BINFERENCE_PRIVY_APP_SECRET: liveSecret = "",
} = environment;
const liveTests = switchOn === "1" && liveAppId !== "" && liveSecret !== "";
const liveEnv = Object.fromEntries([
  [secretVariables.appSecret, liveSecret],
  [secretVariables.botToken, fakeBotToken],
]);

describe.runIf(liveTests)("binference init against the Privy test app", () => {
  it(
    "sets up an install whose wallet Privy reads back as init asked",
    { timeout: 120_000 },
    async () => {
      const machine = await newInitMachine(folders);
      const http = createSystemHttp({ version: "test" });
      try {
        const parts = { http };
        const answer = await initOn(machine, ["--privy-app-id", liveAppId], {
          env: liveEnv,
          parts,
        });
        const appSecret = createSecret(liveSecret);
        const api = createPrivyApi({ http, clock: machine.clock, appId: liveAppId, appSecret });
        const expected = {
          ownerKey: machine.ownerKey.publicKey,
          agentKey: await agentKeyOf(machine),
          ceiling: expectedCeiling(http, await heldCaps(api, walletIdOf(answer))),
        };
        await expect(
          readBackWallet(api, { wallet: walletIdOf(answer), expected }, live()),
        ).resolves.toMatchObject({ ok: true, value: { address: answer.wallet.address } });
      } finally {
        await http.close();
      }
    },
  );
});
