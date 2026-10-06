import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { err, ok } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { ServiceManager } from "../ports.js";
import type { ServiceDefinition } from "../service/service-definition.js";

/** A service manager under test, with an empty scratch folder of its own. */
export interface ServiceManagerSubject {
  readonly manager: ServiceManager;
  /** Where the checks write the sample program and its log. */
  readonly folder: string;
}

/** Makes subjects, and judges what a removed service left behind, with the OS's own tools. */
export interface ServiceManagerHarness {
  create(): Promise<ServiceManagerSubject>;
  /** What the OS still holds of the named service, in its terms; empty when nothing. */
  leftovers(name: string): Promise<readonly string[]>;
}

const signal = (): AbortSignal => new AbortController().signal;

// Runs until it is stopped. Its folder has a space and its arguments carry quotes, so each OS's
// quoting of a command line is proven.
const keepAlive = "process.stdout.write('started\\n');\nsetInterval(() => {}, 60_000);\n";

async function sample(folder: string): Promise<ServiceDefinition> {
  const programFolder = join(folder, "sample service");
  await mkdir(programFolder, { recursive: true });
  const script = join(programFolder, "keep-alive.mjs");
  await writeFile(script, keepAlive);
  return {
    name: `test-${randomUUID().slice(0, 8)}`,
    description: "binference test service",
    program: process.execPath,
    args: [script, "--label", 'a "quoted" value'],
    workingFolder: programFolder,
    logFile: join(folder, "service.log"),
    stopTimeoutMs: 5000,
  };
}

type SampleCheck = (manager: ServiceManager, definition: ServiceDefinition) => Promise<void>;

// Every check removes its service at the end, whatever happened, so no login item stays behind.
function withSample(harness: ServiceManagerHarness, check: SampleCheck): () => Promise<void> {
  return async () => {
    const { manager, folder } = await harness.create();
    const definition = await sample(folder);
    try {
      await check(manager, definition);
    } finally {
      await manager.uninstall(definition.name, signal());
    }
  };
}

const running = { state: "running", startsAtLogin: true };
const notInstalled = { state: "not_installed" };

const installChecks = (harness: ServiceManagerHarness): readonly ContractCheck[] => [
  {
    name: "installs a service that runs now and starts at login",
    run: withSample(harness, async (manager, definition) => {
      await manager.install(definition, signal());
      assert.deepEqual(await manager.status(definition.name, signal()), running);
    }),
  },
  {
    name: "replaces an installed service and runs the new one",
    run: withSample(harness, async (manager, definition) => {
      await manager.install(definition, signal());
      await manager.install({ ...definition, args: [...definition.args, "--again"] }, signal());
      assert.deepEqual(await manager.status(definition.name, signal()), running);
    }),
  },
  {
    name: "uninstalls a service and leaves nothing behind",
    run: withSample(harness, async (manager, definition) => {
      await manager.install(definition, signal());
      assert.deepEqual(await manager.uninstall(definition.name, signal()), ok(undefined));
      assert.deepEqual(await manager.status(definition.name, signal()), notInstalled);
      assert.deepEqual(await harness.leftovers(definition.name), []);
    }),
  },
];

const refusalChecks = (harness: ServiceManagerHarness): readonly ContractCheck[] => [
  {
    name: "answers not_installed for a service it never installed",
    run: withSample(harness, async (manager, definition) => {
      assert.deepEqual(await manager.status(definition.name, signal()), notInstalled);
      assert.deepEqual(await manager.uninstall(definition.name, signal()), err("not_installed"));
    }),
  },
  {
    name: "refuses a bad name or a relative path before it touches the OS",
    run: withSample(harness, async (manager, definition) => {
      const refusal = { code: "platform.service_definition_invalid" };
      await assert.rejects(manager.install({ ...definition, name: "Engine" }, signal()), refusal);
      await assert.rejects(manager.install({ ...definition, program: "node" }, signal()), refusal);
      await assert.rejects(manager.status("../engine", signal()), refusal);
      await assert.rejects(manager.uninstall("", signal()), refusal);
      assert.deepEqual(await manager.status(definition.name, signal()), notInstalled);
    }),
  },
  {
    name: "installs nothing on an aborted signal",
    run: withSample(harness, async (manager, definition) => {
      const reason = new Error("stopped");
      await assert.rejects(manager.install(definition, AbortSignal.abort(reason)), reason);
      assert.deepEqual(await manager.status(definition.name, signal()), notInstalled);
    }),
  },
];

/** The contract every `ServiceManager` adapter passes. */
export function serviceManagerContract(harness: ServiceManagerHarness): readonly ContractCheck[] {
  return [...installChecks(harness), ...refusalChecks(harness)];
}
