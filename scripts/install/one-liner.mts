import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import process from "node:process";
import { readSystemFacts } from "@binference/platform";
import { type LoopbackFiles, startLoopbackFiles } from "@binference/platform/testing";

/**
 * Serves the files of `folder` by name at the root, as binference.io would serve the install
 * scripts, and the wrong bytes for any Node archive, as a mirror that lies would.
 */
export async function serveRelease(folder: string): Promise<LoopbackFiles> {
  return startLoopbackFiles((path) => {
    const file = join(folder, basename(path));
    if (path.startsWith("/v")) {
      return { body: new TextEncoder().encode("not node") };
    }
    return path === `/${basename(path)}` && existsSync(file)
      ? { body: readFileSync(file) }
      : undefined;
  });
}

/** How one run of the one-liner ended, its output joined, and where it put binference. */
export interface OneLinerRun {
  readonly status: number;
  readonly output: string;
  /** The launcher the script reported writing, if it got that far. */
  readonly command: string | undefined;
}

/** Whether a run has this Node on PATH, and the variables it adds to the scratch ones. */
export interface OneLinerSetting {
  readonly withNode: boolean;
  readonly env: Readonly<Record<string, string>>;
}

const windows = readSystemFacts().os === "win32";

// The OS's own folders, with no Node in them, so the script finds no Node unless a run adds one.
function systemPath(): readonly string[] {
  const root = process.env["SystemRoot"] ?? "C:\\Windows";
  const folders = windows
    ? [join(root, "System32"), root, join(root, "System32", "WindowsPowerShell", "v1.0")]
    : ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  const node = windows ? "node.exe" : "node";
  const holder = folders.find((folder) => existsSync(join(folder, node)));
  if (holder !== undefined) {
    throw new Error(`${holder} holds a Node, so the script would never install its own.`);
  }
  return folders;
}

// A home, a state folder and an npm prefix of the run's own, and only the variables the OS needs.
function scratchEnv(scratch: string, run: OneLinerSetting): Record<string, string> {
  const at = (name: string): string => {
    mkdirSync(join(scratch, name), { recursive: true });
    return join(scratch, name);
  };
  const path = [...(run.withNode ? [dirname(process.execPath)] : []), ...systemPath()];
  const shared = {
    PATH: path.join(windows ? ";" : ":"),
    BINFERENCE_HOME: at("state"),
    npm_config_cache: at("npm-cache"),
  };
  if (!windows) {
    return { ...shared, HOME: at("home"), TMPDIR: at("tmp"), LANG: "en_US.UTF-8" };
  }
  const system = [
    "SystemRoot",
    "SystemDrive",
    "windir",
    "ComSpec",
    "PATHEXT",
    "PROCESSOR_ARCHITECTURE",
  ];
  return {
    ...Object.fromEntries(system.map((name) => [name, process.env[name] ?? ""])),
    ...shared,
    USERPROFILE: at("home"),
    APPDATA: at(join("home", "AppData", "Roaming")),
    LOCALAPPDATA: at(join("home", "AppData", "Local")),
    TEMP: at("tmp"),
    TMP: at("tmp"),
  };
}

// The one-liner exactly as the install guide prints it, pointed at the loopback.
function oneLiner(base: string): readonly string[] {
  return windows
    ? [
        "powershell.exe",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `irm ${base}/install.ps1 | iex; exit $LASTEXITCODE`,
      ]
    : ["/bin/sh", "-c", `curl -fsSL ${base}/install.sh | sh`];
}

/**
 * Runs the one-liner in `scratch` with the given variables, with this Node on PATH or none. Its
 * own session on macOS and Linux, so no terminal reaches it, as under CI. Ends after 10 minutes.
 */
export async function runOneLiner(
  base: string,
  scratch: string,
  run: OneLinerSetting,
): Promise<OneLinerRun> {
  const [file = "", ...args] = oneLiner(base);
  const child = spawn(file, args, {
    cwd: scratch,
    env: { ...scratchEnv(scratch, run), ...run.env },
    detached: !windows,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 600_000,
  });
  const chunks: string[] = [];
  child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
  const output = chunks.join("");
  const command = /^binference is installed: (.+)$/m.exec(output)?.[1]?.trim();
  return { status: code ?? -1, output, command };
}

/**
 * What the installed launcher prints for `--version`, with a state folder inside the run's own
 * folder. A Windows launcher is a batch file, which only cmd runs, given the path as one quoted
 * argument.
 */
export function versionOf(command: string, scratch: string): string {
  const env = { ...process.env, BINFERENCE_HOME: join(scratch, "version-state") };
  const run = windows
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", `""${command}" --version"`], {
        encoding: "utf8",
        env,
        windowsVerbatimArguments: true,
      })
    : spawnSync(command, ["--version"], { encoding: "utf8", env });
  return run.stdout.trim();
}
