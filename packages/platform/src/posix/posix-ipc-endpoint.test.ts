import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Result } from "@binference/core";
import { afterEach, describe, expect, it } from "vitest";
import { ipcEndpointContract } from "../contracts/ipc-endpoint-contract.js";
import type { IpcBinding } from "../ipc/ipc-binding.js";
import { createPosixFilePermissions } from "./posix-file-permissions.js";
import { createPosixIpcEndpoint } from "./posix-ipc-endpoint.js";

const folders: string[] = [];
const bindings: IpcBinding[] = [];

async function runFolder(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "bnf-"));
  folders.push(home);
  return join(home, "run");
}

function endpointIn(folder: string, name = "engine") {
  return createPosixIpcEndpoint({
    runFolder: folder,
    name,
    permissions: createPosixFilePermissions(),
  });
}

function bindingOf(result: Result<IpcBinding, "in_use">): IpcBinding {
  if (!result.ok) {
    throw new Error(`Expected a binding, got ${result.error}.`);
  }
  bindings.push(result.value);
  return result.value;
}

const ignore = (): void => undefined;
const signal = (): AbortSignal => new AbortController().signal;

afterEach(async () => {
  await Promise.all(bindings.splice(0).map(async (binding) => binding.close()));
  await Promise.all(folders.splice(0).map(async (folder) => rm(folder, { recursive: true })));
});

describe.skipIf(process.platform === "win32")("posix ipc endpoint", () => {
  it.each(
    ipcEndpointContract({
      create: async () => endpointIn(await runFolder()),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("puts the socket in an owner-only run folder", async () => {
    const folder = await runFolder();
    const endpoint = endpointIn(folder);

    bindingOf(await endpoint.bind({ signal: signal(), onSocket: ignore }));

    expect(endpoint.address).toBe(join(folder, "engine.sock"));
    expect((await stat(folder)).mode & 0o777).toBe(0o700);
    expect((await stat(endpoint.address)).mode & 0o777).toBe(0o600);
  });

  it("lets exactly one of two racing listeners take the address", async () => {
    const folder = await runFolder();

    const results = await Promise.all([
      endpointIn(folder).bind({ signal: signal(), onSocket: ignore }),
      endpointIn(folder).bind({ signal: signal(), onSocket: ignore }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toStrictEqual([{ ok: false, error: "in_use" }]);
    results.filter((result) => result.ok).forEach(bindingOf);
    await expect(endpointIn(folder).connect(signal())).resolves.toMatchObject({ ok: true });
  });

  it("replaces a socket file left behind by a listener that crashed", async () => {
    const folder = await runFolder();
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "engine.sock"), "");

    const endpoint = endpointIn(folder);
    bindingOf(await endpoint.bind({ signal: signal(), onSocket: ignore }));

    await expect(endpoint.connect(signal())).resolves.toMatchObject({ ok: true });
  });

  it("refuses a socket path longer than macOS allows, and names the fix", async () => {
    const folder = join(await runFolder(), "x".repeat(100));

    expect(() => endpointIn(folder)).toThrow(
      expect.objectContaining({ code: "platform.ipc_path_too_long" }),
    );
  });

  it("refuses an endpoint name that could leave the run folder", async () => {
    const folder = await runFolder();

    expect(() => endpointIn(folder, "../engine")).toThrow(
      expect.objectContaining({ code: "platform.ipc_bad_name" }),
    );
  });
});
