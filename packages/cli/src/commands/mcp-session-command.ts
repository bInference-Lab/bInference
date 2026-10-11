import { dirname } from "node:path";
import { BinferenceError } from "@binference/core";
import {
  ensurePrivateFolder,
  removePath,
  startTerminalProgram,
  type TerminalExit,
  writePrivateFile,
} from "@binference/platform";
import type { ProtocolId } from "@binference/protocol";
import { platformOf } from "../compose/engine-locations.js";
import { mcpClientNames, mcpTokenVariable } from "../compose/mcp-token.js";
import { type McpRegistration, mcpRegistration } from "../mcp-setup/mcp-registration.js";
import { type SessionLaunch, sessionLaunch } from "../mcp-setup/session-launch.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import type { McpSessionFlags } from "../program/mcp-flags.schema.js";
import { withEngine } from "./connect-engine.js";

/** One session's token, as the engine registered it, and how its client starts. */
interface Session {
  readonly flags: McpSessionFlags;
  readonly made: McpRegistration;
  readonly token: ProtocolId<"clientToken">;
  readonly expiresAt: number;
  readonly launch: SessionLaunch;
}

// The signals that end the session: each is passed to the client. A SIGINT reaches the client
// from the terminal itself, which decides; the session waits for it to exit.
const passedOn: readonly NodeJS.Signals[] = ["SIGTERM", "SIGHUP", "SIGBREAK"];
const leftToClient: readonly NodeJS.Signals[] = ["SIGINT"];
const ignore = (): void => undefined;

// Holds the stop signals while the client runs; the answer lets them go.
function holdSignals(run: CommandRun, stop: AbortController): () => void {
  const { signals } = run.host;
  const onStop = (): void => stop.abort();
  passedOn.forEach((name) => signals.on(name, onStop));
  leftToClient.forEach((name) => signals.on(name, ignore));
  return () => {
    passedOn.forEach((name) => signals.off(name, onStop));
    leftToClient.forEach((name) => signals.off(name, ignore));
  };
}

async function writeConfig(run: CommandRun, launch: SessionLaunch): Promise<void> {
  if (launch.config === undefined) {
    return;
  }
  const files = {
    permissions: platformOf(run.host).permissions,
    signal: AbortSignal.timeout(5_000),
  };
  await ensurePrivateFolder(dirname(launch.config.file), files);
  await writePrivateFile(
    launch.config.file,
    `${JSON.stringify(launch.config.json, null, 2)}\n`,
    files,
  );
}

// The client's environment: the CLI's own without `BINFERENCE_MCP_TOKEN` in any case, as Windows
// matches names, plus what the launch adds.
function clientEnvOf(
  run: CommandRun,
  launch: SessionLaunch,
): Readonly<Record<string, string | undefined>> {
  const kept = Object.entries(run.host.env).filter(
    ([name]) => name.toUpperCase() !== mcpTokenVariable,
  );
  return { ...Object.fromEntries(kept), ...launch.clientEnv };
}

// Runs the client to its end, the secret never in its arguments: in Claude Code's config file for
// binference's server alone, or in Codex's environment.
async function runClient(
  run: CommandRun,
  session: Session,
  stop: AbortSignal,
): Promise<TerminalExit> {
  const { output, formatter } = run;
  const { launch, flags } = session;
  await writeConfig(run, launch);
  const client = mcpClientNames[flags.client];
  output.say("mcpSession.started", { client, at: formatter.dateTime(session.expiresAt) });
  if (flags.client === "codex") {
    output.say("mcpSession.codexServers");
  }
  const program = await startTerminalProgram({
    file: launch.program,
    args: [...launch.args, ...flags.clientArgs],
    env: clientEnvOf(run, launch),
    signal: stop,
  });
  return program.exited;
}

// A client that is not on PATH is the person's to install; any other fault is the CLI's.
function reportClientFault(
  run: CommandRun,
  session: Session,
  error: ErrorOptions["cause"],
): ExitCode {
  if (!(error instanceof BinferenceError) || error.code !== "platform.command_failed") {
    throw error;
  }
  const values = { program: session.launch.program, client: mcpClientNames[session.flags.client] };
  run.output.fail({ code: "cli.no_mcp_client", key: "mcpSession.noClient", values });
  return 1;
}

