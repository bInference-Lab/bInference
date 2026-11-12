import { randomBytes } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { BinferenceError } from "@binference/core";
import { createFakePrivy } from "@binference/custody-privy/testing";
import { type ProgramExit, runCommandWithin } from "@binference/platform";
import { fakeBotToken } from "@binference/telegram/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { newOwnerKey, rescueAddress } from "../e2e/init-fixtures.js";
import { testModelId, testModelKey } from "../e2e/model-fixtures.js";
import { createSystemClock } from "../runtime/system-clock.js";
import { createSystemRandom } from "../runtime/system-random.js";
import { edgeCertFolder, edgeHosts, modelPort } from "./image-names.js";

// The image smoke test (ENGINEERING section 24.5, decision 0292): it builds the image from this
// checkout, checks its user, health check and volume, sets an install up with `binference init
// --yes`, starts the engine, trades on paper, runs the agent's commands through the shell launcher
// (decision 0412), stops it with `docker stop`, then removes every container, volume, network and
// image it made. Privy, Telegram and the model provider are the e2e fakes and a scripted model,
// served over HTTPS by an edge container the test network names after them; the paper trade
// quotes on BNB Smart Chain's public RPCs and KyberSwap's API.

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const run = randomBytes(4).toString("hex");
const names = {
  image: `binference-smoke:${run}`,
  buildStage: `binference-smoke-build:${run}`,
  network: `bnf-smoke-${run}`,
  state: `bnf-smoke-state-${run}`,
  plugins: `bnf-smoke-plugins-${run}`,
  certs: `bnf-smoke-certs-${run}`,
  edge: `bnf-smoke-edge-${run}`,
  engine: `bnf-smoke-engine-${run}`,
  model: `bnf-smoke-model-${run}`,
};
const stateVolume = "/var/lib/binference/.binference";
const stateFolder = `${stateVolume}/state`;
const pluginsFolder = "/var/lib/binference-plugins";
const imageSocket = `${pluginsFolder}/run/launcher.sock`;
const buildMs = 900_000;
const commandMs = 120_000;
const privy = createFakePrivy({ clock: createSystemClock(), random: createSystemRandom() });
// The secrets travel as variables of the docker command, named by `-e NAME` without a value, so
// no command line shows them.
const secrets = {
  SMOKE_APP_SECRET: privy.appSecret.reveal(),
  SMOKE_BOT_TOKEN: fakeBotToken,
  SMOKE_MODEL_KEY: testModelKey,
};
const secretFlags = Object.keys(secrets).flatMap((name) => ["-e", name]);

async function docker(
  args: readonly string[],
  timeoutMs: number = commandMs,
): Promise<ProgramExit> {
  return runCommandWithin("docker", args, {
    signal: AbortSignal.timeout(timeoutMs),
    timeoutMs,
    env: secrets,
  });
}

async function dockerOk(args: readonly string[], timeoutMs?: number): Promise<string> {
  const exit = await docker(args, timeoutMs);
  if (exit.exitCode !== 0) {
    throw new BinferenceError({
      code: "image.docker_failed",
      message: `docker ${args[0] ?? ""} exited ${String(exit.exitCode)}: ${exit.stderr}`,
    });
  }
  return exit.stdout;
}

const inspectSchema = z.object({
  Size: z.number(),
  Config: z.object({
    User: z.string(),
    Healthcheck: z.object({ Test: z.array(z.string()) }),
    Volumes: z.record(z.string(), z.unknown()),
    Entrypoint: z.array(z.string()),
    Cmd: z.array(z.string()),
  }),
});

async function waitFor(check: () => Promise<boolean>, until: number): Promise<boolean> {
  if (await check()) {
    return true;
  }
  if (Date.now() >= until) {
    return false;
  }
  await wait(2_000);
  return waitFor(check, until);
}

