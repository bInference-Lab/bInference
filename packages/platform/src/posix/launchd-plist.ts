// The LaunchAgent property list that runs a service in the owner's macOS session.
import { escapeXml } from "../service/escape-xml.js";
import type { ServiceDefinition } from "../service/service-definition.js";

/** The launchd label of the service, which also names its plist file. */
export function launchdLabel(name: string): string {
  return `io.binference.${name}`;
}

/** A property list value: text, a whole number, a boolean, an array or a dictionary. */
type PlistValue =
  | string
  | number
  | boolean
  | readonly PlistValue[]
  | { readonly [key: string]: PlistValue };

function isList(value: PlistValue): value is readonly PlistValue[] {
  return Array.isArray(value);
}

function indent(depth: number): string {
  return "  ".repeat(depth);
}

/** The lines of one value, starting at `depth`. Numbers are written as integers. */
function plistLines(value: PlistValue, depth: number): string[] {
  const pad = indent(depth);
  if (typeof value === "string") {
    return [`${pad}<string>${escapeXml(value)}</string>`];
  }
  if (typeof value === "number") {
    return [`${pad}<integer>${String(Math.trunc(value))}</integer>`];
  }
  if (typeof value === "boolean") {
    return [`${pad}<${String(value)}/>`];
  }
  if (isList(value)) {
    return [
      `${pad}<array>`,
      ...value.flatMap((item) => plistLines(item, depth + 1)),
      `${pad}</array>`,
    ];
  }
  const lines = [`${pad}<dict>`];
  for (const [key, item] of Object.entries(value)) {
    lines.push(`${indent(depth + 1)}<key>${escapeXml(key)}</key>`, ...plistLines(item, depth + 1));
  }
  lines.push(`${pad}</dict>`);
  return lines;
}

/** No core files: a crash dump of the engine could hold key material. */
const noCoreFiles = { Core: 0 };

/**
 * The plist of the service's LaunchAgent (launchd.plist(5)). launchd starts it when the agent is
 * loaded at login and starts it again whenever it exits with an error, at most once every 10
 * seconds; a stop gets SIGTERM and, after the stop timeout rounded up to whole seconds, SIGKILL.
 * New files are the owner's alone, output and errors are appended to the log file, and no core
 * file is written. launchd has no key for a description, so it stays as a comment key that
 * launchd ignores and a person reading the file sees.
 */
export function renderLaunchdPlist(definition: ServiceDefinition): string {
  const agent: PlistValue = {
    Label: launchdLabel(definition.name),
    Comment: definition.description,
    ProgramArguments: [definition.program, ...definition.args],
    WorkingDirectory: definition.workingFolder,
    RunAtLoad: true,
    KeepAlive: { SuccessfulExit: false },
    ThrottleInterval: 10,
    ExitTimeOut: Math.ceil(definition.stopTimeoutMs / 1000),
    // Property lists have no octal: 63 is the umask 077.
    Umask: 0o077,
    StandardOutPath: definition.logFile,
    StandardErrorPath: definition.logFile,
    SoftResourceLimits: noCoreFiles,
    HardResourceLimits: noCoreFiles,
  };
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    ...plistLines(agent, 0),
    "</plist>",
    "",
  ];
  return lines.join("\n");
}
