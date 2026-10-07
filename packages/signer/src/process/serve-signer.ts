import { BinferenceError, createSecret, err, ok, type Result } from "@binference/core";
import { parseAgentKey } from "../agent-key/agent-key-text.js";
import type { P256KeyPair } from "../keys/p256-key-pair.js";
import type { SignerFaultCode } from "../requests/signer-message.schema.js";
import { readLines } from "./read-lines.js";
import { createSignerService } from "./signer-service.js";
import { readSignerSettings, type SignerSettings } from "./signer-settings.schema.js";

/** The signer's side of its channel to the engine: its standard input and output. */
export interface SignerChannel {
  /** What the engine writes: the settings line, the agent key's line, then one request per line. */
  readonly input: AsyncIterable<Uint8Array>;
  /** Writes one line to the engine and resolves once it is written. */
  readonly write: (line: string) => Promise<void>;
}

interface Start {
  readonly settings: SignerSettings;
  readonly agentKey: P256KeyPair;
}

type StartProblem = "closed" | "signer.settings_invalid" | "signer.agent_key_invalid";

async function nextLine(lines: AsyncGenerator<Buffer>): Promise<Buffer | undefined> {
  const next = await lines.next();
  return next.done === true ? undefined : next.value;
}

// The settings come first, so a signer that cannot run never reads the key.
async function start(lines: AsyncGenerator<Buffer>): Promise<Result<Start, StartProblem>> {
  const settingsLine = await nextLine(lines);
  if (settingsLine === undefined) {
    return err("closed");
  }
  const settings = readSignerSettings(settingsLine.toString("utf8"));
  if (settings === undefined) {
    return err("signer.settings_invalid");
  }
  const keyLine = await nextLine(lines);
  if (keyLine === undefined) {
    return err("closed");
  }
  const agentKey = parseAgentKey(createSecret(keyLine.toString("latin1")));
  keyLine.fill(0);
  return agentKey.ok ? ok({ settings, agentKey: agentKey.value }) : err("signer.agent_key_invalid");
}

async function serveRequests(
  lines: AsyncGenerator<Buffer>,
  channel: SignerChannel,
  started: Start,
): Promise<void> {
  const service = createSignerService({ agentKey: started.agentKey });
  // One request at a time: the next line is read only once the last answer is written.
  for await (const line of lines) {
    const answer = service.answer(line.toString("utf8"));
    await channel.write(JSON.stringify(answer));
  }
}

async function fault(channel: SignerChannel, code: SignerFaultCode): Promise<SignerFaultCode> {
  await channel.write(JSON.stringify({ fault: code }));
  return code;
}

async function serveLines(
  lines: AsyncGenerator<Buffer>,
  channel: SignerChannel,
): Promise<SignerFaultCode | undefined> {
  const started = await start(lines);
  if (!started.ok) {
    return started.error === "closed" ? undefined : await fault(channel, started.error);
  }
  await serveRequests(lines, channel, started.value);
  return undefined;
}

/**
 * Serves the engine until it closes the signer's input. The first line holds the settings, the
 * second the agent key's text, zeroed as soon as it is read; every later line is a request,
 * answered in order, one at a time. Returns the fault the signer stops on, after writing it as the
 * last line, or `undefined` when the engine closed the input.
 */
export async function serveSigner(channel: SignerChannel): Promise<SignerFaultCode | undefined> {
  const lines = readLines(channel.input);
  try {
    return await serveLines(lines, channel);
  } catch (error) {
    if (error instanceof BinferenceError && error.code === "signer.line_too_long") {
      return await fault(channel, "signer.line_too_long");
    }
    throw error;
  } finally {
    await lines.return(undefined);
  }
}