// The engine container, as the server guide runs it, on the test's network and volumes, with a
// read-only root and the edge's certificate trusted: detached, the image entry as root under
// Docker's init (decision 0344), its model at the scripted model on its loopback; else the image's
// own command.
function engineRun(command: readonly string[], options: { readonly detach: boolean }) {
  const engine = [
    ["-d", "--name", names.engine, "--stop-timeout", "45", "--init", "--user", "root"],
    ["-e", `BINFERENCE_MODELS__PROVIDERS__OPENAI__BASE_URL=http://127.0.0.1:${modelPort}/v1`],
    ["--entrypoint", "binference-image"],
  ].flat();
  return [
    "run",
    ...(options.detach ? engine : ["--rm"]),
    "--network",
    names.network,
    "--read-only",
    "--tmpfs",
    "/tmp",
    "-v",
    `${names.state}:${stateVolume}`,
    "-v",
    `${names.plugins}:${pluginsFolder}`,
    "-v",
    `${names.certs}:${edgeCertFolder}:ro`,
    "-e",
    `NODE_EXTRA_CA_CERTS=${edgeCertFolder}/edge.pem`,
    ...secretFlags,
    names.image,
    ...command,
  ];
}

function initFlags(): readonly string[] {
  return [
    "init",
    "--yes",
    "--json",
    "--accept-disclaimer",
    ["--model-provider", "openai", "--model", testModelId],
    ["--model-key", '{ fromEnv: "SMOKE_MODEL_KEY" }'],
    ["--privy-app-id", privy.appId, "--privy-app-secret", '{ fromEnv: "SMOKE_APP_SECRET" }'],
    ["--bot-token", '{ fromEnv: "SMOKE_BOT_TOKEN" }', "--rescue", rescueAddress],
    ["--owner-key-public", newOwnerKey().publicKey],
  ].flat();
}

async function startEdge(): Promise<void> {
  const aliases = edgeHosts.flatMap((host) => ["--network-alias", host]);
  const edge = ["node", "--conditions=@binference/source", "--import", "tsx"];
  await dockerOk([
    "run",
    "-d",
    "--name",
    names.edge,
    "--network",
    names.network,
    ...aliases,
    "-v",
    `${names.certs}:${edgeCertFolder}`,
    "-w",
    "/src",
    names.buildStage,
    ...edge,
    "packages/cli/src/image/image-edge.ts",
  ]);
  const listening = await waitFor(async () => {
    const logs = await docker(["logs", names.edge]);
    return logs.stdout.includes('"edge":"listening"');
  }, Date.now() + 60_000);
  expect(listening).toBe(true);
}

// The scripted model on the engine container's loopback, in a container of the build stage that
// shares the engine's network.
async function startModel(): Promise<void> {
  const tsx = ["node", "--conditions=@binference/source", "--import", "tsx"];
  await dockerOk(
    [
      ["run", "-d", "--name", names.model, "--network", `container:${names.engine}`],
      ["-w", "/src", names.buildStage, ...tsx, "packages/cli/src/image/image-model-server.ts"],
    ].flat(),
  );
  const listening = await waitFor(async () => {
    const logs = await docker(["logs", names.model]);
    return logs.stdout.includes('"model":"listening"');
  }, Date.now() + 60_000);
  expect(listening).toBe(true);
}

const healthSchema = z.object({
  state: z.string(),
  health: z.array(z.object({ signal: z.string(), state: z.string() })),
});

// The last line a `--json` command printed, parsed.
function lastJson(text: string): unknown {
  return JSON.parse(text.trim().split("\n").at(-1) ?? "null");
}

// Whether the engine answers ready with its agent runtime running, as `binference health` says.
async function engineReady(): Promise<boolean> {
  const exit = await docker(["exec", names.engine, "binference", "health", "--json"]);
  const health = exit.exitCode === 0 ? healthSchema.parse(lastJson(exit.stdout)) : undefined;
  const runtime = health?.health.find((item) => item.signal === "runtime");
  return health?.state === "ready" && runtime?.state === "ok";
}

async function imageConfig(): Promise<z.infer<typeof inspectSchema>> {
  const [image] = z
    .tuple([inspectSchema])
    .parse(JSON.parse(await dockerOk(["image", "inspect", names.image])));
  return image;
}

async function dockerHealth(): Promise<string> {
  const format = "{{.State.Health.Status}}";
  return (await dockerOk(["inspect", "--format", format, names.engine])).trim();
}

async function dockerSaysHealthy(): Promise<boolean> {
  return (await dockerHealth()) === "healthy";
}

