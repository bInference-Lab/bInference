import { fileURLToPath } from "node:url";
import type { SignerProcess } from "@binference/chain";
import type { Logger, Secret } from "@binference/core";
import { realFilePath, startNodeProgram } from "@binference/platform";
import {
  openSignerClient,
  type SignerRefusalNotice,
  type SignerSettings,
  signerNodeArguments,
} from "@binference/signer";

/** A signer that runs: its client, and what ends it. */
export interface StartedSigner {
  /** The signer's client, as custody asks it for authorizations. */
  readonly client: SignerProcess;
  /** Settles once the signer has stopped, whatever stopped it. */
  readonly stopped: Promise<void>;
  /** Closes the signer's input so it ends once it has answered; ends it at once when `signal` aborts. */
  stop(signal: AbortSignal): Promise<void>;
}

/** What one signer starts with: its settings line and the agent key, written to its input. */
export interface SignerStart {
  readonly settings: SignerSettings;
  readonly agentKey: Secret;
  /** The environment of this process, of which the signer gets only what Node needs. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly logger: Logger;
  /** Hears each refusal, which the client has logged with its rule, to tell the owner. */
  readonly onRefusal: (notice: SignerRefusalNotice) => void;
  readonly signal: AbortSignal;
}

/** Starts the signer; the built signer's process unless a test passes one of its own. */
export type StartSigner = (start: SignerStart) => Promise<StartedSigner>;

/**
 * Starts the signer from the built entry at `entry` (spec 5, section 5): `process.execPath`
 * under Node's permission model with no grant, its standard input and output the only channel,
 * and no variable of this process but what Node needs. The client writes the settings line and
 * the agent key first; the key leaves the engine only there.
 */
export async function startSignerProcess(
  start: SignerStart & { readonly entry: string },
): Promise<StartedSigner> {
  start.signal.throwIfAborted();
  const lifetime = new AbortController();
  const program = startNodeProgram({
    args: signerNodeArguments(start.entry),
    parentEnv: start.env,
    signal: lifetime.signal,
  });
  const stopped = program.exited.then(() => undefined);
  const kill = (): void => lifetime.abort();
  const client = await openSignerClient({
    answers: program.output,
    write: async (line) => program.write(`${line}\n`),
    end: async () => program.end(),
    settings: start.settings,
    agentKey: start.agentKey,
    logger: start.logger.child("signer"),
    onRefusal: start.onRefusal,
  });
  return {
    client,
    stopped,
    async stop(signal) {
      signal.addEventListener("abort", kill, { once: true });
      await client.close().catch(kill);
      await stopped;
      signal.removeEventListener("abort", kill);
    },
  };
}

/**
 * Starts the signer this binference ships, `@binference/signer/process`, by its real path: Node
 * lets a program under the permission model read only the file it was started with, never
 * through a link such as pnpm's `node_modules`.
 */
export const startBuiltSigner: StartSigner = async (start) => {
  const linked = fileURLToPath(import.meta.resolve("@binference/signer/process"));
  return startSignerProcess({ ...start, entry: await realFilePath(linked, start.signal) });
};
