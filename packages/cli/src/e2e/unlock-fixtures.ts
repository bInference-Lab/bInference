import { join } from "node:path";
import {
  createSecret,
  idSchema,
  type JsonValue,
  jsonValueSchema,
  type Secret,
} from "@binference/core";
import {
  createFileSecretStore,
  createPassphraseSecretStore,
  writePrivateFile,
} from "@binference/platform";
import type { TempFolder } from "@binference/platform/testing";
import { type EngineState, operations } from "@binference/protocol";
import { createSqliteInstallStore, engineWorker, openDatabase } from "@binference/store";
import { runCli } from "../program/run-cli.js";
import {
  configText,
  type InitMachine,
  initFlags,
  newInitMachine,
  runOn,
  secretEnv,
} from "./init-fixtures.js";
import { freePort, hostOn, noPermissions } from "./test-host.js";

/** The passphrase the tests seal the `manual` mode's agent key with. */
export const testPassphrase = "correct horse battery staple";

/** Engines a test file starts, so each test stops its own before its folder goes. */
export interface RunningEngines {
  /** Stops every engine started since the last call, then removes every folder. */
  stopAll(): Promise<void>;
  /** A machine set up by `binference init` in the file unlock mode, its keys in `keys/`. */
  setUp(): Promise<InitMachine>;
  /** Runs `binference start --json` on the machine and answers its first JSON line. */
  start(machine: InitMachine): Promise<JsonValue>;
}

const signal = (): AbortSignal => new AbortController().signal;

/** Creates the {@link RunningEngines} of one test file. */
export function createRunningEngines(): RunningEngines {
  const folders: TempFolder[] = [];
  const engines: { readonly machine: InitMachine; readonly exit: Promise<number> }[] = [];
  return {
    async stopAll() {
      engines.forEach(({ machine }) => machine.signals.emit("SIGINT", "SIGINT"));
      await Promise.allSettled(engines.splice(0).map(async ({ exit }) => exit));
      await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
    },
    async setUp() {
      const machine = await newInitMachine(folders);
      const init = await runOn(machine, ["init", "--yes", ...initFlags(machine)]);
      if (init.code !== 0) {
        throw new Error(`binference init failed: ${init.stderr}`);
      }
      return machine;
    },
    async start(machine) {
      const port = String(await freePort());
      const argv = ["start", "--json", "--set", `engine.port=${port}`];
      const host = hostOn(machine, argv, secretEnv(machine));
      const exit = runCli(host);
      engines.push({ machine, exit });
      const line = await Promise.race([
        host.waitForLine((text) => text.includes('"state":')),
        exit.then(() => `{"failed":${JSON.stringify(host.stderr())}}`),
      ]);
      return jsonValueSchema.parse(JSON.parse(line));
    },
  };
}

// The machine's `keys/` folder as the `file` mode reads it.
function keysOf(machine: InitMachine) {
  return createFileSecretStore({
    folder: join(machine.folder, "keys"),
    permissions: noPermissions,
  });
}

/** The agent key `binference init` kept in `keys/`. */
export async function heldKey(machine: InitMachine): Promise<Secret> {
  const held = await keysOf(machine).read("agent-key", signal());
  if (!held.ok) {
    throw new Error("Expected binference init to keep the agent key in keys/.");
  }
  return held.value;
}

/** The engine state `binference status --json` reports. */
export async function stateOf(machine: InitMachine): Promise<EngineState> {
  const status = await runOn(machine, ["status", "--json"]);
  return operations["engine/status"].result.parse(JSON.parse(status.stdout)).state;
}

async function installIdOf(machine: InitMachine): Promise<string> {
  const database = await openDatabase({
    file: join(machine.folder, "engine.sqlite"),
    worker: engineWorker,
    execArgv: hostOn(machine, []).workerExecArgv ?? [],
    signal: signal(),
  });
  try {
    const proposal = {
      id: idSchema("ins").parse("ins_0190f1c2-3a4b-7c5d-8e6f-000000000099"),
      atMs: 1,
    };
    return await createSqliteInstallStore(database).installId(proposal, { signal: signal() });
  } finally {
    await database.close();
  }
}

/**
 * Moves the agent key of `keys/agent-key` into the `manual` mode's sealed file, sealed with
 * {@link testPassphrase}, and sets `engine.unlock.mode` to `manual`.
 */
export async function sealAgentKey(machine: InitMachine): Promise<void> {
  const text = await heldKey(machine);
  const sealed = createPassphraseSecretStore({
    folder: join(machine.folder, "keys"),
    installId: await installIdOf(machine),
    passphrase: createSecret(testPassphrase),
    permissions: noPermissions,
    scryptCost: 1024,
  });
  await sealed.write("agent-key", text, signal());
  await removeAgentKey(machine);
  const config = (await configText(machine)) ?? "";
  await writePrivateFile(
    join(machine.folder, "config.json5"),
    config.replace('mode: "file"', 'mode: "manual"'),
    { permissions: noPermissions, signal: signal() },
  );
}

/** Removes the agent key from `keys/`, as a lost file would. */
export async function removeAgentKey(machine: InitMachine): Promise<void> {
  await keysOf(machine).delete("agent-key", signal());
}

/** Puts an agent key back into `keys/`. */
export async function putAgentKey(machine: InitMachine, key: Secret): Promise<void> {
  await keysOf(machine).write("agent-key", key, signal());
}
