import { createConnection } from "node:net";
import { createProtocolClient, type ProtocolClient } from "@binference/client";
import { BinferenceError, createDeadline } from "@binference/core";
import { operations, type ProtocolErrorCode, protocolErrorCodes } from "@binference/protocol";
import { WebSocket } from "ws";
import { cliTokenFile, readCliToken } from "../compose/cli-token.js";
import { engineEndpoint, platformOf } from "../compose/engine-locations.js";
import { createFileLogger } from "../logging/file-logger.js";
import type { CliHost } from "../program/cli-host.js";
import type { CliOutput, ExitCode } from "../program/cli-output.js";

/** A CLI client signed in to the engine over IPC, or why there is none. */
export type EngineConnection =
  | { readonly ok: true; readonly client: ProtocolClient }
  | { readonly ok: false; readonly reason: "not_running"; readonly folder: string }
  | { readonly ok: false; readonly reason: "no_sign_in"; readonly file: string }
  | { readonly ok: false; readonly reason: "refused" | "failed"; readonly code: string };

const commandBudgetMs = 15_000;
// A one-shot command tries a lost connection once more, then gives up.
const oneShotReconnect = { attempts: 1, baseDelayMs: 200, maxDelayMs: 200, budgetMs: 2_000 };

/**
 * A WebSocket to the engine over its IPC socket; the host name only fills the request line. A
 * `ws` socket throws an `error` event nobody hears, such as a write to an engine that stopped a
 * moment ago. The client reads only `close`, which always follows, so both hear errors here.
 */
function ipcWebSocket(address: string): WebSocket {
  const socket = new WebSocket("ws://localhost/ws", {
    createConnection: () => createConnection({ path: address }).on("error", () => undefined),
    perMessageDeflate: false,
  });
  socket.on("error", () => undefined);
  return socket;
}

type CallFailure = Extract<EngineConnection, { readonly reason: "refused" | "failed" }>;

function failureOf(error: ErrorOptions["cause"]): CallFailure {
  const code = error instanceof BinferenceError ? error.code : "unexpected";
  return { ok: false, reason: code.startsWith("auth.") ? "refused" : "failed", code };
}

/**
 * Connects the CLI to the engine of the host's state folder over its IPC endpoint and signs in
 * with the token in `auth/cli.token`. Answers `not_running` when nothing listens there, and
 * `no_sign_in` when the token file is missing. The caller closes the client.
 */
export async function connectEngine(host: CliHost, signal: AbortSignal): Promise<EngineConnection> {
  const platform = platformOf(host);
  const endpoint = engineEndpoint(platform);
  const probe = await endpoint.connect(signal);
  if (!probe.ok) {
    return { ok: false, reason: "not_running", folder: platform.stateFolder.root };
  }
  probe.value.destroy();
  const file = cliTokenFile(platform.stateFolder);
  const token = await readCliToken(file, signal);
  if (token === undefined) {
    return { ok: false, reason: "no_sign_in", file };
  }
  const client = createProtocolClient({
    operations,
    openSocket: () => ipcWebSocket(endpoint.address),
    client: { kind: "cli", version: host.version },
    credential: { token },
    clock: host.clock,
    random: host.random,
    logger: createFileLogger({
      file: { append: () => undefined, close: async () => Promise.resolve() },
      level: "error",
      clock: host.clock,
      subsystem: "cli",
    }),
    limits: { reconnect: oneShotReconnect },
  });
  try {
    await client.connect(signal);
    return { ok: true, client };
  } catch (error) {
    client.close();
    return failureOf(error);
  }
}

/** Prints why the CLI could not reach the engine, and answers the exit code 1. */
function reportUnreachable(
  output: CliOutput,
  failure: Exclude<EngineConnection, { readonly ok: true }>,
): ExitCode {
  switch (failure.reason) {
    case "not_running":
      output.fail({
        code: "engine.not_running",
        key: "connect.notRunning",
        values: { folder: failure.folder },
      });
      break;
    case "no_sign_in":
      output.fail({
        code: "cli.no_sign_in",
        key: "connect.noSignIn",
        values: { file: failure.file },
      });
      break;
    case "refused":
      output.fail({ code: failure.code, key: "connect.refused", values: { code: failure.code } });
      break;
    case "failed":
      output.fail({ code: failure.code, key: "connect.failed", values: { code: failure.code } });
      break;
  }
  return 1;
}

// Codes a call meets when its connection's sign-in ends; the CLI asks for a new start for these.
const signInCodes: ReadonlySet<string> = new Set([
  "auth.required",
  "auth.invalid",
  "auth.expired",
  "auth.revoked",
  "auth.origin",
]);
const callCodes: ReadonlySet<string> = new Set(
  protocolErrorCodes.filter((code) => !signInCodes.has(code)),
);
// The engine refused on a rule the owner can change, so the command exits 2 (ENGINEERING 24.5).
const policyCodes: ReadonlySet<ProtocolErrorCode> = new Set([
  "auth.scope",
  "auth.local_only",
  "agent.frozen",
  "agent.paper_only",
  "agent.disclaimer",
  "wallet.unfunded",
  "limit.needs_admin",
  "limit.over_ceiling",
]);

function isCallCode(code: string): code is ProtocolErrorCode {
  return callCodes.has(code);
}

/**
 * Prints why a call failed and answers the exit code: a protocol code the engine refused the call
 * with gets its message from the i18n `error` area, and exits 2 when a rule refused it; a lost
 * connection or a sign-in that ended prints why the CLI could not reach the engine.
 */
function reportCallFailure(output: CliOutput, error: ErrorOptions["cause"]): ExitCode {
  const code = error instanceof BinferenceError ? error.code : "unexpected";
  if (!isCallCode(code)) {
    return reportUnreachable(output, failureOf(error));
  }
  output.refuse(code);
  return policyCodes.has(code) ? 2 : 1;
}

/**
 * Runs one call of a command against the engine: connects, calls, closes. Within 15 seconds, by
 * the host's clock. Prints why when the engine cannot be reached or the call fails.
 */
export async function withEngine(
  host: CliHost,
  output: CliOutput,
  use: (client: ProtocolClient, signal: AbortSignal) => Promise<ExitCode>,
): Promise<ExitCode> {
  const deadline = createDeadline({
    clock: host.clock,
    signal: new AbortController().signal,
    timeoutMs: commandBudgetMs,
  });
  try {
    const connection = await connectEngine(host, deadline.signal);
    if (!connection.ok) {
      return reportUnreachable(output, connection);
    }
    try {
      return await use(connection.client, deadline.signal);
    } catch (error) {
      return reportCallFailure(output, error);
    } finally {
      connection.client.close();
    }
  } finally {
    deadline.clear();
  }
}