// Runs one step of the driver in a container of the image, over the engine's IPC socket on the
// state volume: `paper`, `shell` or `ask`. A driver that fails fails the test with what it said.
async function drive(step: string): Promise<string> {
  const driver = fileURLToPath(new URL("./image-driver.ts", import.meta.url));
  const mounted = "/opt/binference/image-driver.ts";
  return dockerOk(
    [
      ["run", "--rm", "--read-only", "--network", "none"],
      ["-v", `${names.state}:${stateVolume}`, "-v", `${driver}:${mounted}:ro`],
      ["--entrypoint", "node", names.image, mounted, step],
    ].flat(),
    300_000,
  ).then((stdout) => stdout.trim());
}

const shellTurnsSchema = z.object({
  probed: z.string(),
  read: z.string(),
  appended: z.string(),
  background: z.string(),
});

const askedSchema = z.object({
  asked: z.boolean(),
  command: z.string().optional(),
  approved: z.string().optional(),
});

// Whether a command's output says that reading `path` was refused for want of permission.
function refused(output: string, path: string): boolean {
  return output.split("\n").some((line) => line.includes(path) && /Permission denied/u.test(line));
}

async function shellFinding(): Promise<unknown> {
  const checked = await docker(["exec", names.engine, "binference", "check", "--json"]);
  const { findings } = checkSchema.parse(lastJson(checked.stdout));
  return findings.find(({ check }) => check === "shell.wall");
}

// The agent's commands run as the shell user (decision 0412): they cannot read the engine's token,
// keys or database, the engine reads and changes what they write in the workspace and they change
// what the engine writes, and a command left running tells the agent when it ends.
async function checkShell(): Promise<void> {
  const shell = shellTurnsSchema.parse(lastJson(await drive("shell")));
  expect(shell.probed).toContain("binference-shell");
  const walled = ["auth/cli.token", "keys", "engine.sqlite"].map(
    (path) => `${stateFolder}/${path}`,
  );
  expect(walled.filter((path) => !refused(shell.probed, path))).toStrictEqual([]);
  const token = await dockerOk(["exec", names.engine, "cat", `${stateFolder}/auth/cli.token`]);
  expect(shell.probed).not.toContain(token.trim());
  expect(shell.read).toContain("made-by-42");
  expect(shell.appended).toMatch(/engine-wrote\s+shell-4/u);
  expect(shell.background).toContain("background-10");
  expect(await shellFinding()).toStrictEqual({ check: "shell.wall", level: "ok", wall: "os_user" });
}

// A command that asks first waits for the owner, who allows it once, and its result wakes the
// agent (decision 0409).
async function checkAskedCommand(): Promise<void> {
  const set = ["exec", names.engine, "binference", "config", "set", "shell.ask"];
  await dockerOk([...set, "always"]);
  const asked = askedSchema.parse(lastJson(await drive("ask")));
  await dockerOk([...set, "never"]);
  expect(asked).toMatchObject({ asked: true, command: "echo approved-$((3*3))" });
  expect(asked.approved).toContain("approved-9");
}

// Each process of the engine container: its user id and its command line, read from /proc.
const processesProgram = [
  'const fs = require("node:fs");',
  "const rows = fs.readdirSync('/proc').filter((name) => /^\\d+$/.test(name)).flatMap((pid) => {",
  "  try {",
  "    const uid = /Uid:\\s+(\\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'))[1];",
  "    const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\\0').join(' ').trim();",
  "    return [{ pid: Number(pid), uid: Number(uid), cmd }];",
  "  } catch { return []; }",
  "});",
  "process.stdout.write(JSON.stringify(rows));",
].join("\n");

const processesSchema = z.array(z.object({ pid: z.number(), uid: z.number(), cmd: z.string() }));

// The listing runs as the plugin user, so it never counts itself among root's processes.
async function processes(): Promise<z.infer<typeof processesSchema>> {
  const exec = ["exec", "-u", "binference-plugin", names.engine];
  const listed = await dockerOk([...exec, "node", "-e", processesProgram]);
  return processesSchema
    .parse(JSON.parse(listed))
    .filter(({ cmd }) => !cmd.includes(processesProgram.slice(0, 20)))
    .toSorted((left, right) => left.pid - right.pid);
}

// Plants a link to the state folder in the plugin user's own run folder and ends the launcher,
// as a plugin with native code could, so the image entry starts it again.
async function plantAndEndLauncher(): Promise<void> {
  const launcher = (await processes()).find(({ cmd }) => cmd.endsWith("plugin-launcher.mjs"));
  const asPlugin = ["exec", "-u", "binference-plugin", names.engine];
  await dockerOk([...asPlugin, "ln", "-s", stateFolder, `${pluginsFolder}/run/planted`]);
  const end = `process.kill(${String(launcher?.pid ?? 0)}, "SIGKILL")`;
  await dockerOk([...asPlugin, "node", "-e", end]);
}

