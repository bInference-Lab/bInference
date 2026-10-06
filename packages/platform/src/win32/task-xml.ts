// Adapted from MIT-licensed code (the task settings and principal); NOTICES.md holds its notice.
import { escapeXml } from "../service/escape-xml.js";
import type { ServiceDefinition } from "../service/service-definition.js";

/** The scheduled task of a service, `binference-<name>`, in the root folder of Task Scheduler. */
export function scheduledTaskName(name: string): string {
  return `binference-${name}`;
}

/**
 * Quotes one argument the way Windows programs split their command line: in double quotes when it
 * holds a space, a tab or a quote, with each quote escaped and the backslashes before a quote or
 * the closing quote doubled.
 */
export function quoteWindowsArgument(argument: string): string {
  if (argument !== "" && !/[\s"]/.test(argument)) {
    return argument;
  }
  const escaped = argument
    .replace(/(\\*)"/g, (_match, slashes: string) => `${slashes}${slashes}\\"`)
    .replace(/(\\+)$/, (slashes: string) => `${slashes}${slashes}`);
  return `"${escaped}"`;
}

// The settings that keep a long-running task alive: no stop on battery, no time limit, a restart
// after a failure, and one instance at a time.
const settings = [
  "  <Settings>",
  "    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>",
  "    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>",
  "    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>",
  "    <AllowHardTerminate>true</AllowHardTerminate>",
  "    <StartWhenAvailable>false</StartWhenAvailable>",
  "    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>",
  "    <IdleSettings>",
  "      <StopOnIdleEnd>false</StopOnIdleEnd>",
  "      <RestartOnIdle>false</RestartOnIdle>",
  "    </IdleSettings>",
  "    <AllowStartOnDemand>true</AllowStartOnDemand>",
  "    <Enabled>true</Enabled>",
  "    <Hidden>false</Hidden>",
  "    <RunOnlyIfIdle>false</RunOnlyIfIdle>",
  "    <WakeToRun>false</WakeToRun>",
  "    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>",
  "    <RestartOnFailure>",
  "      <Interval>PT1M</Interval>",
  "      <Count>3</Count>",
  "    </RestartOnFailure>",
  "    <Priority>7</Priority>",
  "  </Settings>",
];

/**
 * Renders the Task Scheduler definition of a service for `schtasks /Create /XML`: it starts at
 * the owner's logon and runs with their interactive token, so only while they are logged on and
 * with their Credential Manager. `ownerSid` names the owner in both places.
 */
export function renderTaskXml(definition: ServiceDefinition, ownerSid: string): string {
  const owner = escapeXml(ownerSid);
  const args = definition.args.map(quoteWindowsArgument).join(" ");
  return [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    "  <RegistrationInfo>",
    `    <Description>${escapeXml(definition.description)}</Description>`,
    "  </RegistrationInfo>",
    "  <Triggers>",
    "    <LogonTrigger>",
    "      <Enabled>true</Enabled>",
    `      <UserId>${owner}</UserId>`,
    "    </LogonTrigger>",
    "  </Triggers>",
    "  <Principals>",
    '    <Principal id="Author">',
    `      <UserId>${owner}</UserId>`,
    "      <LogonType>InteractiveToken</LogonType>",
    "      <RunLevel>LeastPrivilege</RunLevel>",
    "    </Principal>",
    "  </Principals>",
    ...settings,
    '  <Actions Context="Author">',
    "    <Exec>",
    `      <Command>${escapeXml(quoteWindowsArgument(definition.program))}</Command>`,
    `      <Arguments>${escapeXml(args)}</Arguments>`,
    `      <WorkingDirectory>${escapeXml(definition.workingFolder)}</WorkingDirectory>`,
    "    </Exec>",
    "  </Actions>",
    "</Task>",
    "",
  ].join("\r\n");
}
