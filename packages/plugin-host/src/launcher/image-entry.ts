// oxlint-disable-next-line eslint/no-restricted-imports -- the image entry starts the image's two processes under their users
import { type ChildProcess, spawn } from "node:child_process";
import { constants } from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { imageLayout, launcherVariable } from "./image-layout.js";

// The image entry (decision 0344): the one process of the image that runs as root. It takes no
// argument, reads no input and opens, makes, changes or removes no path: it starts the engine as
// `binference` and the plugin launcher as `binference-plugin`, waits on both, and forwards the
// stop signal. It hands the engine the container's variables as they are, and the launcher none.

const engineMain = "/opt/binference/dist/main.mjs";
const engineHome = "/var/lib/binference";
const launcherMain = fileURLToPath(new URL("./plugin-launcher.mjs", import.meta.url));
const debugSwitch = "--disable-sigusr1";
// How long the launcher may take to stop once the engine has, and the wait before it starts
// again after it ended while the engine runs.
const launcherStopMs = 5_000;
const launcherRestartMs = 1_000;

let stopping = false;
let launcher: ChildProcess | undefined;

// A start that cannot go on is one English line on standard error, as a log line is.
function refuse(code: string, next: string): never {
  process.stderr.write(`${JSON.stringify({ fault: code, next })}\n`);
  process.exit(2);
}

function startLauncher(): void {
  const started = spawn(process.execPath, [debugSwitch, launcherMain], {
    ...imageLayout.pluginUser,
    cwd: imageLayout.pluginsRoot,
    env: {},
    stdio: ["ignore", "inherit", "inherit"],
  });
  launcher = started;
  // A launcher that fails to start or ends, while the engine runs, starts again: a plugin may end
  // it, and that stops only plugins.
  started.once("error", () => undefined);
  started.once("close", () => {
    launcher = undefined;
    if (!stopping) {
      setTimeout(startLauncher, launcherRestartMs);
    }
  });
}

function startEngine(): ChildProcess {
  return spawn(process.execPath, [debugSwitch, engineMain, "start", "--foreground"], {
    ...imageLayout.engineUser,
    cwd: engineHome,
    // The container's variables are the engine's.
    env: { ...process.env, HOME: engineHome, [launcherVariable]: imageLayout.socket },
    stdio: "inherit",
  });
}

// The exit code of a child that a signal ended, as a shell gives it.
function codeOf(code: number | null, signal: NodeJS.Signals | null): number {
  return code ?? 128 + (signal === null ? 0 : constants.signals[signal]);
}

// When the engine ends, so does the image: the launcher gets SIGTERM, then SIGKILL after 5
// seconds, and the entry exits with the engine's code.
function stopAfter(engine: ChildProcess): void {
  engine.once("error", () => process.exit(1));
  engine.once("exit", (code, signal) => {
    stopping = true;
    const exitCode = codeOf(code, signal);
    const running = launcher;
    if (running === undefined) {
      process.exit(exitCode);
    }
    running.once("close", () => process.exit(exitCode));
    running.kill("SIGTERM");
    setTimeout(() => running.kill("SIGKILL"), launcherStopMs).unref();
  });
}

if (process.getuid?.() !== 0) {
  refuse("image.not_root", "docker run --init --user root --entrypoint binference-image ...");
}
if (process.pid === 1) {
  refuse("image.no_init", "docker run --init --user root --entrypoint binference-image ...");
}
startLauncher();
const engine = startEngine();
stopAfter(engine);
for (const stopSignal of ["SIGTERM", "SIGINT"] as const) {
  process.on(stopSignal, () => engine.kill("SIGTERM"));
}
