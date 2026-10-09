import { homedir } from "node:os";
import { createIdSource, ok } from "@binference/core";
import type { EnginePush, EngineStores } from "@binference/engine";
import type { Platform } from "@binference/platform";
import type { EngineState } from "@binference/protocol";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import { createSecretReader } from "../config/secrets/secret-reader.js";
import type { CliHost } from "../program/cli-host.js";
import { createEngineLock, type EngineLock } from "../unlock/engine-lock.js";
import { openInstallKeys } from "../unlock/install-keys.js";

/** What the install's wallets need from this machine, as `binference init` stored it. */
export interface SetUpInstall {
  readonly installId: string;
  /** The agent key's public half the wallets name as their signer. */
  readonly agentKeyPublic: string;
}

/** What the self-hosted engine's lock is built from. */
export interface ComposeLockOptions {
  readonly host: CliHost;
  readonly platform: Platform;
  readonly config: BinferenceConfig;
  /** The install, or `undefined` before `binference init` set it up. */
  readonly install: SetUpInstall | undefined;
  /** Whether the engine serves calls yet: `starting`, then `ready`. */
  readonly started: { readonly current: EngineState };
}

/** The engine's lock, the state it reports, and where an unlock after start is announced. */
export interface ComposedLock {
  readonly lock: EngineLock;
  /** `locked` once the engine serves calls while the lock holds; else the start's own state. */
  readonly state: () => EngineState;
  /** Set to the server's publish once the server exists. */
  readonly announce: { publish: (push: EnginePush) => void };
}

// An install that was never set up holds no agent key to open: nothing is locked, and live
// trades fail as the missing custody refuses them.
const notSetUp: EngineLock = {
  isLocked: () => false,
  unlock: async () => Promise.resolve(ok(undefined)),
};

function lockOf(
  options: ComposeLockOptions,
  install: SetUpInstall,
  announce: ComposedLock["announce"],
): EngineLock {
  const { host, platform, config, started } = options;
  const unlock = {
    config,
    platform,
    secrets: createSecretReader({
      env: host.env,
      keychain: platform.keychain,
      homeDir: host.homeDir ?? homedir(),
      clock: host.clock,
    }),
    env: host.env,
  };
  return createEngineLock({
    open: async (call) => openInstallKeys({ ...install, unlock }, call),
    // The seam where the signer and custody start with the keys, in the startup order of
    // ARCHITECTURE.md section 24. Without them an unlock changes the engine state alone.
    onUnlocked: async () => {
      if (started.current === "ready") {
        announce.publish({ topic: "engine", kind: "engine/state", data: { state: "ready" } });
      }
      return Promise.resolve();
    },
  });
}

/**
 * Builds the self-hosted engine's lock over the install's keys (decision 0103): the unlock mode
 * opens them at start and through `engine/unlock`, and the key must be the one the wallets name as
 * their signer. An unlock after start is announced on topic `engine`.
 */
export function composeLock(options: ComposeLockOptions): ComposedLock {
  const announce = { publish: (_push: EnginePush): void => undefined };
  const { install, started } = options;
  const lock = install === undefined ? notSetUp : lockOf(options, install, announce);
  return {
    lock,
    state: () => (started.current === "ready" && lock.isLocked() ? "locked" : started.current),
    announce,
  };
}

/**
 * The install as `binference init` set it up, or `undefined` before: its id and the agent key its
 * wallets name as their signer.
 */
export async function readSetUpInstall(
  stores: Pick<EngineStores, "install">,
  context: { readonly host: CliHost; readonly signal: AbortSignal },
): Promise<SetUpInstall | undefined> {
  const { host, signal } = context;
  const { custody } = await stores.install.read({ signal });
  if (custody === undefined) {
    return undefined;
  }
  // init stored the install's id, so the store ignores this proposal.
  const proposal = { id: createIdSource(host).next("ins"), atMs: host.clock.now() };
  const installId = await stores.install.installId(proposal, { signal });
  return { installId, agentKeyPublic: custody.agentKeyPublic };
}
