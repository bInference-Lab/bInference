import { spawnSync } from "node:child_process";
import process from "node:process";

/** How a command ended and everything it printed. */
export interface CommandResult {
  readonly status: number;
  readonly output: string;
}

/** Where and how {@link runCommand} runs a command. */
export interface CommandOptions {
  readonly cwd: string;
  readonly input?: string;
  readonly env?: Readonly<Record<string, string>>;
}

const scriptFile = /\.[cm]?js$/;

// pnpm sets npm_execpath to its own entry: a JS file or a native binary, depending on the
// install. Spawning it directly avoids a shell, which Windows would need for pnpm.cmd.
function pnpmCommand(): readonly string[] {
  const entry = process.env["npm_execpath"];
  if (entry === undefined || !/pnpm/.test(entry)) {
    throw new Error("Run this through pnpm (pnpm run <script>), so it can find pnpm.");
  }
  return scriptFile.test(entry) ? [process.execPath, entry] : [entry];
}

const tools: Readonly<Record<string, () => readonly string[]>> = {
  node: () => [process.execPath],
  pnpm: pnpmCommand,
  git: () => ["git"],
  opengrep: () => ["opengrep"],
};

function resolveCommand(command: readonly string[]): readonly string[] {
  const [tool = "", ...args] = command;
  const resolve = tools[tool];
  if (resolve === undefined) {
    throw new Error(`Unknown tool in a gate command: ${tool}`);
  }
  return [...resolve(), ...args];
}

/** Runs node, pnpm, git or opengrep without a shell and captures stdout and stderr together. */
export function runCommand(command: readonly string[], options: CommandOptions): CommandResult {
  const [file, ...args] = resolveCommand(command);
  if (file === undefined) {
    throw new Error("A gate command is empty.");
  }
  const result = spawnSync(file, args, {
    cwd: options.cwd,
    encoding: "utf8",
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", ...options.env },
  });
  if (result.error !== undefined) {
    return { status: -1, output: result.error.message };
  }
  return { status: result.status ?? -1, output: `${result.stdout}\n${result.stderr}` };
}
