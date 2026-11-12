import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createProtocolClient } from "@binference/client";
import { BinferenceError } from "@binference/core";
import { createMemoryLogger } from "@binference/core/testing";
import { sha256Hex } from "@binference/engine";
import { listFolderFiles, readTextFile } from "@binference/platform";
import {
  deviceOnlyOperations,
  type Operation,
  type OperationName,
  operations,
  scopes,
} from "@binference/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { ipcWebSocket } from "../commands/connect-engine.js";
import { engineEndpoint, platformOf } from "../compose/engine-locations.js";
import type { InitMachine } from "./init-fixtures.js";
import { connectClient, hostOn } from "./test-host.js";
import { createRunningEngines } from "./unlock-fixtures.js";

// Every protocol operation is served by the engine `binference start` runs, but those named
// below, and no surface names one of those. A surface's own tests can pass on a fake that answers
// an operation the engine never serves: the agent's wallets, quote and token tools once called
// four such operations, and every call failed `protocol.unknown_op`.

const notBuiltExchange = "Not built: the Binance exchange account and its agents come later.";
const logsInTheCli = "Not built: `binference logs` reads and follows the log files in the CLI.";

/** The operations the self-hosted engine leaves unserved, each with why. */
const unservedOperations: Readonly<Partial<Record<OperationName, string>>> = {
  "agent/archive": "Not built: no surface archives an agent yet.",
  "agent/create": "Not built: `binference init` makes the install's one agent.",
  "agent/rename": "Not built: an agent keeps the name `binference init` gave it.",
  "backup/restore":
    "Decision 0152: `binference backup restore` restores in the CLI, which needs the owner key " +
    "for the whole restore.",
  "binanceAgent/connect": notBuiltExchange,
  "binanceAgent/list": notBuiltExchange,
  "binanceAgent/pause": notBuiltExchange,
  "binanceAgent/record": notBuiltExchange,
  "binanceAgent/report": notBuiltExchange,
  "binanceAgent/resume": notBuiltExchange,
  "binanceAgent/setLimits": notBuiltExchange,
  "binanceAgent/stop": notBuiltExchange,
  "binanceAgent/timeline": notBuiltExchange,
  "cex/connect": notBuiltExchange,
  "cex/disconnect": notBuiltExchange,
  "cex/status": notBuiltExchange,
  "check/run": "Not built: `binference check` runs its checks in the CLI.",
  "config/read":
    "Not built: `binference config` reads config.json5 in the CLI, and chats read the settings " +
    "with `config/view`.",
  "intent/cancel":
    "Not built: the owner turns a card down with `intent/deny`; a proposer cannot withdraw its " +
    "own card yet.",
  "ledger/export": "Not built: no surface exports the ledger as CSV yet.",
  "log/follow": logsInTheCli,
  "log/unfollow": logsInTheCli,
  "report/create":
    "Decision 0263: `binference report` writes the support bundle in the CLI, so it works while " +
    "the engine is stopped.",
  "token/create":
    "Decision 0154: the CLI makes a token and registers only its hash with `token/register`, so " +
    "no secret reaches the idempotency store.",
  "wallet/exportKey":
    "Decision 0131: a key leaves custody only sealed, with `wallet/exportSealed`.",
  "wallet/rename": "Not built: a wallet keeps the label it was made with.",
};

const unservedNames = (Object.keys(unservedOperations) as OperationName[]).toSorted();

// What the probe sends: no operation's args schema takes it, so no handler runs.
const probeArgs = { servedProbe: true };
const slow = { timeout: 60_000 };
const engines = createRunningEngines();
const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(20_000) });

afterEach(async () => {
  await engines.stopAll();
});

type ProbeShapes = Readonly<
  Record<OperationName, { readonly args: unknown; readonly result: unknown }>
>;

// The protocol's table with no schema of its own and no idempotency key, so every call reaches
// the engine as sent, and the engine's dispatch answers whether it has a handler before it reads a
// key or the args.
function probeTable(): { readonly [N in OperationName]: Operation } {
  const entries = Object.values(operations).map((operation: Operation) => [
    operation.name,
    { ...operation, kind: "read", idempotency: "none", args: z.unknown(), result: z.unknown() },
  ]);
  return Object.fromEntries(entries) as { readonly [N in OperationName]: Operation };
}

// Registers, through the CLI, a token that holds every scope, so no scope hides a handler.
async function registerProbeToken(machine: InitMachine): Promise<string> {
  const cli = await connectClient(machine);
  const secret = `bnt_${"7".repeat(43)}`;
  const register = { label: "served probe", kind: "custom", scopes: [...scopes] } as const;
  await cli.call("token/register", { ...register, secretHash: sha256Hex(secret) }, live());
  cli.close();
  return secret;
}

// A client of the probe table signed in over IPC with the probe's token.
async function probeClient(machine: InitMachine, secret: string) {
  const host = hostOn(machine, []);
  const address = engineEndpoint(platformOf(host)).address;
  const client = createProtocolClient<ProbeShapes>({
    operations: probeTable(),
    openSocket: () => ipcWebSocket(address),
    client: { kind: "cli", version: host.version },
    credential: { token: secret },
    clock: host.clock,
    random: host.random,
    logger: createMemoryLogger({ subsystem: "cli" }),
  });
  await client.connect(live().signal);
  return client;
}

