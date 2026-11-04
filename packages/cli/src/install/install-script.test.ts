// oxlint-disable-next-line eslint/no-restricted-imports -- the test reads the script and the scratch machine's folders
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type LoopbackFiles,
  standInProgramsRun,
  startLoopbackFiles,
} from "@binference/platform/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInstallMachine, type InstallMachine } from "./install-machine.js";

const script = join(import.meta.dirname, "..", "..", "..", "..", "install", "install.sh");
const scriptText = readFileSync(script, "utf8");
const pinnedVersion = /^node_version=(\S+)$/m.exec(scriptText)?.[1] ?? "";
const slow = { timeout: 30_000 };
const notNode = new TextEncoder().encode("not node");
const packageBytes = new TextEncoder().encode("a packed binference");

let machine: InstallMachine;
let server: LoopbackFiles;

// Every Node archive holds the wrong bytes; /binference.tgz is a package and /moved.tgz redirects.
beforeEach(async () => {
  machine = await createInstallMachine(script);
  server = await startLoopbackFiles((path) => {
    switch (path) {
      case "/binference.tgz":
        return { body: packageBytes };
      case "/moved.tgz":
        return { redirectTo: "/binference.tgz" };
      default:
        return path.startsWith(`/v${pinnedVersion}/`) ? { body: notNode } : undefined;
    }
  });
});

afterEach(async () => {
  await server.close();
  await machine.remove();
});

function npmInstalls(): readonly (readonly string[])[] {
  return machine
    .calls()
    .filter((call) => call.program === "npm")
    .map((call) => call.args);
}

function inits(): readonly (readonly string[])[] {
  return machine
    .calls()
    .filter((call) => call.program === "binference")
    .map((call) => call.args);
}

const launcher = (): string => join(machine.data, "bin", "binference");
const pathLine = (): string => `  export PATH="${join(machine.data, "bin")}:$PATH"`;

const recordedCurl = `import { appendFileSync } from "node:fs";
appendFileSync(process.env.STAND_IN_LOG, JSON.stringify({ program: "curl", args: process.argv.slice(2) }) + "\\n");
process.exit(22);
`;

function unameStandIn(system: string, cpu: string): string {
  return `console.log(process.argv[2] === "-m" ? ${JSON.stringify(cpu)} : ${JSON.stringify(system)});`;
}

