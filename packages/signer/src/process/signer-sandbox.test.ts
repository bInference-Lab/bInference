// oxlint-disable-next-line eslint/no-restricted-imports -- this test starts the built signer as the engine will; execa is outside the signer's graph row
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createPublicKey, verify } from "node:crypto";
// oxlint-disable-next-line eslint/no-restricted-imports -- this test makes a build folder of its own and removes it
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "tsdown";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatAgentKey } from "../agent-key/agent-key-text.js";
import { createP256KeyPair } from "../keys/p256-key-pair.js";
import { authorizationPayload } from "../privy/authorization-signature.js";
import { formatSignerRequest } from "../requests/signer-message.schema.js";
import { authorizeFixture, fixtureSettings } from "../testing/sign-fixtures.js";
import { readLines } from "./read-lines.js";
import { signerNodeArguments } from "./signer-node-arguments.js";

const sourceEntry = fileURLToPath(new URL("signer-process.ts", import.meta.url));
const tsconfig = fileURLToPath(new URL("../../tsconfig.json", import.meta.url));
// Builds go to a folder of their own in the package's dist, which every tool and git ignore. Node
// lets a process read its own program only by a path with no link on the way, and dist is a real
// folder wherever the package is, unlike node_modules in a mutation sandbox.
const distFolder = fileURLToPath(new URL("../../dist", import.meta.url));
let buildFolder = "";

// Runs inside the signer, before its own code. It reads its own program while it still may, then,
// once the signer has started and dropped every permission, tries every kind of file, socket,
// process and worker, and writes what each attempt met to standard error.
const probe = `
const probeFs = await import("node:fs");
const readAtStart = (() => { try { probeFs.readFileSync(import.meta.filename); return "allowed"; } catch (error) { return error.code; } })();
setImmediate(async () => {
  const net = await import("node:net");
  const outcome = async (attempt) => {
    try {
      const handle = await attempt();
      if (typeof handle?.once !== "function") {
        return "allowed";
      }
      return await new Promise((resolve) => {
        handle.once("error", (error) => resolve(error.code));
        for (const event of ["connect", "listening", "spawn", "online"]) {
          handle.once(event, () => resolve("allowed"));
        }
      });
    } catch (error) {
      return error.code;
    }
  };
  const pipe = process.platform === "win32" ? "\\\\\\\\.\\\\pipe\\\\binference-probe" : "/tmp/binference-probe.sock";
  const results = {
    readAtStart,
    readOwnProgram: await outcome(() => probeFs.readFileSync(import.meta.filename)),
    writeFile: await outcome(() => probeFs.writeFileSync(import.meta.filename + ".written", "x")),
    connectTcp: await outcome(() => net.connect(9, "127.0.0.1")),
    connectPipe: await outcome(() => net.connect(pipe)),
    listen: await outcome(() => net.createServer().listen(0)),
    startProcess: await outcome(async () => (await import("node:child_process")).spawn(process.execPath, ["--version"])),
    startWorker: await outcome(async () => new (await import("node:worker_threads")).Worker("0", { eval: true })),
  };
  process.stderr.write(JSON.stringify(results) + "\\n");
});
`;

let signerBundle = "";
let probedBundle = "";

async function bundle(name: string, banner: string): Promise<string> {
  const outDir = join(buildFolder, name);
  await build({
    config: false,
    entry: { "signer-process": sourceEntry },
    outDir,
    format: "esm",
    platform: "node",
    dts: false,
    clean: true,
    logLevel: "silent",
    tsconfig,
    banner,
    deps: { alwaysBundle: [/./], onlyBundle: false },
    inputOptions: { resolve: { conditionNames: ["@binference/source", "import", "default"] } },
  });
  return join(outDir, "signer-process.mjs");
}

beforeAll(async () => {
  await mkdir(distFolder, { recursive: true });
  buildFolder = await mkdtemp(join(distFolder, "sandbox-"));
  signerBundle = await bundle("plain", "");
  probedBundle = await bundle("probed", probe);
}, 60_000);