async function revoke(run: CommandRun, session: Session): Promise<void> {
  const revoked = await withEngine(run.host, run.output, async (engine, signal) => {
    await engine.call("token/revoke", { token: session.token }, { signal });
    return 0;
  });
  const { flags, token, expiresAt } = session;
  run.output.json({ client: flags.client, token, expiresAt, revoked: revoked === 0 });
  const at = run.formatter.dateTime(expiresAt);
  run.output.say(revoked === 0 ? "mcpSession.revoked" : "mcpSession.revokeFailed", { at });
}

// The session's end, however it comes: the client exits, a stop signal, or a fault here.
async function runSession(run: CommandRun, session: Session): Promise<ExitCode> {
  const stop = new AbortController();
  const release = holdSignals(run, stop);
  try {
    const exit = await runClient(run, session, stop.signal);
    return exit.exitCode === 0 ? 0 : 1;
  } catch (error) {
    return reportClientFault(run, session, error);
  } finally {
    release();
    await revoke(run, session);
    if (session.launch.config !== undefined) {
      await removePath(session.launch.config.file, AbortSignal.timeout(5_000));
    }
  }
}

// What a client started by hand needs: the config, the variable to set, and when the token ends.
function printConfig(run: CommandRun, session: Session): ExitCode {
  const { output, formatter } = run;
  const { launch, made, flags } = session;
  const env = { [mcpTokenVariable]: made.secret };
  const loads =
    launch.config === undefined ? { args: [...launch.args] } : { config: launch.config.json };
  output.json({
    client: flags.client,
    token: session.token,
    expiresAt: session.expiresAt,
    env,
    ...loads,
  });
  const values = { variable: mcpTokenVariable, at: formatter.dateTime(session.expiresAt) };
  if (launch.config === undefined) {
    output.say("mcpSession.printCodex", values);
    output.line([launch.program, ...launch.args.map(quoted)].join(" "));
  } else {
    output.say("mcpSession.printClaude", values);
    output.line(JSON.stringify(launch.config.json, null, 2));
  }
  output.line(`${mcpTokenVariable}=${made.secret}`);
  return 0;
}

// One argument for a POSIX shell: in single quotes, each single quote closed, escaped and reopened.
function quoted(arg: string): string {
  return `'${arg.replaceAll("'", String.raw`'\''`)}'`;
}

/**
 * `binference mcp session --client <claude-code|codex>` (decision 0159): makes a token for one
 * session, which expires after `--ttl` (1 hour unless given, at most 24), registers its SHA-256,
 * and starts the client with binference's server loaded for this run alone, passing it the
 * arguments after `--`. The secret reaches that server through Claude Code's config file, never
 * Claude Code's environment, or through `BINFERENCE_MCP_TOKEN` in Codex's (decision 0165). When the client exits, on a stop signal
 * passed to it, or on a fault here, the token is revoked and Claude Code's config file removed.
 * `--print-config` starts nothing and leaves the token to its expiry.
 */
export async function runMcpSession(run: CommandRun, flags: McpSessionFlags): Promise<ExitCode> {
  const { host, output } = run;
  const expiresAt = host.clock.now() + flags.ttlMs;
  const made = mcpRegistration(host, `mcp-${flags.client}-session`, expiresAt);
  const registered: ProtocolId<"clientToken">[] = [];
  const code = await withEngine(host, output, async (engine, signal) => {
    registered.push((await engine.call("token/register", made.args, { signal })).token);
    return 0;
  });
  const [token] = registered;
  if (token === undefined) {
    return code;
  }
  const secret = flags.isPrintConfig ? undefined : made.secret;
  const launch = sessionLaunch(host, flags.client, secret);
  const session = { flags, made, token, expiresAt, launch };
  return flags.isPrintConfig ? printConfig(run, session) : runSession(run, session);
}
