import { BinferenceError, type Logger, type Secret } from "@binference/core";
import { createPollerLeases, pollWorker, runPolling } from "@binference/telegram";
import type { CliHost } from "../program/cli-host.js";
import type { Closers } from "./closers.js";
import type { ComposedTelegram } from "./compose-telegram.js";

/** The owner's bot as a channel of the startup order. */
export interface BotChannel {
  /** Starts the channel; call it once the engine is ready. */
  begin(): void;
}

/** What the channel runs on. */
export interface BotChannelOptions {
  readonly telegram: ComposedTelegram;
  readonly token: Secret;
  readonly host: Pick<CliHost, "http" | "clock" | "random" | "workerExecArgv">;
  /** Where the channel adds what stops it. */
  readonly closers: Closers;
  readonly logger: Logger;
}

function codeOf(error: ErrorOptions["cause"]): string {
  return error instanceof BinferenceError ? error.code : "unexpected";
}

// The menu, the outbox, the updates an earlier run stored, then long polling until the stop.
async function runChannel(options: BotChannelOptions, signal: AbortSignal): Promise<void> {
  const { telegram, host, logger } = options;
  try {
    await telegram.commands.register({ signal });
  } catch (error) {
    if (!signal.aborted) {
      logger.warn("telegram.menu_failed", { errorCode: codeOf(error) });
    }
  }
  telegram.start();
  const execArgv = host.workerExecArgv === undefined ? {} : { execArgv: host.workerExecArgv };
  try {
    await telegram.ingress.resume({ signal });
    await runPolling(
      {
        worker: pollWorker,
        token: options.token,
        http: host.http,
        ...execArgv,
        leases: createPollerLeases(),
        intake: telegram.ingress,
        clock: host.clock,
        random: host.random,
      },
      { signal },
    );
  } catch (error) {
    if (!signal.aborted) {
      logger.error("telegram.polling_stopped", { errorCode: codeOf(error) });
    }
  }
}

/**
 * Adds the bot's channel at the channels step of the startup order (ARCHITECTURE.md section 24):
 * its closer now, so the shutdown stops polling first, and `begin` once the engine is ready, since
 * the owner's calls from Telegram skip the server's check for an engine still starting. `begin`
 * registers the fast commands' menu, starts sending the outbox's notices, handles the updates an
 * earlier run stored but did not handle, then long-polls from the poll worker into the ingress.
 * Polling that a fault no retry fixes ends, such as a refused token or another program polling
 * the bot, is logged as `telegram.polling_stopped`; the engine runs on.
 */
export function startBotChannel(options: BotChannelOptions): BotChannel {
  const stop = new AbortController();
  const run = { polling: Promise.resolve() };
  options.closers.add("telegram polling", async () => {
    stop.abort();
    await run.polling;
  });
  return {
    begin: () => {
      run.polling = runChannel(options, stop.signal);
    },
  };
}
