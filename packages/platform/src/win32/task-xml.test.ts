import { describe, expect, it } from "vitest";
import type { ServiceDefinition } from "../service/service-definition.js";
import { quoteWindowsArgument, renderTaskXml, scheduledTaskName } from "./task-xml.js";

const sid = "S-1-5-21-1004336348-1177238915-682003330-1001";

const engine: ServiceDefinition = {
  name: "engine",
  description: "binference engine & signer",
  program: "C:\\Program Files\\nodejs\\node.exe",
  args: ["D:\\binference\\my apps\\engine.mjs", 'a "quoted" <value>'],
  workingFolder: "D:\\binference\\state",
  logFile: "D:\\binference\\state\\logs\\service.log",
  stopTimeoutMs: 30_000,
};

describe("task xml", () => {
  it("names the task after the service", () => {
    expect(scheduledTaskName("engine")).toBe("binference-engine");
  });

  it.each([
    ["plain", "plain"],
    ["", '""'],
    ["two words", '"two words"'],
    ['say "hi"', '"say \\"hi\\""'],
    ["C:\\no\\spaces\\", "C:\\no\\spaces\\"],
    ["C:\\my apps\\", '"C:\\my apps\\\\"'],
    ['back\\"quote', '"back\\\\\\"quote"'],
    ["tab\there", '"tab\there"'],
  ])("quotes %j as %s for a Windows command line", (argument, quoted) => {
    expect(quoteWindowsArgument(argument)).toBe(quoted);
  });

  it("starts at the owner's logon with their interactive token, and quotes the command", () => {
    const xml = renderTaskXml(engine, sid);

    expect(xml).toContain(
      [
        "    <LogonTrigger>",
        "      <Enabled>true</Enabled>",
        `      <UserId>${sid}</UserId>`,
        "    </LogonTrigger>",
      ].join("\r\n"),
    );
    expect(xml).toContain(
      [
        `      <UserId>${sid}</UserId>`,
        "      <LogonType>InteractiveToken</LogonType>",
        "      <RunLevel>LeastPrivilege</RunLevel>",
      ].join("\r\n"),
    );
    expect(xml).toContain("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>");
    expect(xml).toContain("<Description>binference engine &amp; signer</Description>");
    expect(xml).toContain("<Command>&quot;C:\\Program Files\\nodejs\\node.exe&quot;</Command>");
    expect(xml).toContain(
      "<Arguments>&quot;D:\\binference\\my apps\\engine.mjs&quot; " +
        "&quot;a \\&quot;quoted\\&quot; &lt;value&gt;&quot;</Arguments>",
    );
    expect(xml.replaceAll("\r\n", "")).not.toContain("\n");
  });
});
