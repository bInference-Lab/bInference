// Adapted from MIT-licensed code (the LaunchAgent policy keys); NOTICES.md holds its notice.
import { escapeXml } from "../service/escape-xml.js";
import type { ServiceDefinition } from "../service/service-definition.js";

/** The LaunchAgent label of a service, `io.binference.<name>`, and its plist's file name stem. */
export function launchdLabel(name: string): string {
  return `io.binference.${name}`;
}

const text = (value: string): string => `<string>${escapeXml(value)}</string>`;

// Core dumps stay off, since a dump of the engine could hold the Privy app secret.
const noCoreDumps = ["  <dict>", "    <key>Core</key>", "    <integer>0</integer>", "  </dict>"];

/**
 * Renders the LaunchAgent property list of a service. launchd starts it when it loads the plist,
 * which is at every login, restarts it after an exit with an error (not after a clean exit), sends
 * its output to the log file, and creates its files owner-only.
 */
export function renderLaunchdPlist(definition: ServiceDefinition): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  ${text(launchdLabel(definition.name))}`,
    "  <key>Comment</key>",
    `  ${text(definition.description)}`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    ...[definition.program, ...definition.args].map((argument) => `    ${text(argument)}`),
    "  </array>",
    "  <key>WorkingDirectory</key>",
    `  ${text(definition.workingFolder)}`,
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <dict>",
    "    <key>SuccessfulExit</key>",
    "    <false/>",
    "  </dict>",
    "  <key>ProcessType</key>",
    "  <string>Interactive</string>",
    "  <key>ThrottleInterval</key>",
    "  <integer>10</integer>",
    "  <key>ExitTimeOut</key>",
    `  <integer>${String(Math.ceil(definition.stopTimeoutMs / 1000))}</integer>`,
    "  <key>Umask</key>",
    "  <integer>63</integer>",
    "  <key>StandardInPath</key>",
    "  <string>/dev/null</string>",
    "  <key>StandardOutPath</key>",
    `  ${text(definition.logFile)}`,
    "  <key>StandardErrorPath</key>",
    `  ${text(definition.logFile)}`,
    "  <key>SoftResourceLimits</key>",
    ...noCoreDumps,
    "  <key>HardResourceLimits</key>",
    ...noCoreDumps,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}
