// Adapted from MIT-licensed code (the unit policy lines); NOTICES.md holds its notice.
import type { ServiceDefinition } from "../service/service-definition.js";

/** The unit of a service in the owner's systemd user manager: `binference-<name>.service`. */
export function systemdUnitName(name: string): string {
  return `binference-${name}.service`;
}

// systemd expands `%` specifiers in every value below, so a literal `%` is written twice.
const literal = (value: string): string => value.replaceAll("%", "%%");

// Each word of a command line goes in double quotes; inside them a backslash and a quote are
// escaped, and `$` is doubled so systemd expands no variable.
function quoteWord(word: string): string {
  const escaped = literal(word)
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("$", () => "$$");
  return `"${escaped}"`;
}

/**
 * Renders the systemd user unit of a service. `WantedBy=default.target` starts it when the owner's
 * user manager starts, at login; it restarts after an exit with an error, appends its output to the
 * log file, creates its files owner-only and never dumps core, since a dump of the engine could
 * hold the Privy app secret.
 */
export function renderSystemdUnit(definition: ServiceDefinition): string {
  const commandLine = [definition.program, ...definition.args].map(quoteWord).join(" ");
  const log = literal(definition.logFile);
  return [
    "[Unit]",
    `Description=${literal(definition.description)}`,
    "",
    "[Service]",
    `ExecStart=${commandLine}`,
    `WorkingDirectory=${literal(definition.workingFolder)}`,
    "Restart=on-failure",
    "RestartSec=10",
    `TimeoutStopSec=${String(Math.ceil(definition.stopTimeoutMs / 1000))}`,
    "KillMode=mixed",
    "UMask=0077",
    "LimitCORE=0",
    "StandardInput=null",
    `StandardOutput=append:${log}`,
    `StandardError=append:${log}`,
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}