/** What a probe's answer says of the operation's handler, or the code that says nothing. */
type Answer = "served" | "unserved" | "device_only" | `unread ${string}`;

// The engine's dispatch refuses a call with no handler before its key or args; a handler that
// exists meets the missing key or the probe's args first. A device-only operation is refused
// before its handler is looked for.
const answers: Readonly<Record<string, Answer>> = {
  "protocol.bad_args": "served",
  "protocol.key_required": "served",
  "protocol.unknown_op": "unserved",
  "runtime.unavailable": "unserved",
  "auth.device_only": "device_only",
};

function answerOf(code: string): Answer {
  return answers[code] ?? `unread ${code}`;
}

// `push/subscribe` and `push/unsubscribe` are the server's own, which a client's `subscribe` calls.
type Callable = Exclude<OperationName, "push/subscribe" | "push/unsubscribe">;

function isCallable(name: OperationName): name is Callable {
  return name !== "push/subscribe" && name !== "push/unsubscribe";
}

async function probeOne(
  client: Awaited<ReturnType<typeof probeClient>>,
  name: Callable,
): Promise<Answer> {
  return client.call(name, probeArgs, live()).then(
    () => answerOf("a reply: a handler ran"),
    (error: unknown) => answerOf(error instanceof BinferenceError ? error.code : String(error)),
  );
}

// A connection's call budget holds a burst of 60 on the engine's clock, which a test machine's
// manual clock never refills: each 50 calls take a connection of their own.
const callsPerConnection = 50;

async function probeAll(
  machine: InitMachine,
  names: readonly Callable[],
): Promise<ReadonlyMap<OperationName, Answer>> {
  const secret = await registerProbeToken(machine);
  const found = new Map<OperationName, Answer>();
  for (let first = 0; first < names.length; first += callsPerConnection) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one connection at a time
    const client = await probeClient(machine, secret);
    for (const name of names.slice(first, first + callsPerConnection)) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one call at a time, within the burst
      found.set(name, await probeOne(client, name));
    }
    client.close();
  }
  return found;
}

function namesAnswering(found: ReadonlyMap<OperationName, Answer>, answer: Answer) {
  return [...found]
    .filter(([, each]) => each === answer)
    .map(([name]) => name)
    .toSorted();
}

const callable = (Object.keys(operations) as OperationName[]).filter(isCallable);

// The packages that call the engine: the agent runtime, the MCP server, the owner's bot, terminal
// chat, the console and the CLI's commands. Tests, fakes and the CLI's test machines and model
// evaluation answer operations in the engine's place, so they are not read.
const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const surfaces = ["runtime", "mcp", "telegram", "tui", "console", "cli"];
const notSurfaceCode =
  /\.test\.tsx?$|(?:^|\/)(?:testing|fakes|e2e|fork|crash|image|packed|evaluation)\//;
// An operation's name in quotes is a call or a type naming one; a name in backticks is prose.
const quotedName = /["']([a-zA-Z]+\/[a-zA-Z]+)["']/g;

async function quotedNamesIn(surface: string): Promise<readonly string[]> {
  const folder = join(repo, "packages", surface, "src");
  const files = await listFolderFiles(folder, live().signal);
  const sources = files.filter((file) => /\.tsx?$/.test(file) && !notSurfaceCode.test(file));
  const reads = await Promise.all(
    sources.map(async (file) => ({
      file,
      read: await readTextFile(join(folder, file), live().signal),
    })),
  );
  return reads.flatMap(({ file, read }) =>
    [...(read.ok ? read.value : "").matchAll(quotedName)].map(
      ([, name]) => `${surface}/src/${file}: ${String(name)}`,
    ),
  );
}

describe("the operations the self-hosted engine serves", () => {
  it("takes the probe's args in no operation's schema", () => {
    const taking = Object.values(operations).filter(
      (operation: Operation) => operation.args.safeParse(probeArgs).success,
    );
    expect(taking.map(({ name }) => name)).toStrictEqual([]);
  });

  it("serves every operation but those it leaves unserved", slow, async () => {
    const machine = await engines.setUp();
    await engines.start(machine);
    const found = await probeAll(machine, callable);
    const unread = [...found].filter(([, answer]) => answer.startsWith("unread"));
    expect(unread).toStrictEqual([]);
    // The named operations answer `protocol.unknown_op`, so a dispatch that read the args before
    // the handler would read them served and fail here too.
    expect(namesAnswering(found, "unserved")).toStrictEqual(unservedNames);
    expect(namesAnswering(found, "device_only")).toStrictEqual(
      [...deviceOnlyOperations].toSorted(),
    );
  });

  it("names no unserved operation in a surface's code", async () => {
    const named = (await Promise.all(surfaces.map(quotedNamesIn))).flat();
    const unserved = new Set<string>(unservedNames);
    const calls = named.filter((line) => unserved.has(line.slice(line.lastIndexOf(" ") + 1)));
    expect(named.length).toBeGreaterThan(100);
    expect(calls).toStrictEqual([]);
  });
});
