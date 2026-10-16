import { EventEmitter } from "node:events";
import { join } from "node:path";
import { type Clock, type Http, type HttpRequest, type Secret } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { createFakePrivy, type FakePrivy } from "@binference/custody-privy/testing";
import type { AgentRecord } from "@binference/engine";
import type { InstallFacts } from "@binference/engine/install";
import { readTextFile } from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { createP256KeyPair, formatOwnerKeyCode } from "@binference/signer";
import {
  createSqliteAgentStore,
  createSqliteInstallStore,
  engineWorker,
  openDatabase,
} from "@binference/store";
import { createFakeBotApi, type FakeBotApi, fakeBotToken } from "@binference/telegram/testing";
import { runCli } from "../program/run-cli.js";
import { createFakeModelProvider, type FakeModelProvider, isModelCall } from "./model-fixtures.js";
import { type HostParts, hostOn, hostWith, type TestMachine } from "./test-host.js";

/** An address only the tests own: the rescue address of every test install. */
export const rescueAddress = "0x30435f9D276c6BC54F56161Fb3dFB7bDC2a8DBcB";

/** The environment variables the tests' secret sources name. */
export const secretVariables = { appSecret: "TEST_PRIVY_APP_SECRET", botToken: "TEST_BOT_TOKEN" };

const nowMs = 1_800_000_000_000;

/** A Privy fake that records each request it answers. */
interface RecordedPrivy extends FakePrivy {
  readonly sent: readonly HttpRequest[];
}

/** An owner key a test made where `binference owner-key create` would: its code and public half. */
export interface TestOwnerKey {
  readonly code: string;
  readonly publicKey: string;
}

/** A test machine with the outside world init reaches: Privy, the Bot API and a model provider. */
export interface InitMachine extends TestMachine {
  readonly privy: RecordedPrivy;
  readonly bot: FakeBotApi;
  readonly models: FakeModelProvider;
  /**
   * The outside world as the machine's commands reach it: Telegram's Bot API, every model call,
   * then Privy.
   */
  readonly world: Http;
  /** The owner key whose public half `initFlags` passes, made apart from init as an owner would. */
  readonly ownerKey: TestOwnerKey;
}

/** A new owner key, as `binference owner-key create` makes one on another machine. */
export function newOwnerKey(): TestOwnerKey {
  const pair = createP256KeyPair();
  return { code: formatOwnerKeyCode(pair).reveal(), publicKey: pair.publicKey };
}

const telegramOrigin = "https://api.telegram.org";

/**
 * A test machine on the given folder, clock and fake Privy, with a fake Bot API and a fake model
 * provider of its own and a world in which Telegram's origin reaches the fake bot, a Chat
 * Completions or Messages call the fake provider, and every other request the fake Privy. It
 * keeps the owner key it is given, else makes one.
 */
export function machineOf(
  machine: Omit<InitMachine, "bot" | "models" | "world" | "ownerKey"> & {
    readonly ownerKey?: TestOwnerKey;
  },
): InitMachine {
  const bot = createFakeBotApi();
  const models = createFakeModelProvider();
  const world: Http = {
    request: async (request) => {
      if (new URL(request.url).origin === telegramOrigin) {
        return bot.http.request(request);
      }
      return isModelCall(request)
        ? models.http.request(request)
        : machine.privy.http.request(request);
    },
  };
  return { ...machine, ownerKey: machine.ownerKey ?? newOwnerKey(), bot, models, world };
}

/** What one `binference` run gave. */
export interface CliRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function recorded(privy: FakePrivy): RecordedPrivy {
  const sent: HttpRequest[] = [];
  const http: Http = {
    request: async (request) => {
      sent.push(request);
      return privy.http.request(request);
    },
  };
  return { ...privy, http, sent };
}

/**
 * Makes a test machine in a fresh folder, and hands its folder to `folders` for cleanup. Its clock
 * is a manual one unless the test gives its own, such as the system clock on a fork.
 */
export async function newInitMachine(
  folders: TempFolder[],
  clock: Clock = createManualClock(nowMs),
): Promise<InitMachine> {
  const folder = await createTempFolder("bnf-init-");
  folders.push(folder);
  const privy = recorded(createFakePrivy({ clock, random: createSeededRandom(folders.length) }));
  return machineOf({ folder: folder.path, clock, signals: new EventEmitter(), privy });
}

/** The flags of a run with no person: every answer from a flag, secrets from variables. */
export function initFlags(machine: InitMachine): readonly string[] {
  return [
    "--privy-app-id",
    machine.privy.appId,
    "--privy-app-secret",
    `{ fromEnv: "${secretVariables.appSecret}" }`,
    "--bot-token",
    `{ fromEnv: "${secretVariables.botToken}" }`,
    "--rescue",
    rescueAddress,
    "--owner-key-public",
    machine.ownerKey.publicKey,
    "--unlock",
    "file",
  ];
}

/** The secrets of the machine's fakes, in the variables the flags name. */
export function secretEnv(
  machine: InitMachine,
  appSecret: Secret = machine.privy.appSecret,
): Readonly<Record<string, string>> {
  return Object.fromEntries([
    [secretVariables.appSecret, appSecret.reveal()],
    [secretVariables.botToken, fakeBotToken],
  ]);
}

/** Runs one `binference` command line on the machine, its outside world served by the fakes. */
export async function runOn(
  machine: InitMachine,
  argv: readonly string[],
  options: { readonly env?: Readonly<Record<string, string>>; readonly parts?: HostParts } = {},
): Promise<CliRun> {
  const host = hostWith(machine, argv, {
    env: options.env ?? secretEnv(machine),
    parts: { http: machine.world, ...options.parts },
  });
  const code = await runCli(host);
  return { code, stdout: host.stdout(), stderr: host.stderr() };
}

/** The text of the machine's config file, or `undefined` before one is written. */
export async function configText(machine: TestMachine): Promise<string | undefined> {
  const read = await readTextFile(
    join(machine.folder, "config.json5"),
    new AbortController().signal,
  );
  return read.ok ? read.value : undefined;
}

/** What `engine.sqlite` holds about the install and its agents, read on store workers. */
export async function storedInstall(
  machine: TestMachine,
): Promise<{ readonly facts: InstallFacts; readonly agents: readonly AgentRecord[] }> {
  const signal = new AbortController().signal;
  const database = await openDatabase({
    file: join(machine.folder, "engine.sqlite"),
    worker: engineWorker,
    execArgv: hostOn(machine, []).workerExecArgv ?? [],
    signal,
  });
  try {
    const facts = await createSqliteInstallStore(database).read({ signal });
    const agents = await createSqliteAgentStore(database).list({ signal });
    return { facts, agents };
  } finally {
    await database.close();
  }
}