// The engine's user asks the launcher to remove a plugin's data folder by its id, as
// `plugin remove` does (decision 0351), and answers what the launcher said.
const removeDataProgram = [
  'const socket = require("node:net").connect(process.argv[1]);',
  'let said = "";',
  "socket.on('data', (chunk) => { said += chunk; });",
  "socket.on('close', () => process.stdout.write(said));",
  'socket.write(JSON.stringify({ plugin: "old-feed", removeData: true }) + "\\n");',
].join("\n");

// A plugin's data folder the launcher's user wrote, which the engine's user cannot remove itself
// and the launcher removes when the engine names its id.
async function removeDataThroughLauncher(): Promise<readonly [number, string, number]> {
  const data = `${pluginsFolder}/data/old-feed`;
  const asPlugin = ["exec", "-u", "binference-plugin", names.engine];
  const asEngine = ["exec", "-u", "binference", names.engine];
  await dockerOk([...asPlugin, "sh", "-c", `mkdir -m 700 ${data} && echo {} > ${data}/notes.json`]);
  const byEngine = await docker([...asEngine, "rm", "-rf", data]);
  const said = await dockerOk([...asEngine, "node", "-e", removeDataProgram, imageSocket]);
  const left = await docker([...asPlugin, "test", "-e", data]);
  return [byEngine.exitCode, said, left.exitCode];
}

async function launcherRuns(): Promise<boolean> {
  const running = await processes();
  return running.some(({ uid, cmd }) => uid === 10_002 && cmd.endsWith("plugin-launcher.mjs"));
}

async function stateOwner(): Promise<string> {
  return (await dockerOk(["exec", names.engine, "stat", "-c", "%u %a", stateFolder])).trim();
}

const checkSchema = z.object({
  findings: z.array(z.object({ check: z.string() }).loose()),
});

async function sandboxFinding(): Promise<unknown> {
  const checked = await docker(["exec", names.engine, "binference", "check", "--json"]);
  const { findings } = checkSchema.parse(lastJson(checked.stdout));
  return findings.find(({ check }) => check === "plugins.sandbox");
}

async function removeAll(): Promise<void> {
  await docker(["rm", "--force", names.model, names.engine, names.edge]);
  await docker(["network", "rm", names.network]);
  await docker(["volume", "rm", names.state, names.plugins, names.certs]);
  await docker(["image", "rm", names.image, names.buildStage]);
}

