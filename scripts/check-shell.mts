import process from "node:process";
import { runCommand } from "./run-command.mjs";

// Runs shellcheck on the macOS and Linux install script (ENGINEERING.md section 18). A machine
// without shellcheck skips it with a note; CI passes --require and a pinned shellcheck, so there a
// missing one fails.
const script = "install/install.sh";
const required = process.argv.includes("--require");
const root = process.cwd();

const version = runCommand(["shellcheck", "--version"], { cwd: root });
if (version.status !== 0) {
  console.log(
    required
      ? "check:shell: shellcheck is not installed, and --require asks for it."
      : "check:shell: shellcheck is not installed here, so install/install.sh was not checked.",
  );
  process.exitCode = required ? 1 : 0;
} else {
  const result = runCommand(["shellcheck", "--shell=sh", script], { cwd: root });
  if (result.status === 0) {
    console.log(`check:shell: ${script} passes shellcheck.`);
  } else {
    console.error(`check:shell: ${script} fails shellcheck:\n${result.output.trim()}`);
    process.exitCode = 1;
  }
}