describe.skipIf(!standInProgramsRun)("the macOS and Linux install script", () => {
  it(
    "stops at a Node archive whose SHA-256 is not the pin, before unpacking it",
    slow,
    async () => {
      const run = await machine.run([], { BINFERENCE_NODE_MIRROR: server.base });

      expect(run.status).toBe(1);
      expect(run.stderr).toContain("SHA-256");
      expect(run.stderr).toContain("nothing was installed");
      expect(server.requests()).toEqual([
        expect.stringMatching(
          new RegExp(
            `^/v${pinnedVersion}/node-v${pinnedVersion}-(darwin|linux)-(x64|arm64)\\.tar\\.gz$`,
          ),
        ),
      ]);
      expect(existsSync(join(machine.data, "node"))).toBe(false);
      expect(machine.calls()).toEqual([]);
    },
  );

  it("says why it stopped in Chinese when the locale is Chinese", slow, async () => {
    const run = await machine.run([], { BINFERENCE_NODE_MIRROR: server.base, LANG: "zh_CN.UTF-8" });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("SHA-256");
    expect(run.stderr).not.toContain("nothing was installed");
    expect(run.stderr).toMatch(/\p{Script=Han}/u);
    expect(run.stdout).toMatch(/\p{Script=Han}/u);
  });

  it("downloads Node from Node's own site unless a mirror is named", slow, async () => {
    await machine.standIn("curl", recordedCurl);

    const run = await machine.run([], { STAND_IN_LOG: join(machine.home, "..", "calls.jsonl") });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain(
      `could not be downloaded from https://nodejs.org/dist/v${pinnedVersion}/node-v${pinnedVersion}-`,
    );
  });

  it("refuses a Node mirror that is not https", slow, async () => {
    const run = await machine.run([], { BINFERENCE_NODE_MIRROR: "http://mirror.example/dist" });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("BINFERENCE_NODE_MIRROR must be an https:// address");
  });

  it("takes the arm64 Node for a shell under Rosetta on an Apple processor", slow, async () => {
    await machine.standIn("uname", unameStandIn("Darwin", "x86_64"));
    await machine.standIn("sysctl", 'console.log("1");');

    await machine.run([], { BINFERENCE_NODE_MIRROR: server.base });

    expect(server.requests()).toEqual([
      `/v${pinnedVersion}/node-v${pinnedVersion}-darwin-arm64.tar.gz`,
    ]);
  });

  it("sends a Linux on musl to its own packages for Node", slow, async () => {
    await machine.standIn("uname", unameStandIn("Linux", "x86_64"));
    await machine.standIn("ldd", 'console.error("musl libc (x86_64)"); process.exit(1);');

    const run = await machine.run([], { BINFERENCE_NODE_MIRROR: server.base });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("this Linux uses musl");
    expect(server.requests()).toEqual([]);
  });

  it("refuses a processor Node builds nothing for", slow, async () => {
    await machine.standIn("uname", unameStandIn("Linux", "riscv64"));

    const run = await machine.run([], { BINFERENCE_NODE_MIRROR: server.base });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("do not cover the riscv64 processor");
  });

  it("replaces a Node older than the floor binference needs", slow, async () => {
    await machine.useNode("26.0.1");

    const run = await machine.run([], { BINFERENCE_NODE_MIRROR: server.base });

    expect(run.status).toBe(1);
    expect(server.requests()).toHaveLength(1);
  });

  it(
    "keeps a Node 26 on PATH, installs into its own folder and writes the launcher",
    slow,
    async () => {
      await machine.useNode("26.10.0");

      const run = await machine.run(["--skip-init"], { BINFERENCE_NODE_MIRROR: server.base });

      expect(run.status).toBe(0);
      expect(server.requests()).toEqual([]);
      expect(run.stdout).toContain(`Node 26.10.0 is installed at ${join(machine.bin, "node")}`);
      expect(npmInstalls()).toEqual([
        [
          "install",
          "--global",
          "--prefix",
          join(machine.data, "npm"),
          "--no-fund",
          "--no-audit",
          "--no-update-notifier",
          "--loglevel=error",
          "binference@latest",
        ],
      ]);
      const entry = join(
        machine.data,
        "npm",
        "lib",
        "node_modules",
        "binference",
        "dist",
        "main.mjs",
      );
      expect(readFileSync(launcher(), "utf8")).toContain(
        `PATH='${machine.bin}':"$PATH"\nexport PATH\n` +
          `exec '${join(machine.bin, "node")}' --disable-sigusr1 '${entry}' "$@"`,
      );
      expect(readdirSync(join(machine.data, "bin"))).toEqual(["binference"]);
      expect(run.stdout).toContain(pathLine());
    },
  );

  it("reuses the pinned Node it installed before through its current link", slow, async () => {
    const folder = await machine.leavePinnedNode(pinnedVersion);

    const run = await machine.run(["--skip-init"], { BINFERENCE_NODE_MIRROR: server.base });

    expect(run.status).toBe(0);
    expect(server.requests()).toEqual([]);
    expect(run.stdout).toContain(`Node ${pinnedVersion} is already in ${folder}.`);
    const current = join(machine.data, "node", "current", "bin");
    expect(readFileSync(launcher(), "utf8")).toContain(
      `PATH='${current}':"$PATH"\nexport PATH\nexec '${join(current, "node")}' --disable-sigusr1`,
    );
    expect(run.stdout).toContain(pathLine());
  });

  it("prints no PATH line when the launcher's folder is on PATH already", slow, async () => {
    await machine.useNode("26.10.0");

    const run = await machine.run(["--skip-init"], {
      PATH: `${join(machine.data, "bin")}:${machine.path}`,
    });

    expect(run.status).toBe(0);
    expect(run.stdout).not.toContain("export PATH=");
  });

  it("installs from the beta channel by flag or variable", slow, async () => {
    await machine.useNode("26.10.0");

    await machine.run(["--beta", "--skip-init"]);
    await machine.run(["--skip-init"], { BINFERENCE_INSTALL_CHANNEL: "beta" });

    expect(npmInstalls().map((args) => args.at(-1))).toEqual([
      "binference@beta",
      "binference@beta",
    ]);
  });

  it("asks nothing without a terminal and names the next step", slow, async () => {
    await machine.useNode("26.10.0");

    const run = await machine.run([]);

    expect(run.status).toBe(0);
    expect(inits()).toEqual([]);
    expect(run.stdout).toContain("Run binference init in a terminal");
  });

  it(
    "runs init --yes through the launcher with the answers in BINFERENCE_INIT_*",
    slow,
    async () => {
      await machine.useNode("26.10.0");

      const run = await machine.run(["--yes"], { BINFERENCE_INIT_MODEL: "gpt-test" });

      expect(run.status).toBe(0);
      expect(inits()).toEqual([["init", "--yes"]]);
      const init = machine.calls().find((call) => call.program === "binference");
      // Its Node's folder comes first on binference's own PATH, so an update finds that npm.
      expect(init?.env).toEqual({
        BINFERENCE_HOME: join(machine.home, "..", "state"),
        BINFERENCE_INIT_MODEL: "gpt-test",
        PATH: `${machine.bin}:${machine.path}`,
      });
    },
  );

  it("refuses init answers on its command line", slow, async () => {
    const run = await machine.run(["--yes", "--", "--model-key", "sk-test"]);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Unknown flag --.");
    expect(run.stderr).toContain("never on the command line");
    expect(machine.calls()).toEqual([]);
  });

  it("ends with init's exit code and the command to run again when init stops", slow, async () => {
    await machine.useNode("26.10.0");

    const run = await machine.run([], { BINFERENCE_INSTALL_YES: "1", STAND_IN_INIT_EXIT: "3" });

    expect(run.status).toBe(3);
    expect(run.stderr).toContain("init stopped");
    expect(run.stderr).toContain("binference init");
  });

  it.each(["0", "yes", "true"])(
    "refuses BINFERENCE_INSTALL_YES=%s and asks for 1",
    slow,
    async (value) => {
      const run = await machine.run([], { BINFERENCE_INSTALL_YES: value });

      expect(run.status).toBe(1);
      expect(run.stderr).toContain(`BINFERENCE_INSTALL_YES is ${value}; set it to 1`);
    },
  );

  it("writes no shell startup file and nothing outside its data folder", slow, async () => {
    await machine.useNode("26.10.0");

    await machine.run(["--skip-init"]);

    expect(readdirSync(machine.home)).toEqual([".local"]);
    expect(readdirSync(join(machine.home, ".local"))).toEqual(["share"]);
  });

  it("refuses an unknown flag and points to --help", slow, async () => {
    const run = await machine.run(["--global"]);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Unknown flag --global. Run the installer with --help");
  });
});

