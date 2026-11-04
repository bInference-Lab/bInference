import { join } from "node:path";
import process from "node:process";
import { BinferenceError } from "@binference/core";
import { createFakePrivy } from "@binference/custody-privy/testing";
import { ensureReadableFolder, readTextFile, writeReadableFile } from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { fakeBotToken } from "@binference/telegram/testing";
import { z } from "zod";
import { newOwnerKey, rescueAddress } from "../e2e/init-fixtures.js";
import { testModelId, testModelKey } from "../e2e/model-fixtures.js";
import { freePort } from "../e2e/test-host.js";
import { createSystemClock } from "../runtime/system-clock.js";
import { createSystemRandom } from "../runtime/system-random.js";
import { createPackedBinference, type PackedBinference } from "./packed-binference.js";
import { createSmokeBot, type SmokeBot } from "./smoke-bot.js";
import { startSmokeEdge } from "./smoke-edge.js";
import { type SmokeToolCall, startSmokeModel } from "./smoke-model.js";

/** What the smoke's model says: the tool call of the agent's first turn, then its report. */
export interface SmokeScript {
  readonly call: SmokeToolCall;
  readonly report: string;
}

/** The packed-install smoke's world, each part closed by `close`. */
export interface SmokeParts {
  /** The state folder, `BINFERENCE_HOME` of every command. */
  readonly home: string;
  readonly bot: SmokeBot;
  readonly binference: PackedBinference;
  /** `binference init --yes`'s flags for this world. */
  readonly initArgs: readonly string[];
  /** The `host:port` of each tunnel the proxy was asked for, oldest first. */
  readonly tunnels: readonly string[];
  close(): Promise<void>;
}

const binSchema = z.looseObject({ bin: z.record(z.string(), z.string()) });

// The installed command's own file, as npm's link to it names it.
async function binOf(install: string): Promise<string> {
  const folder = join(install, "node_modules", "binference");
  const read = await readTextFile(join(folder, "package.json"), AbortSignal.timeout(5_000));
  const bin = read.ok ? binSchema.parse(JSON.parse(read.value)).bin["binference"] : undefined;
  if (bin === undefined) {
    throw new BinferenceError({
      code: "smoke.no_command",
      message: `${folder} holds no binference command.`,
    });
  }
  return join(folder, bin);
}

function initFlags(parts: { readonly appId: string; readonly baseUrl: string }): string[] {
  return [
    ["init", "--yes", "--json", "--accept-disclaimer", "--unlock", "file"],
    ["--model-provider", "openai-compatible", "--model-base-url", parts.baseUrl],
    ["--model", testModelId, "--model-key", '{ fromEnv: "SMOKE_MODEL_KEY" }'],
    ["--privy-app-id", parts.appId, "--privy-app-secret", '{ fromEnv: "SMOKE_APP_SECRET" }'],
    ["--bot-token", '{ fromEnv: "SMOKE_BOT_TOKEN" }', "--rescue", rescueAddress],
    ["--owner-key-public", newOwnerKey().publicKey, "--proxy", '{ fromEnv: "SMOKE_PROXY" }'],
  ].flat();
}

// The variables of this process the commands keep: where programs and temporary files are.
function passedOn(names: readonly string[]): Readonly<Record<string, string>> {
  return Object.fromEntries(
    names.flatMap((name) => {
      const value = process.env[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
}

// Each command's variables: the state and home folders in the smoke's folder, English words, the
// edge's certificate trusted, free ports, and the secrets the flags name.
async function envOf(
  folder: TempFolder,
  edge: { readonly proxyUrl: string; readonly cert: string },
  appSecret: string,
): Promise<Readonly<Record<string, string>>> {
  const signal = AbortSignal.timeout(10_000);
  const certFile = join(folder.path, "edge.pem");
  await writeReadableFile(certFile, Buffer.from(edge.cert), signal);
  const home = join(folder.path, "home");
  await ensureReadableFolder(home, signal);
  return {
    BINFERENCE_HOME: join(folder.path, "state"),
    HOME: home,
    USERPROFILE: home,
    LANG: "en_US.UTF-8",
    NODE_EXTRA_CA_CERTS: certFile,
    BINFERENCE_ENGINE__PORT: String(await freePort()),
    BINFERENCE_ENGINE__WEBHOOK_PORT: String(await freePort()),
    SMOKE_PROXY: edge.proxyUrl,
    SMOKE_APP_SECRET: appSecret,
    SMOKE_BOT_TOKEN: fakeBotToken,
    SMOKE_MODEL_KEY: testModelKey,
    ...passedOn(["PATH", "TMPDIR", "TMP", "TEMP"]),
  };
}

/**
 * Opens the smoke's world for the install in `install`: a fresh folder for its state, the fake
 * Privy and the synthetic Bot API behind the edge's proxy, and the scripted model.
 */
export async function openSmokeParts(install: string, script: SmokeScript): Promise<SmokeParts> {
  const folder = await createTempFolder("bnf-smoke-");
  const privy = createFakePrivy({ clock: createSystemClock(), random: createSystemRandom() });
  const bot = createSmokeBot();
  const fakes = new Map([
    ["api.privy.io", privy.http],
    ["api.telegram.org", bot.http],
  ]);
  const edge = await startSmokeEdge(fakes, Date.now());
  const model = await startSmokeModel(script);
  const env = await envOf(folder, edge, privy.appSecret.reveal());
  const binference = createPackedBinference({
    bin: await binOf(install),
    parentEnv: process.env,
    env,
  });
  return {
    home: env["BINFERENCE_HOME"] ?? "",
    bot,
    binference,
    initArgs: initFlags({ appId: privy.appId, baseUrl: model.baseUrl }),
    tunnels: edge.tunnels,
    close: async () => {
      await Promise.all([edge.close(), model.close()]);
      await folder.remove();
    },
  };
}
