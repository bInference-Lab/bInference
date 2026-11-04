// oxlint-disable-next-line eslint/no-restricted-imports -- the machine runs the install script as a program of its own
import { spawn } from "node:child_process";
// oxlint-disable-next-line eslint/no-restricted-imports -- the machine's folders and stand-ins are a test's own files
import { existsSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { readSystemFacts } from "@binference/platform";
import { createTempFolder, writeStandInProgram } from "@binference/platform/testing";
import { z } from "zod";

/** How one run of the install script ended. */
interface InstallRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** A program a stand-in recorded: its name, its arguments and the variables it saw. */
interface RecordedCall {
  readonly program: "npm" | "binference" | "curl";
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
}

const callSchema = z.object({
  program: z.enum(["npm", "binference", "curl"]),
  args: z.array(z.string()),
  env: z.record(z.string(), z.string().optional()).optional(),
}) satisfies z.ZodType<RecordedCall>;

/**
 * A scratch machine for the install script: a home and a state folder of its own, a PATH of
 * system tools with no Node on it, and stand-ins that record each call: npm, the binference it
 * installs, and on demand a Node, curl, uname, sysctl or ldd.
 */
export interface InstallMachine {
  readonly home: string;
  /** The folder first on PATH, where stand-ins go. */
  readonly bin: string;
  /** Where the script keeps Node, the package and the launcher. */
  readonly data: string;
  /** The PATH each run gets unless a test names its own. */
  readonly path: string;
  /** Puts a Node of this version on PATH: it reports its own file and runs this Node. */
  useNode(version: string): Promise<void>;
  /** A pinned Node a run left before, for this machine's OS and CPU, in the data folder. */
  leavePinnedNode(version: string): Promise<string>;
  /** A program on PATH that runs `script`, an ES module, in place of the system's. */
  standIn(name: string, script: string): Promise<void>;
  run(args: readonly string[], env?: Readonly<Record<string, string>>): Promise<InstallRun>;
  calls(): readonly RecordedCall[];
  remove(): Promise<void>;
}

// The programs the script calls besides node and npm. Linked one by one, so no Node a system
// folder holds reaches the PATH.
const tools = [
  "cat",
  "chmod",
  "cut",
  "curl",
  "dirname",
  "grep",
  "head",
  "ldd",
  "ln",
  "mkdir",
  "mktemp",
  "mv",
  "openssl",
  "rm",
  "sed",
  "sh",
  "sha256sum",
  "shasum",
  "sysctl",
  "tar",
  "uname",
  "wget",
];
const systemFolders = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];

function linkTools(folder: string): void {
  mkdirSync(folder);
  for (const tool of tools) {
    const found = systemFolders.map((dir) => join(dir, tool)).find((file) => existsSync(file));
    if (found !== undefined) {
      symlinkSync(found, join(folder, tool));
    }
  }
}

function binferenceStandIn(log: string): string {
  return `#!/usr/bin/env -S node --disable-sigusr1
import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(log)}, JSON.stringify({
  program: "binference",
  args: process.argv.slice(2),
  env: { BINFERENCE_HOME: process.env.BINFERENCE_HOME, BINFERENCE_INIT_MODEL: process.env.BINFERENCE_INIT_MODEL, PATH: process.env.PATH },
}) + "\\n");
process.exit(Number(process.env.STAND_IN_INIT_EXIT ?? "0"));
`;
}

// npm as the script uses it: \`install\` lays a binference package with its entry into the
// prefix, as npm would.
function npmStandIn(log: string): string {
  return `import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ program: "npm", args }) + "\\n");
const prefix = args[args.indexOf("--prefix") + 1];
const folder = join(prefix, "lib", "node_modules", "binference");
mkdirSync(join(folder, "dist"), { recursive: true });
writeFileSync(join(folder, "package.json"), JSON.stringify({ bin: { binference: "./dist/main.mjs" } }));
writeFileSync(join(folder, "dist", "main.mjs"), ${JSON.stringify(binferenceStandIn(log))});
`;
}

// A Node that reports itself as \`self\` at \`version\` and runs everything else with this Node.
function nodeStandIn(self: string, version: string): string {
  return `import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
if (args[0] === "-p" && args[1].includes("process.execPath")) {
  console.log(${JSON.stringify(`${self}\n${version}`)});
  process.exit(0);
}
const ran = spawnSync(process.execPath, args, { stdio: "inherit" });
process.exit(ran.status ?? 1);
`;
}

// Its own session, so the script finds no terminal to hand binference init, as under CI.
function runScript(script: string, args: readonly string[], env: NodeJS.ProcessEnv) {
  return new Promise<InstallRun>((resolve, reject) => {
    const child = spawn("/bin/sh", [script, ...args], { env, detached: true, stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.stdin.end();
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

/** Makes a scratch machine in the OS's temporary folder; `remove` takes it away. */
export async function createInstallMachine(script: string): Promise<InstallMachine> {
  const folder = await createTempFolder("bf-install-");
  const at = (name: string): string => join(folder.path, name);
  for (const name of ["home", "state", "bin"]) {
    mkdirSync(at(name));
  }
  linkTools(at("tools"));
  const log = at("calls.jsonl");
  const data = join(at("home"), ".local", "share", "binference");
  const path = `${at("bin")}:${at("tools")}`;
  await writeStandInProgram(at("bin"), "npm", npmStandIn(log));
  return {
    home: at("home"),
    bin: at("bin"),
    data,
    path,
    useNode: async (version) =>
      writeStandInProgram(at("bin"), "node", nodeStandIn(join(at("bin"), "node"), version)),
    leavePinnedNode: async (version) => {
      const { os, cpu } = readSystemFacts();
      const node = join(data, "node", `node-v${version}-${os}-${cpu}`);
      const bin = join(node, "bin");
      mkdirSync(bin, { recursive: true });
      await writeStandInProgram(bin, "node", nodeStandIn(join(bin, "node"), version));
      await writeStandInProgram(bin, "npm", npmStandIn(log));
      return node;
    },
    standIn: async (name, code) => writeStandInProgram(at("bin"), name, code),
    run: async (args, env = {}) =>
      runScript(script, args, {
        HOME: at("home"),
        PATH: path,
        BINFERENCE_HOME: at("state"),
        TMPDIR: process.env["TMPDIR"] ?? "/tmp",
        ...env,
      }),
    calls: () =>
      existsSync(log)
        ? readFileSync(log, "utf8")
            .trim()
            .split("\n")
            .map((line) => callSchema.parse(JSON.parse(line)))
        : [],
    remove: async () => folder.remove(),
  };
}
