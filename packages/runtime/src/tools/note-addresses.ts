import { describedImageOpening } from "../images/image-notes.js";
import type { ModelMessage } from "../loop/model-message.js";
import { summaryOpening } from "../sessions/conversation.js";

// Rule 10 for the agent's memory (decision 0206): a proposal never takes an address that only a
// note holds. Each address the conversation holds is sorted by where it came from: a source (the
// owner's own messages, the engine's messages to the turn, and the engine's reads, less the
// addresses each read was given), a note, or neither (a summary, an image's description, any
// other tool's result).

/** The tools whose results hold addresses a proposal may take, and the ones that hold notes. */
export interface AddressTools {
  readonly engine: ReadonlySet<string>;
  readonly notes: ReadonlySet<string>;
}

const evmAddress = /(?<![\da-f])0x[\da-f]{40}(?![\da-f])/gi;

/** The EVM addresses in a text, in lower case. */
export function addressesIn(text: string): ReadonlySet<string> {
  return new Set([...text.matchAll(evmAddress)].map(([address]) => address.toLowerCase()));
}

interface Sorted {
  readonly sources: Set<string>;
  readonly notes: Set<string>;
}

function addAll(into: Set<string>, addresses: Iterable<string>): void {
  for (const address of addresses) {
    into.add(address);
  }
}

// What each tool call was given, by the call's id, so a read does not vouch for its own input.
function callArguments(seen: readonly ModelMessage[]): ReadonlyMap<string, string> {
  return new Map(
    seen.flatMap((entry) =>
      entry.role === "agent" ? entry.toolCalls.map((call) => [call.id, call.argumentsText]) : [],
    ),
  );
}

// binference's own records on the owner's side, a summary or an image's description: never the
// owner's words, so never a source.
function isRecord(text: string): boolean {
  return text.startsWith(summaryOpening) || text.startsWith(describedImageOpening);
}

function sortAddresses(seen: readonly ModelMessage[], tools: AddressTools): Sorted {
  const sorted = { sources: new Set<string>(), notes: new Set<string>() };
  const given = callArguments(seen);
  for (const entry of seen) {
    if (entry.role === "owner" && !isRecord(entry.text)) {
      addAll(sorted.sources, addressesIn(entry.text));
    } else if (entry.role === "tool" && tools.notes.has(entry.name)) {
      addAll(sorted.notes, addressesIn(entry.text));
    } else if (entry.role === "tool" && tools.engine.has(entry.name)) {
      const echoed = addressesIn(given.get(entry.callId) ?? "");
      addAll(
        sorted.sources,
        [...addressesIn(entry.text)].filter((address) => !echoed.has(address)),
      );
    }
  }
  return sorted;
}

/**
 * The first address in a proposal's arguments that a note in the conversation holds and no
 * source does, or none (decision 0206). Letter case does not matter.
 */
export function noteOnlyAddress(
  argumentsText: string,
  seen: readonly ModelMessage[],
  tools: AddressTools,
): string | undefined {
  const wanted = addressesIn(argumentsText);
  if (wanted.size === 0) {
    return undefined;
  }
  const { sources, notes } = sortAddresses(seen, tools);
  return [...wanted].find((address) => notes.has(address) && !sources.has(address));
}

/** What a proposal refused by the note-address check reads. */
export function noteAddressRefusal(address: string): string {
  return `not run: ${address} appears only in the agent's notes, and a note is never the source of an address for a proposal. Find the token with token_search by its name or symbol, or ask the owner for the address.`;
}
