import { PassThrough } from "node:stream";
import { openSignerClient, serveSigner } from "@binference/signer";
import type { StartSigner } from "../compose/start-signer.js";
import { createSystemClock } from "../runtime/system-clock.js";

// Writes one line to the pipe and resolves once it is written.
async function write(stream: PassThrough, line: string): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(`${line}\n`, (error) => {
      if (error === null || error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}

/**
 * The crash engine's signer: the signer's own service with every hard rule, in the engine's
 * process, on a channel of two pipes in place of its standard streams. It reads the settings line
 * and the agent key the engine writes, as the built signer does, and refuses what the built one
 * refuses; only the process and its sandbox are left out, so a kill takes it down with the engine.
 */
export const startCrashSigner: StartSigner = async (start) => {
  const toSigner = new PassThrough();
  const fromSigner = new PassThrough();
  const clock = createSystemClock();
  const served = serveSigner({
    input: toSigner,
    write: async (line) => write(fromSigner, line),
    now: () => clock.now(),
  }).finally(() => fromSigner.end());
  const stopped = served.then(
    () => undefined,
    () => undefined,
  );
  const client = await openSignerClient({
    answers: fromSigner,
    write: async (line) => write(toSigner, line),
    end: async () => {
      toSigner.end();
      return Promise.resolve();
    },
    settings: start.settings,
    agentKey: start.agentKey,
    logger: start.logger.child("signer"),
    onRefusal: start.onRefusal,
  });
  return {
    client,
    stopped,
    async stop() {
      await client.close();
      await stopped;
    },
  };
};
