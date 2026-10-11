// The systemd user unit that runs a service in the owner's session on Linux.
import type { ServiceDefinition } from "../service/service-definition.js";

/** The file name of the service's unit, under the user's unit folder. */
export function systemdUnitName(name: string): string {
  return `binference-${name}.service`;
}

/** systemd expands `%` specifiers in most settings (systemd.unit(5)); `%%` is a literal `%`. */
function withoutSpecifiers(text: string): string {
  return text.replaceAll("%", "%%");
}

const execEscapes: Readonly<Record<string, string>> = {
  "\\": "\\\\",
  '"': '\\"',
  "%": "%%",
  $: "$$",
};

/**
 * One word of a command line in double quotes, as systemd.service(5) reads it: a backslash and a
 * double quote are escaped, `%%` is a literal `%` and `$$` a literal `$`, so systemd neither
 * splits the word nor expands specifiers or environment variables in it.
 */
function execWord(word: string): string {
  return `"${word.replaceAll(/[\\"%$]/g, (character) => execEscapes[character] ?? character)}"`;
}

/**
 * The unit of the service, for `systemctl --user`: started with the user's default target, run
 * again 10 seconds after an exit with an error, stopped with SIGTERM to the main process and
 * SIGKILL to all of it after the stop timeout (rounded up to whole seconds), with new files the
 * owner's alone, no core files, no input, and output and errors appended to the log file.
 */
export function renderSystemdUnit(definition: ServiceDefinition): string {
  const command = [definition.program, ...definition.args].map((word) => execWord(word));
  const log = `append:${withoutSpecifiers(definition.logFile)}`;
  const sections: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
    Unit: [["Description", withoutSpecifiers(definition.description)]],
    Service: [
      ["ExecStart", command.join(" ")],
      ["WorkingDirectory", withoutSpecifiers(definition.workingFolder)],
      ["Restart", "on-failure"],
      ["RestartSec", "10"],
      ["TimeoutStopSec", String(Math.ceil(definition.stopTimeoutMs / 1000))],
      ["KillMode", "mixed"],
      ["UMask", "0077"],
      ["LimitCORE", "0"],
      ["StandardInput", "null"],
      ["StandardOutput", log],
      ["StandardError", log],
    ],
    Install: [["WantedBy", "default.target"]],
  };
  return Object.entries(sections)
    .map(
      ([section, settings]) =>
        `[${section}]\n${settings.map(([key, value]) => `${key}=${value}\n`).join("")}`,
    )
    .join("\n");
}
