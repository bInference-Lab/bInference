import { afterEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "../run-command.js";

// Starts Windows PowerShell, which can take more than 15 s inside the parallel `pnpm check`, so it
// runs in CI's OS job only.
// oxlint-disable-next-line node/no-process-env -- the switch for the real OS tests, read only here
const osTests = process.env["BINFERENCE_OS_TESTS"] === "1";

describe.runIf(osTests && process.platform === "win32")("windows powershell", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("starts without the module path it would inherit, so it builds its own", async () => {
    vi.stubEnv("PSModulePath", "C:\\binference-inherited\\Modules");
    const script = "[Console]::Out.WriteLine($env:PSModulePath)";
    const args = ["-NoProfile", "-NonInteractive", "-Command", script];

    const output = await runCommand("powershell.exe", args, AbortSignal.timeout(30_000));

    expect(output).not.toContain("binference-inherited");
    expect(output.toLowerCase()).toContain("\\windowspowershell\\v1.0\\modules");
  }, 60_000);
});
