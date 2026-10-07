import { EventEmitter } from "node:events";
import { join } from "node:path";
import { type Http, type HttpRequest, type Secret } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { createFakePrivy, type FakePrivy } from "@binference/custody-privy/testing";
import type { AgentRecord } from "@binference/engine";
import type { InstallFacts } from "@binference/engine/install";
import { readTextFile } from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import {
  createSqliteAgentStore,
  createSqliteInstallStore,
  engineWorker,
  openDatabase,
} from "@binference/store";
import { createFakeBotApi, type FakeBotApi, fakeBotToken } from "@binference/telegram/testing";
import { runCli } from "../program/run-cli.js";
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

/** A test machine with the outside world init reaches: Privy and the Bot API, both fakes. */
export interface InitMachine extends TestMachine {
  readonly privy: RecordedPrivy;
  readonly bot: FakeBotApi;
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

/** Makes a test machine in a fresh folder, and hands its folder to `folders` for cleanup. */
export async function newInitMachine(folders: TempFolder[]): Promise<InitMachine> {
  const folder = await createTempFolder("bnf-init-");
  folders.push(folder);
  const clock = createManualClock(nowMs);
  return {
    folder: folder.path,
    clock,
    signals: new EventEmitter(),
    privy: recorded(createFakePrivy({ clock, random: createSeededRandom(folders.length) })),
    bot: createFakeBotApi(),
  };
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
    parts: { http: machine.privy.http, botApiFetch: machine.bot.fetch, ...options.parts },
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
