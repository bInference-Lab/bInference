// oxlint-disable-next-line eslint/no-restricted-imports -- the image entry starts the image's three processes under their users
import { type ChildProcess, spawn } from "node:child_process";
import { constants } from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { imageLayout, launcherVariable } from "./image-layout.js";

// The image entry (decisions 0344 and 0412): the one process of the image that runs as root. It
// takes no argument, reads no input and opens, makes, changes or removes no path: it starts the
// engine as `binference`, the plugin launcher as `binference-plugin` and the shell launcher as
// `binference-shell`, waits on them, and forwards the stop signal. It hands the engine the
// container's variables as they are, and the launchers none.

const engineMain = "/opt/binference/dist/main.mjs";
const engineHome = "/var/lib/binference";
// util-linux's setpriv starts the engine with the groups /etc/group gives its user, the shell's
// among them, which Node's own start under another user clears.
const setpriv = "/usr/bin/setpriv";
const beside = (path: string): string => fileURLToPath(new URL(path, import.meta.url));
const debugSwitch = "--disable-sigusr1";
// The wait before a launcher that ended while the engine runs starts again.
const launcherRestartMs = 1_000;

/** One of the image's launchers: its program, its user, its folder and how long it may take to stop. */
interface Launcher {
  readonly main: string;
  readonly user: { readonly uid: number; readonly gid: number };
  readonly cwd: string;
  readonly stopMs: number;
}

const launchers: readonly Launcher[] = [
  {
    main: beside("./plugin-launcher.mjs"),
    user: imageLayout.pluginUser,
    cwd: imageLayout.pluginsRoot,
    stopMs: 5_000,
  },
  // The shell launcher stops each command gently, then by force after 5 seconds.
  { main: beside("./shell-launcher.mjs"), user: imageLayout.shellUser, cwd: "/", stopMs: 10_000 },
];

let stopping = false;
const running = new Map<Launcher, ChildProcess>();

// A start that cannot go on is one English line on standard error, as a log line is.
function refuse(code: string, next: string): never {
  process.stderr.write(`${JSON.stringify({ fault: code, next })}\n`);
  process.exit(2);
}

function startLauncher(launcher: Launcher): void {
  const started = spawn(process.execPath, [debugSwitch, launcher.main], {
    ...launcher.user,
    cwd: launcher.cwd,
    env: {},
    stdio: ["ignore", "inherit", "inherit"],
  });
  running.set(launcher, started);
  // A launcher that fails to start or ends, while the engine runs, starts again: a plugin or a
  // command may end it, and that stops only plugins or commands.
  started.once("error", () => undefined);
  started.once("close", () => {
    running.delete(launcher);
    setTimeout(() => {
      if (!stopping) {
        startLauncher(launcher);
      }
    }, launcherRestartMs);
  });
}

function startEngine(): ChildProcess {
  const { uid, gid } = imageLayout.engineUser;
  const user = [`--reuid=${String(uid)}`, `--regid=${String(gid)}`, "--init-groups", "--"];
  return spawn(
    setpriv,
    [...user, process.execPath, debugSwitch, engineMain, "start", "--foreground"],
    {
      cwd: engineHome,
      // The container's variables are the engine's.
      env: { ...process.env, HOME: engineHome, [launcherVariable]: imageLayout.socket },
      stdio: "inherit",
    },
  );
}

// The exit code of a child that a signal ended, as a shell gives it.
function codeOf(code: number | null, signal: NodeJS.Signals | null): number {
  return code ?? 128 + (signal === null ? 0 : constants.signals[signal]);
}

// Each launcher still running gets SIGTERM, then SIGKILL once its time to stop has passed.
async function stopLaunchers(): Promise<void> {
  const stops = [...running].map(
    async ([launcher, child]) =>
      new Promise<void>((resolve) => {
        child.once("close", () => resolve());
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), launcher.stopMs).unref();
      }),
  );
  await Promise.all(stops);
}

// When the engine ends, so does the image: the launchers stop, and the entry exits with the
// engine's code.
function stopAfter(engine: ChildProcess): void {
  engine.once("error", () => process.exit(1));
  engine.once("exit", (code, signal) => {
    stopping = true;
    const exitCode = codeOf(code, signal);
    stopLaunchers().then(
      () => process.exit(exitCode),
      () => process.exit(exitCode),
    );
  });
}

if (process.getuid?.() !== 0) {
  refuse("image.not_root", "docker run --init --user root --entrypoint binference-image ...");
}
if (process.pid === 1) {
  refuse("image.no_init", "docker run --init --user root --entrypoint binference-image ...");
}
// Every child starts with this file mode mask, so what the engine makes in the workspace stays
// writable to the shell's group, which no one but the engine's and the shell's users holds.
process.umask(0o002);
launchers.forEach(startLauncher);
const engine = startEngine();
stopAfter(engine);
for (const stopSignal of ["SIGTERM", "SIGINT"] as const) {
  process.on(stopSignal, () => engine.kill("SIGTERM"));
}