afterAll(async () => {
  await rm(buildFolder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}, 60_000);

interface Run {
  readonly child: ChildProcessWithoutNullStreams;
  readonly lines: AsyncGenerator<Buffer>;
}

function start(args: readonly string[]): Run {
  const child = spawn(process.execPath, args, {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  return { child, lines: readLines(child.stdout) };
}

async function nextLine(run: Run): Promise<string> {
  const next = await run.lines.next();
  return next.done === true ? "" : next.value.toString("utf8");
}

async function nextAnswer(run: Run): Promise<Readonly<Record<string, string | boolean | null>>> {
  return JSON.parse(await nextLine(run)) as Readonly<Record<string, string | boolean | null>>;
}

// The probe's report: the first line on the signer's standard error.
async function probeReport(run: Run): Promise<Readonly<Record<string, string>>> {
  const first = await readLines(run.child.stderr).next();
  return JSON.parse(first.done === true ? "{}" : first.value.toString("utf8")) as Readonly<
    Record<string, string>
  >;
}

async function exitCode(run: Run): Promise<number | null> {
  return run.child.exitCode ?? new Promise((resolve) => run.child.once("exit", resolve));
}

const agentKey = createP256KeyPair();

function begin(run: Run): void {
  run.child.stdin.write(
    `${JSON.stringify(fixtureSettings)}\n${formatAgentKey(agentKey).reveal()}\n`,
  );
}

describe("the signer process under Node's permission model", () => {
  it("answers publicKey, signs and refuses an unknown request", { timeout: 60_000 }, async () => {
    const run = start(signerNodeArguments(signerBundle));
    begin(run);
    const input = authorizeFixture();
    run.child.stdin.write(`${JSON.stringify({ id: "a", kind: "publicKey" })}\n`);
    run.child.stdin.write(`${formatSignerRequest({ id: "b", kind: "authorize", ...input })}\n`);
    run.child.stdin.write(`${JSON.stringify({ id: "c", kind: "exportKey" })}\n`);
    const answers = [await nextAnswer(run), await nextAnswer(run), await nextAnswer(run)];
    const { signature } = answers[1] as { readonly signature: string };
    run.child.stdin.end();

    expect(answers[0]).toStrictEqual({ id: "a", ok: true, publicKey: agentKey.publicKey });
    expect(answers[2]).toStrictEqual({ id: "c", ok: false, refused: "unknown_request" });
    expect(
      verify(
        "sha256",
        authorizationPayload(input.request),
        createPublicKey(agentKey.privateKey),
        Buffer.from(signature, "base64"),
      ),
    ).toBe(true);
    await expect(exitCode(run)).resolves.toBe(0);
  });

  it("can open no file, socket, process or worker once started", { timeout: 60_000 }, async () => {
    const run = start([...signerNodeArguments(probedBundle)]);
    begin(run);
    run.child.stdin.write(`${JSON.stringify({ id: "a", kind: "publicKey" })}\n`);
    const answer = await nextAnswer(run);
    const report = await probeReport(run);
    run.child.stdin.end();

    expect(answer).toMatchObject({ id: "a", ok: true });
    expect(report).toStrictEqual({
      readAtStart: "allowed",
      readOwnProgram: "ERR_ACCESS_DENIED",
      writeFile: "ERR_ACCESS_DENIED",
      connectTcp: "ERR_ACCESS_DENIED",
      connectPipe: "ERR_ACCESS_DENIED",
      listen: "ERR_ACCESS_DENIED",
      startProcess: "ERR_ACCESS_DENIED",
      startWorker: "ERR_ACCESS_DENIED",
    });
    await expect(exitCode(run)).resolves.toBe(0);
  });

  it("refuses to run outside the permission model", { timeout: 60_000 }, async () => {
    const run = start([signerBundle]);
    const line = await nextAnswer(run);

    expect(line).toStrictEqual({ fault: "signer.not_sealed" });
    await expect(exitCode(run)).resolves.toBe(1);
  });
});