describe.skipIf(!standInProgramsRun)("the install script's test-only package override", () => {
  const refused = [
    "http://127.0.0.1:80@evil.example/binference.tgz",
    "http://localhost:1@evil.example/binference.tgz",
    "http://127.0.0.1.evil.example:80/binference.tgz",
    "http://127.0.0.1/binference.tgz",
    "http://127.0.0.1:8x/binference.tgz",
    "http://127.0.0.1:80/binference.tgz?x=1",
    "http://127.0.0.1:80/binference.tgz#x",
    "http://[::1].evil.example:80/binference.tgz",
    "https://example.com/binference.tgz",
    "binference.tgz",
    "/no/such/binference.tgz",
  ];

  it.each(refused)("refuses %s before anything runs", slow, async (value) => {
    await machine.useNode("26.10.0");

    const run = await machine.run(["--skip-init"], { BINFERENCE_INSTALL_PACKAGE: value });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Unset it to install binference from npm");
    expect(machine.calls()).toEqual([]);
  });

  it("refuses a folder whose name ends in the tarball suffix", slow, async () => {
    await machine.useNode("26.10.0");
    const folder = join(machine.home, "folder.tgz");
    mkdirSync(folder);

    const run = await machine.run(["--skip-init"], { BINFERENCE_INSTALL_PACKAGE: folder });

    expect(run.status).toBe(1);
    expect(machine.calls()).toEqual([]);
  });

  it("downloads a loopback tarball itself and hands npm the file", slow, async () => {
    await machine.useNode("26.10.0");

    const run = await machine.run(["--skip-init"], {
      BINFERENCE_INSTALL_PACKAGE: `${server.base}/binference.tgz`,
    });

    expect(run.status).toBe(0);
    const spec = npmInstalls()[0]?.at(-1);
    expect(spec).toMatch(/\/binference\.tgz$/);
    expect(spec).not.toContain("http");
  });

  it("refuses a loopback address that redirects", slow, async () => {
    await machine.useNode("26.10.0");

    const run = await machine.run(["--skip-init"], {
      BINFERENCE_INSTALL_PACKAGE: `${server.base}/moved.tgz`,
    });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("did not answer 200 by itself");
    expect(npmInstalls()).toEqual([]);
  });

  it("installs an existing tarball by its full path", slow, async () => {
    await machine.useNode("26.10.0");
    const file = join(machine.home, "binference.tgz");
    writeFileSync(file, packageBytes);

    const run = await machine.run(["--skip-init"], { BINFERENCE_INSTALL_PACKAGE: file });

    expect(run.status).toBe(0);
    expect(npmInstalls()[0]?.at(-1)).toBe(file);
  });
});
