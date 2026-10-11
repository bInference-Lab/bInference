// The scheduled task that runs a service at the owner's logon, in Task Scheduler's XML format.
import { escapeXml } from "../service/escape-xml.js";
import type { ServiceDefinition } from "../service/service-definition.js";

/** The name Task Scheduler lists the service's task under. */
export function scheduledTaskName(name: string): string {
  return `binference-${name}`;
}

// A space, tab, line feed, vertical tab or double quote splits or ends an unquoted argument.
const splitsArgument = /[ \t\n\v"]/;

/**
 * Quotes one argument so that a Windows program, which splits its command line by the Microsoft C
 * runtime's rules, reads it back unchanged. Inside quotes, backslashes count only before a double
 * quote: those are doubled and the quote escaped, and so are the backslashes before the closing
 * quote.
 */
export function quoteWindowsArgument(argument: string): string {
  if (argument !== "" && !splitsArgument.test(argument)) {
    return argument;
  }
  const body = argument
    .replaceAll(/(\\*)"/g, (_match, backslashes: string) => `${backslashes}${backslashes}\\"`)
    .replace(/(\\+)$/, "$1$1");
  return `"${body}"`;
}

/**
 * Task Scheduler's priority 4 starts the program with a normal process, I/O and memory priority;
 * its default, 7, is the below-normal priority of background work.
 */
const normalPriority = 4;
/** A failed task is started again after a minute, the shortest interval Task Scheduler takes. */
const restartInterval = "PT1M";
/** The most restarts the schema allows (`Count` is an unsigned byte). */
const maxRestarts = 255;

/** One element per line, indented by two spaces a level. */
function element(depth: number, name: string, text: string): string {
  return `${"  ".repeat(depth)}<${name}>${text}</${name}>`;
}

/**
 * One instance at a time, on battery too, ended on request, with no time limit, at a normal
 * priority, and started again after a failure.
 */
const settings = [
  "  <Settings>",
  element(2, "MultipleInstancesPolicy", "IgnoreNew"),
  element(2, "DisallowStartIfOnBatteries", "false"),
  element(2, "StopIfGoingOnBatteries", "false"),
  element(2, "AllowHardTerminate", "true"),
  element(2, "AllowStartOnDemand", "true"),
  element(2, "Enabled", "true"),
  element(2, "Hidden", "false"),
  element(2, "ExecutionTimeLimit", "PT0S"),
  element(2, "Priority", String(normalPriority)),
  "    <RestartOnFailure>",
  element(3, "Interval", restartInterval),
  element(3, "Count", String(maxRestarts)),
  "    </RestartOnFailure>",
  "  </Settings>",
];

/**
 * The XML of the service's scheduled task, for `schtasks /Create /XML`: started at the logon of
 * `ownerSid` with their interactive token and without elevation, so it runs only while they are
 * logged on, with the settings above. Lines end with CR LF, as in the files Task Scheduler writes.
 */
export function renderTaskXml(definition: ServiceDefinition, ownerSid: string): string {
  const command = escapeXml(quoteWindowsArgument(definition.program));
  const args = escapeXml(
    definition.args.map((argument) => quoteWindowsArgument(argument)).join(" "),
  );
  const owner = escapeXml(ownerSid);
  return [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    "  <RegistrationInfo>",
    element(2, "Description", escapeXml(definition.description)),
    "  </RegistrationInfo>",
    "  <Triggers>",
    "    <LogonTrigger>",
    element(3, "Enabled", "true"),
    element(3, "UserId", owner),
    "    </LogonTrigger>",
    "  </Triggers>",
    "  <Principals>",
    '    <Principal id="owner">',
    element(3, "UserId", owner),
    element(3, "LogonType", "InteractiveToken"),
    element(3, "RunLevel", "LeastPrivilege"),
    "    </Principal>",
    "  </Principals>",
    ...settings,
    '  <Actions Context="owner">',
    "    <Exec>",
    element(3, "Command", command),
    element(3, "Arguments", args),
    element(3, "WorkingDirectory", escapeXml(definition.workingFolder)),
    "    </Exec>",
    "  </Actions>",
    "</Task>",
    "",
  ].join("\r\n");
}
