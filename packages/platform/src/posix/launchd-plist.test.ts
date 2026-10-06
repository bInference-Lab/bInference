import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runCommand } from "../run-command.js";
import type { ServiceDefinition } from "../service/service-definition.js";
import { renderLaunchdPlist } from "./launchd-plist.js";

const engine: ServiceDefinition = {
  name: "engine",
  description: "binference engine & signer",
  program: "/opt/binference/state/node/bin/node",
  args: ["/opt/binference/my apps/engine.mjs", 'a "quoted" <value>', "it's"],
  workingFolder: "/opt/binference/state",
  logFile: "/opt/binference/state/logs/service.log",
  stopTimeoutMs: 1500,
};

describe("launchd plist", () => {
  it("escapes every value and keeps the arguments in order", () => {
    const plist = renderLaunchdPlist(engine);

    expect(plist).toContain("<string>io.binference.engine</string>");
    expect(plist).toContain("<string>binference engine &amp; signer</string>");
    expect(plist).toContain(
      [
        "    <string>/opt/binference/state/node/bin/node</string>",
        "    <string>/opt/binference/my apps/engine.mjs</string>",
        "    <string>a &quot;quoted&quot; &lt;value&gt;</string>",
        "    <string>it&apos;s</string>",
      ].join("\n"),
    );
  });

  it("rounds the stop timeout up to whole seconds", () => {
    expect(renderLaunchdPlist(engine)).toContain("<key>ExitTimeOut</key>\n  <integer>2</integer>");
  });
});

// What plutil reads back from the plist, in JSON.
const readBack = z.looseObject({
  Label: z.string(),
  ProgramArguments: z.array(z.string()),
  RunAtLoad: z.boolean(),
  KeepAlive: z.strictObject({ SuccessfulExit: z.boolean() }),
  Umask: z.number(),
  StandardOutPath: z.string(),
  SoftResourceLimits: z.strictObject({ Core: z.number() }),
  HardResourceLimits: z.strictObject({ Core: z.number() }),
});

describe.runIf(process.platform === "darwin")("launchd plist on macOS", () => {
  it("is a property list that plutil reads back as written", async () => {
    const folder = await mkdtemp(join(tmpdir(), "bnf-"));
    const file = join(folder, "io.binference.engine.plist");
    await writeFile(file, renderLaunchdPlist(engine));
    const signal = AbortSignal.timeout(15_000);

    await expect(runCommand("plutil", ["-lint", file], signal)).resolves.toContain("OK");
    const json = await runCommand("plutil", ["-convert", "json", "-o", "-", file], signal);
    await rm(folder, { recursive: true });

    expect(readBack.parse(JSON.parse(json))).toMatchObject({
      Label: "io.binference.engine",
      ProgramArguments: [engine.program, ...engine.args],
      RunAtLoad: true,
      KeepAlive: { SuccessfulExit: false },
      Umask: 0o077,
      StandardOutPath: engine.logFile,
      SoftResourceLimits: { Core: 0 },
      HardResourceLimits: { Core: 0 },
    });
  });
});
