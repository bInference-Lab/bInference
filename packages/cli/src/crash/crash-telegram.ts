// oxlint-disable-next-line eslint/no-restricted-imports -- the crash suite serves the Bot API on loopback; nothing ships a listener
import type { IncomingMessage, ServerResponse } from "node:http";
import type { FakeBotApi } from "@binference/telegram/testing";

/** Telegram's Bot API as the crash engines reach it: the served install's synthetic one. */
export interface CrashTelegram {
  /** Makes the install's synthetic Bot API the one the engines reach from now on. */
  readonly serve: (bot: FakeBotApi) => void;
  /** Answers one request to the Bot API's path, as the served Bot API answers it. */
  readonly respond: (call: {
    readonly incoming: IncomingMessage;
    readonly path: string;
    readonly body: string;
    readonly outgoing: ServerResponse;
  }) => Promise<void>;
}

const telegramOrigin = "https://api.telegram.org";
// A download the engine asks for is held to its own limit; this one only bounds the answer.
const maxDownloadBytes = 6 * 1024 * 1024;

// A signal that aborts once the engine's connection closes, as a killed engine's long poll does.
function closedSignal(incoming: IncomingMessage, outgoing: ServerResponse): AbortSignal {
  const closed = new AbortController();
  outgoing.on("close", () => closed.abort(new Error("The engine closed the connection.")));
  incoming.on("aborted", () => closed.abort(new Error("The engine closed the connection.")));
  return closed.signal;
}

/**
 * Serves the install's synthetic Bot API to the crash engines over loopback: Bot API calls, the
 * bot's long poll among them, and file downloads, each as the synthetic Bot API answers them. With
 * none served, a call's connection is dropped, as a Bot API no network reaches.
 */
export function createCrashTelegram(): CrashTelegram {
  const served: { bot?: FakeBotApi } = {};
  return {
    serve: (bot) => {
      served.bot = bot;
    },
    async respond({ incoming, path, body, outgoing }) {
      const { bot } = served;
      if (bot === undefined) {
        outgoing.destroy();
        return;
      }
      const url = `${telegramOrigin}${path}`;
      const signal = closedSignal(incoming, outgoing);
      try {
        if (path.startsWith("/file/")) {
          const file = await bot.download.download({ url, maxBytes: maxDownloadBytes, signal });
          outgoing.writeHead(file.status).end(Buffer.from(file.bytes));
          return;
        }
        const method = incoming.method === "GET" ? "GET" : "POST";
        const contentType = incoming.headers["content-type"];
        const headers = contentType === undefined ? {} : { "content-type": contentType };
        const sent = body === "" ? {} : { body };
        const answer = await bot.http.request({ method, url, headers, ...sent, signal });
        outgoing.writeHead(answer.status, answer.headers).end(answer.body);
      } catch {
        outgoing.destroy();
      }
    },
  };
}
