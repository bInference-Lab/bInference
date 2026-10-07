import {
  BinferenceError,
  err,
  type Id,
  type Logger,
  ok,
  type Result,
  type Secret,
} from "@binference/core";
import { z } from "zod";
import { readLines } from "../process/read-lines.js";
import { type SignerSettings, signerSettingsSchema } from "../process/signer-settings.schema.js";
import type { AuthorizeInput } from "../requests/authorize-input.schema.js";
import {
  formatSignerRequest,
  readSignerLine,
  type SignerAnswer,
  type SignerRefusal,
  type SignerRequest,
} from "../requests/signer-message.schema.js";
import { type AnswerRouter, createAnswerRouter } from "./answer-router.js";

/** A refusal as the composition root raises it as a notice: ids and the reason, nothing else. */
export interface SignerRefusalNotice {
  readonly wallet: Id<"wal">;
  readonly intent: Id<"int">;
  readonly refused: SignerRefusal;
}

/** The engine's side of the signer's channel, and what the client reports to. */
export interface SignerClientOptions {
  /** The signer's standard output. */
  readonly answers: AsyncIterable<Uint8Array>;
  /** Writes one line to the signer's standard input and resolves once it is written. */
  readonly write: (line: string) => Promise<void>;
  /** Closes the signer's standard input. */
  readonly end: () => Promise<void>;
  readonly settings: SignerSettings;
  /** The agent key's text, from the secret store the unlock mode names. */
  readonly agentKey: Secret;
  readonly logger: Logger;
  /** Hears every refusal of an `authorize`, so the composition root raises it as a notice. */
  readonly onRefusal: (notice: SignerRefusalNotice) => void;
}

/** The engine's client of the signer process. */
export interface SignerClient {
  /** The agent key's public half, as Privy's key quorums take it. */
  publicKey(signal: AbortSignal): Promise<string>;
  /**
   * Privy's authorization signature over `input.request`, or why the signer refused it. Requests
   * for one wallet go one at a time, in call order. Rejects with `signer.stopped` once the signer
   * has stopped, and with the signal's reason once the signal aborts; the signal carries the
   * call's deadline.
   */
  authorize(input: AuthorizeInput, signal: AbortSignal): Promise<Result<string, SignerRefusal>>;
  /** Closes the signer's input; the signer exits once it has answered every line it read. */
  close(): Promise<void>;
  /** Settles once the signer's output has ended. */
  readonly ended: Promise<void>;
}

/**
 * The most calls that wait for the signer at once, queued behind their wallet's or sent; one more
 * is refused with `signer.busy`, never queued.
 */
export const maxWaitingCalls = 256;

function busy(): BinferenceError {
  return new BinferenceError({
    code: "signer.busy",
    message: `${String(maxWaitingCalls)} calls already wait for the signer; try again once they end.`,
  });
}

function badAnswer(): BinferenceError {
  return new BinferenceError({
    code: "signer.bad_answer",
    message: "The signer answered a request with an answer of another kind.",
  });
}

// Reads answers until the signer's output ends or holds something that is no answer; it never
// rejects, and every wait ends with it.
async function readAnswers(options: SignerClientOptions, router: AnswerRouter): Promise<void> {
  try {
    for await (const bytes of readLines(options.answers)) {
      const line = readSignerLine(bytes.toString("utf8"));
      if (line === undefined) {
        options.logger.error("signer.bad_line", { errorCode: "signer.bad_answer" });
        return;
      }
      router.deliver(line);
    }
  } catch (error) {
    const errorCode = error instanceof BinferenceError ? error.code : "signer.stopped";
    options.logger.error("signer.bad_line", { errorCode });
  } finally {
    router.end();
  }
}

// Each wallet's requests wait for the one before; the map keeps only wallets with work queued.
function createWalletOrder(): <T>(wallet: string, task: () => Promise<T>) => Promise<T> {
  const tails = new Map<string, Promise<void>>();
  return async (wallet, task) => {
    const run = (tails.get(wallet) ?? Promise.resolve()).then(task);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    tails.set(wallet, tail);
    try {
      return await run;
    } finally {
      if (tails.get(wallet) === tail) {
        tails.delete(wallet);
      }
    }
  };
}

function refusalOf(answer: SignerAnswer): Result<string, SignerRefusal> {
  if (!answer.ok) {
    return err(answer.refused);
  }
  if (!("signature" in answer)) {
    throw badAnswer();
  }
  return ok(answer.signature);
}

type Ask = (request: (id: string) => SignerRequest, signal: AbortSignal) => Promise<SignerAnswer>;

// Sends one request with the next id and waits for its answer.
function createAsk(options: SignerClientOptions, router: AnswerRouter): Ask {
  let sent = 0;
  return async (request, signal) => {
    sent += 1;
    const message = request(`r${String(sent)}`);
    const answer = router.wait(message.id, signal);
    try {
      await options.write(formatSignerRequest(message));
    } catch {
      // A signer whose input is closed is gone: every wait ends with `signer.stopped`.
      router.end();
    }
    return answer;
  };
}

// Runs a call while fewer than the most calls wait; the count covers queued calls too.
function createCallLimit(): <T>(call: () => Promise<T>) => Promise<T> {
  let waiting = 0;
  return async (call) => {
    if (waiting >= maxWaitingCalls) {
      throw busy();
    }
    waiting += 1;
    try {
      return await call();
    } finally {
      waiting -= 1;
    }
  };
}

async function authorizeOnce(
  options: SignerClientOptions,
  ask: Ask,
  call: { readonly input: AuthorizeInput; readonly signal: AbortSignal },
): Promise<Result<string, SignerRefusal>> {
  const { input } = call;
  const result = refusalOf(await ask((id) => ({ id, kind: "authorize", ...input }), call.signal));
  if (!result.ok) {
    options.logger.warn("signer.refused", {
      intentId: input.intent,
      errorCode: `signer.${result.error}`,
    });
    options.onRefusal({ wallet: input.wallet.id, intent: input.intent, refused: result.error });
  }
  return result;
}

/**
 * Opens the client over a started signer's standard input and output: it writes the settings
 * line, then the agent key's line, then one line per request. The agent key leaves the engine only
 * here, on the signer's input.
 */
export async function openSignerClient(options: SignerClientOptions): Promise<SignerClient> {
  const router = createAnswerRouter();
  const ended = readAnswers(options, router);
  const inWalletOrder = createWalletOrder();
  const limited = createCallLimit();
  const ask = createAsk(options, router);
  await options.write(JSON.stringify(z.encode(signerSettingsSchema, options.settings)));
  await options.write(options.agentKey.reveal());
  return {
    publicKey: async (signal) =>
      limited(async () => {
        const answer = await ask((id) => ({ id, kind: "publicKey" }), signal);
        if (!answer.ok || !("publicKey" in answer)) {
          throw badAnswer();
        }
        return answer.publicKey;
      }),
    authorize: async (input, signal) =>
      limited(async () =>
        inWalletOrder(input.wallet.id, async () => authorizeOnce(options, ask, { input, signal })),
      ),
    close: options.end,
    ended,
  };
}
