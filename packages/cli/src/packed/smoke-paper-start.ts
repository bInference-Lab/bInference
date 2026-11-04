import { createProtocolClient } from "@binference/client";
import { BinferenceError } from "@binference/core";
import { createMemoryLogger } from "@binference/core/testing";
import { createPlatform } from "@binference/platform";
import { operations } from "@binference/protocol";
import { ipcWebSocket } from "../commands/connect-engine.js";
import { cliTokenFile, readCliToken } from "../compose/cli-token.js";
import { engineEndpoint } from "../compose/engine-locations.js";
import { createSystemClock } from "../runtime/system-clock.js";
import { createSystemRandom } from "../runtime/system-random.js";

/**
 * Gives the agent of the install in `home` its paper starting balances, as the console does: a
 * new agent's paper portfolio is empty until a reset. It signs in over the engine's IPC endpoint
 * with the CLI's token, as `binference` does, and answers the agent's id.
 */
export async function startPaperPortfolio(home: string, signal: AbortSignal): Promise<string> {
  const platform = createPlatform({ binferenceHome: home, homeDir: home });
  const token = await readCliToken(cliTokenFile(platform.stateFolder), signal);
  if (token === undefined) {
    throw new BinferenceError({ code: "smoke.no_token", message: "The CLI token is missing." });
  }
  const { address } = engineEndpoint(platform);
  const client = createProtocolClient({
    operations,
    openSocket: () => ipcWebSocket(address),
    client: { kind: "cli", version: "packed-smoke" },
    credential: { token },
    clock: createSystemClock(),
    random: createSystemRandom(),
    logger: createMemoryLogger({ subsystem: "smoke" }),
  });
  try {
    await client.connect(signal);
    const [agent] = (await client.call("engine/status", {}, { signal })).agents;
    if (agent === undefined) {
      throw new BinferenceError({ code: "smoke.no_agent", message: "init made no agent." });
    }
    await client.call("portfolio/resetPaper", { agent: agent.id }, { signal });
    return agent.id;
  } finally {
    client.close();
  }
}
