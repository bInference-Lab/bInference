import type { RemoteProblem, RemoteView } from "@binference/protocol";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import { readRemoteView } from "../remote/read-remote-view.js";
import type { CheckFinding } from "./check-finding.js";
import type { CliMessage } from "./config-issue-messages.js";
import { connectEngine } from "./connect-engine.js";
import type { InstallCheck } from "./install-findings.js";

// The problems `remote.serve` fails, in the order its lines print.
const serveProblems: readonly (readonly [RemoteProblem, string])[] = [
  ["logged_out", "check.remote.loggedOut"],
  ["https_off", "check.remote.httpsOff"],
  ["funnel_denied", "check.remote.funnelDenied"],
  ["serve_changed", "check.remote.serveChanged"],
];

// The running engine's own view, read at the ports it started with; none while it does not run.
async function engineView(options: InstallCheck): Promise<RemoteView | undefined> {
  const connection = await connectEngine(options.host, options.signal);
  if (!connection.ok) {
    return undefined;
  }
  try {
    return await connection.client.call("remote/status", {}, { signal: options.signal });
  } catch {
    return undefined;
  } finally {
    connection.client.close();
  }
}

// Tailscale's state and problems, whatever the records say (decision 0341): the running engine's
// view, else a read through Tailscale's CLI here at the config's ports.
async function remoteOf(options: InstallCheck, config: BinferenceConfig): Promise<RemoteView> {
  const running = await engineView(options);
  if (running !== undefined) {
    return running;
  }
  const { host, signal } = options;
  const { remote, engine } = config;
  const ports = { engine: engine.port, webhooks: engine.webhookPort };
  const parts = { host, ports, record: () => remote, clock: host.clock };
  return readRemoteView(parts, { probeEngine: true, signal });
}

function serveFinding(view: RemoteView, config: BinferenceConfig): CheckFinding {
  const check = "remote.serve";
  if (!config.remote.mini && !config.remote.webhooks) {
    return { check, level: "ok" };
  }
  if (view.tailscale === "absent") {
    return { check, level: "fail", message: { key: "check.remote.missing", values: {} } };
  }
  const problems = view.problems ?? [];
  const lines: readonly CliMessage[] = serveProblems
    .filter(([problem]) => problems.includes(problem))
    .map(([, key]) => ({ key, values: {} }));
  const [message, ...more] = lines;
  if (message === undefined) {
    return { check, level: "ok" };
  }
  const details = {
    problems: problems.filter((problem) => serveProblems.some(([each]) => each === problem)),
  };
  return { check, level: "fail", message, more, details };
}

/**
 * The remote access checks (decision 0341): `remote.funnel` fails while `funnel` publishes
 * anything but binference's webhook handler, `remote.loopback` while the engine's port answers
 * beyond loopback, and `remote.serve` while binference's config records something Tailscale does
 * not hold as binference set it, or Tailscale is missing, signed out, or lacks HTTPS or Funnel.
 * Tailscale is read whatever the records say: through the running engine's `remote/status`, at
 * the ports it runs on, else through Tailscale's CLI here, at the config's ports. Without config,
 * each is skipped.
 */
export async function remoteFindings(
  options: InstallCheck,
  config: BinferenceConfig | undefined,
): Promise<readonly CheckFinding[]> {
  if (config === undefined) {
    const checks = ["remote.funnel", "remote.loopback", "remote.serve"];
    return checks.map((check): CheckFinding => ({ check, level: "skip" }));
  }
  const view = await remoteOf(options, config);
  const problems = view.problems ?? [];
  const failing = (check: string, problem: RemoteProblem, message: CliMessage): CheckFinding =>
    problems.includes(problem) ? { check, level: "fail", message } : { check, level: "ok" };
  const port = { port: config.engine.port };
  return [
    failing("remote.funnel", "funnel_extra", { key: "check.remote.funnelExtra", values: {} }),
    failing("remote.loopback", "engine_exposed", {
      key: "check.remote.engineExposed",
      values: port,
    }),
    serveFinding(view, config),
  ];
}