describe("the Docker image", () => {
  beforeAll(async () => {
    await dockerOk(["build", "--tag", names.image, root], buildMs);
    await dockerOk(["build", "--target", "build", "--tag", names.buildStage, root], buildMs);
    await dockerOk(["network", "create", names.network]);
    await dockerOk(["volume", "create", names.state]);
    await dockerOk(["volume", "create", names.plugins]);
    await dockerOk(["volume", "create", names.certs]);
  }, 2 * buildMs);

  afterAll(async () => {
    await removeAll();
  });

  it("runs as its own user, checks health with binference health and keeps state in a volume", async () => {
    const image = await imageConfig();
    expect(image.Config).toMatchObject({
      User: "binference",
      Healthcheck: { Test: ["CMD", "binference", "health"] },
      Entrypoint: ["binference"],
      Cmd: ["start", "--foreground"],
    });
    expect(Object.keys(image.Config.Volumes).toSorted()).toEqual([pluginsFolder, stateVolume]);
    expect(image.Size).toBeLessThan(200 * 1024 * 1024);
    const id = await dockerOk(["run", "--rm", "--entrypoint", "id", names.image]);
    // The engine's user shares the shell user's group, which no other user holds (decision 0412).
    expect(id.trim()).toBe(
      "uid=10001(binference) gid=10001(binference) groups=10001(binference),10003(binference-shell)",
    );
    const pluginUser = await dockerOk([
      "run",
      "--rm",
      "--entrypoint",
      "id",
      names.image,
      "binference-plugin",
    ]);
    expect(pluginUser.trim()).toBe(
      "uid=10002(binference-plugin) gid=10002(binference-plugin) groups=10002(binference-plugin)",
    );
    const shellUser = await dockerOk([
      "run",
      "--rm",
      "--entrypoint",
      "id",
      names.image,
      "binference-shell",
    ]);
    expect(shellUser.trim()).toBe(
      "uid=10003(binference-shell) gid=10003(binference-shell) groups=10003(binference-shell)",
    );
  });

  it("says which folder it cannot write when the state volume is read-only", async () => {
    const exit = await docker([
      "run",
      "--rm",
      "-e",
      "LANG=en_US.UTF-8",
      "-v",
      `${names.state}:${stateVolume}:ro`,
      names.image,
    ]);
    expect(exit.exitCode).toBe(1);
    expect(`${exit.stdout}${exit.stderr}`).toContain(
      `binference cannot write to ${stateFolder}. The user binference runs as must own`,
    );
  });

  it("sets up without prompts, runs healthy, fills a paper trade, runs the agent's commands as their own user and stops on docker stop", async () => {
    await startEdge();
    const init = await dockerOk(engineRun(initFlags(), { detach: false }));
    expect(lastJson(init)).toMatchObject({
      state: "set_up",
      unlockMode: "file",
      disclaimer: "accepted",
    });

    await dockerOk(engineRun([], { detach: true }));
    const ready = await waitFor(engineReady, Date.now() + 120_000);
    const logs = await docker(["logs", names.engine]);
    expect(ready, `${logs.stdout}${logs.stderr}`).toBe(true);
    expect(await waitFor(dockerSaysHealthy, Date.now() + 90_000)).toBe(true);
    await startModel();

    expect(await drive("paper")).toBe(JSON.stringify({ mode: "paper", state: "paper_filled" }));

    // A plugin runs under the plugin user, through the launcher, and cannot signal the engine.
    expect(await sandboxFinding()).toStrictEqual({
      check: "plugins.sandbox",
      level: "ok",
      ownUser: true,
    });
    // As root run only Docker's init and the image entry; the launchers run as the plugin and the
    // shell users, the engine and its processes as binference.
    const running = await processes();
    const asRoot = running.filter(({ uid }) => uid === 0).map(({ cmd }) => cmd);
    expect(asRoot).toHaveLength(2);
    expect(asRoot[0]).toContain("docker-init");
    expect(asRoot[1]).toMatch(/node \/usr\/local\/bin\/binference-image$/);
    const asPlugin = running.filter(({ uid }) => uid === 10_002).map(({ cmd }) => cmd);
    expect(asPlugin).toStrictEqual([expect.stringMatching(/plugin-launcher\.mjs$/)]);
    const asShell = running.filter(({ uid }) => uid === 10_003).map(({ cmd }) => cmd);
    expect(asShell).toStrictEqual([expect.stringMatching(/shell-launcher\.mjs$/)]);
    expect(running.filter(({ uid }) => uid === 10_001).map(({ cmd }) => cmd)).toContainEqual(
      expect.stringMatching(/main\.mjs start --foreground$/),
    );
    // A command run as root in the container drops to binference first.
    const id = await dockerOk(["exec", names.engine, "binference", "health", "--json"]);
    expect(lastJson(id)).toMatchObject({ state: "ready" });

    // Root touches no path the plugin user can write: a planted link and an ended launcher leave
    // the state folder as it was, and the launcher comes back.
    await plantAndEndLauncher();
    expect(await waitFor(launcherRuns, Date.now() + 30_000)).toBe(true);
    expect(await stateOwner()).toBe("10001 700");
    expect(await sandboxFinding()).toMatchObject({ check: "plugins.sandbox", level: "ok" });

    // A removed plugin's data goes through the launcher: the engine's user cannot remove it.
    expect(await removeDataThroughLauncher()).toStrictEqual([1, "removed", 1]);

    await checkShell();
    await checkAskedCommand();

    const stopped = Date.now();
    await dockerOk(["stop", names.engine], 60_000);
    expect(Date.now() - stopped).toBeLessThan(45_000);
    const format = "{{.State.ExitCode}} {{.State.OOMKilled}}";
    expect((await dockerOk(["inspect", "--format", format, names.engine])).trim()).toBe("0 false");
    expect((await docker(["logs", names.engine])).stdout).toContain("binference stopped.");
  }, 600_000);
});
