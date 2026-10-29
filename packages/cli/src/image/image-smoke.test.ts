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
import { edgeCertFolder, edgeHosts } from "./image-names.js";

// The image smoke test (ENGINEERING section 24.5, decision 0292): it builds the image from this
// checkout, checks its user, health check and volume, sets an install up with `binference init
// --yes`, starts the engine, trades on paper, stops it with `docker stop`, then removes every
// container, volume, network and image it made. Privy, Telegram and the model provider are the
// e2e fakes, served over HTTPS by an edge container the test network names after them; the paper
// trade quotes on BNB Smart Chain's public RPCs and KyberSwap's API.

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const run = randomBytes(4).toString("hex");
const names = {
  image: `binference-smoke:${run}`,
  buildStage: `binference-smoke-build:${run}`,
  network: `bnf-smoke-${run}`,
  state: `bnf-smoke-state-${run}`,
  certs: `bnf-smoke-certs-${run}`,
  edge: `bnf-smoke-edge-${run}`,
  engine: `bnf-smoke-engine-${run}`,
};
const stateFolder = "/var/lib/binference/.binference";
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

// The engine container: the image's own command, on the test's network and state volume, with a
// read-only root and the edge's certificate trusted.
function engineRun(command: readonly string[], options: { readonly detach: boolean }) {
  return [
    "run",
    ...(options.detach ? ["-d", "--name", names.engine, "--stop-timeout", "45"] : ["--rm"]),
    "--network",
    names.network,
    "--read-only",
    "--tmpfs",
    "/tmp",
    "-v",
    `${names.state}:${stateFolder}`,
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

async function paperTrade(): Promise<string> {
  const driver = fileURLToPath(new URL("./image-paper-trade.ts", import.meta.url));
  const mounted = "/opt/binference/image-paper-trade.ts";
  const exit = await docker([
    "run",
    "--rm",
    "--read-only",
    "--network",
    "none",
    "-v",
    `${names.state}:${stateFolder}`,
    "-v",
    `${driver}:${mounted}:ro`,
    "--entrypoint",
    "node",
    names.image,
    mounted,
  ]);
  return exit.exitCode === 0 ? exit.stdout.trim() : exit.stderr;
}

async function removeAll(): Promise<void> {
  await docker(["rm", "--force", names.engine, names.edge]);
  await docker(["network", "rm", names.network]);
  await docker(["volume", "rm", names.state, names.certs]);
  await docker(["image", "rm", names.image, names.buildStage]);
}

describe("the Docker image", () => {
  beforeAll(async () => {
    await dockerOk(["build", "--tag", names.image, root], buildMs);
    await dockerOk(["build", "--target", "build", "--tag", names.buildStage, root], buildMs);
    await dockerOk(["network", "create", names.network]);
    await dockerOk(["volume", "create", names.state]);
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
    expect(Object.keys(image.Config.Volumes)).toEqual([stateFolder]);
    expect(image.Size).toBeLessThan(200 * 1024 * 1024);
    const id = await dockerOk(["run", "--rm", "--entrypoint", "id", names.image]);
    expect(id.trim()).toBe("uid=10001(binference) gid=10001(binference) groups=10001(binference)");
  });

  it("says which folder it cannot write when the state volume is read-only", async () => {
    const exit = await docker([
      "run",
      "--rm",
      "-e",
      "LANG=en_US.UTF-8",
      "-v",
      `${names.state}:${stateFolder}:ro`,
      names.image,
    ]);
    expect(exit.exitCode).toBe(1);
    expect(`${exit.stdout}${exit.stderr}`).toContain(
      `binference cannot write to ${stateFolder}. The user binference runs as must own`,
    );
  });

  it("sets up without prompts, runs healthy, fills a paper trade and stops on docker stop", async () => {
    await startEdge();
    const init = await dockerOk(engineRun(initFlags(), { detach: false }));
    expect(lastJson(init)).toMatchObject({
      state: "set_up",
      unlockMode: "file",
      disclaimer: "accepted",
    });

    await dockerOk(engineRun([], { detach: true }));
    expect(await waitFor(engineReady, Date.now() + 120_000)).toBe(true);
    expect(await waitFor(dockerSaysHealthy, Date.now() + 90_000)).toBe(true);

    expect(await paperTrade()).toBe(JSON.stringify({ mode: "paper", state: "paper_filled" }));

    const stopped = Date.now();
    await dockerOk(["stop", names.engine], 60_000);
    expect(Date.now() - stopped).toBeLessThan(45_000);
    const format = "{{.State.ExitCode}} {{.State.OOMKilled}}";
    expect((await dockerOk(["inspect", "--format", format, names.engine])).trim()).toBe("0 false");
    expect((await docker(["logs", names.engine])).stdout).toContain("binference stopped.");
  });
});
