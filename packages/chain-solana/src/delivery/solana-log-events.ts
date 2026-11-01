import { accountRefSchema, type ChainEvent } from "@binference/chain";
import type { SolanaChain } from "../solana-chain.js";

// The log lines the runtime writes for a program's run, and for what the program logs itself.
const invoked = /^Program (\w+) invoke \[\d+\]$/u;
const returned = /^Program (\w+) (?:success|failed)/u;
const logged = /^Program (log|data): (.*)$/su;

/** One step of reading a transaction's log lines: the programs running, and the events so far. */
interface LogRead {
  readonly running: readonly string[];
  readonly events: readonly ChainEvent[];
}

function stepOf(chain: SolanaChain, read: LogRead, line: string): LogRead {
  const call = invoked.exec(line)?.[1];
  if (call !== undefined) {
    return { ...read, running: [...read.running, call] };
  }
  if (returned.test(line)) {
    return { ...read, running: read.running.slice(0, -1) };
  }
  const [, kind, text] = logged.exec(line) ?? [];
  const program = read.running.at(-1);
  if (kind === undefined || text === undefined || program === undefined) {
    return read;
  }
  const emitter = accountRefSchema.parse(`${chain.ref}:${program}`);
  return { ...read, events: [...read.events, { emitter, topics: [kind], data: text }] };
}

/**
 * The events of a Solana transaction, from the log lines its meta holds: each `Program log:` and
 * `Program data:` line, as an event of the program running when it was written, its topic `log` or
 * `data` and its data the line's text after the prefix, such as a memo's words. A line no program
 * wrote, such as the runtime's own, is no event.
 */
export function solanaLogEvents(
  chain: SolanaChain,
  lines: readonly string[],
): readonly ChainEvent[] {
  const start: LogRead = { running: [], events: [] };
  return lines.reduce((read, line) => stepOf(chain, read, line), start).events;
}
