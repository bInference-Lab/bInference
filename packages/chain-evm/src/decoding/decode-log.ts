import { type Abi, decodeEventLog, type DecodeEventLogReturnType, type Hex, isHex } from "viem";

/** A log's topics and data, as hex text from any source. */
export interface LogParts {
  readonly topics: readonly string[];
  readonly data: string;
}

/**
 * Decodes a log against a contract's events, strictly: its first topic names an event of the ABI
 * and its topics and data hold exactly that event's arguments. Anything else, a part that is no
 * hex among it, is `undefined`, never a throw: a log that does not decode is passed over.
 */
export function decodeLog<const TAbi extends Abi>(
  abi: TAbi,
  log: LogParts,
): DecodeEventLogReturnType<TAbi> | undefined {
  const [first, ...rest] = log.topics;
  const topics = rest.filter((topic) => isHex(topic));
  if (first === undefined || !isHex(first) || !isHex(log.data) || topics.length !== rest.length) {
    return undefined;
  }
  const wire: { readonly topics: [Hex, ...Hex[]]; readonly data: Hex } = {
    topics: [first, ...topics],
    data: log.data,
  };
  try {
    return decodeEventLog({ abi, ...wire, strict: true });
  } catch {
    return undefined;
  }
}
