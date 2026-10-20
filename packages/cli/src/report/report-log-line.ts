import type { JsonValue } from "@binference/core";
import { addressPartOf, shortAddress } from "@binference/i18n";
import { type LogLine, logLineSchema } from "../logging/log-line.schema.js";

/** What stands in for a field value its rule does not take. */
export const omittedMark = "[omitted]";

// A dotted name as code writes one: a subsystem, an event or an error code.
const dottedName = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/;
// An id binference made, such as `int_0192…`, or a connection's trace id.
const plainId = /^[a-z]{2,4}_[0-9a-f-]{8,40}$/;
// A CAIP-2 chain id, such as `eip155:56`.
const chainId = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/;
// A data source's or venue's id, such as `dexscreener`.
const sourceName = /^[a-z0-9][a-z0-9_-]{0,39}$/;
// The chain and namespace a CAIP-10 account or CAIP-19 asset starts with, up to its address.
const refHead = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}(?::|\/[-a-z0-9]{3,8}:)$/;
const evmAddress = /^0x[0-9a-fA-F]{40}$/;
// A native coin's SLIP-44 number, such as `714` for BNB.
const coinNumber = /^\d{1,10}$/;

// A CAIP-10 account or CAIP-19 asset with its address cut to the short form.
function shortRef(ref: string): string {
  const address = addressPartOf(ref);
  const head = ref.slice(0, ref.length - address.length);
  if (!refHead.test(head)) {
    return omittedMark;
  }
  if (coinNumber.test(address)) {
    return ref;
  }
  return evmAddress.test(address) ? `${head}${shortAddress(address)}` : omittedMark;
}

const fieldRules: Readonly<Record<string, (value: string) => string>> = {
  agentId: (value) => (plainId.test(value) ? value : omittedMark),
  intentId: (value) => (plainId.test(value) ? value : omittedMark),
  orderId: (value) => (plainId.test(value) ? value : omittedMark),
  traceId: (value) => (plainId.test(value) ? value : omittedMark),
  chain: (value) => (chainId.test(value) ? value : omittedMark),
  assetId: shortRef,
  accountId: shortRef,
  sourceId: (value) => (sourceName.test(value) ? value : omittedMark),
  errorCode: (value) => (dottedName.test(value) ? value : omittedMark),
};

function fieldValue(key: string, value: string | number): JsonValue {
  const rule = fieldRules[key];
  if (typeof value === "number") {
    return value;
  }
  return rule === undefined ? omittedMark : rule(value);
}

function fieldsOf(line: LogLine): { readonly [key: string]: JsonValue } {
  const fields: readonly (readonly [string, string | number])[] = Object.entries(line.fields ?? {});
  return Object.fromEntries(fields.map(([key, value]) => [key, fieldValue(key, value)]));
}

/**
 * One line of the engine log as the support bundle keeps it, or `undefined` when the line is not
 * the log's JSON shape. Only the fields the log line's schema names pass, each by its own rule:
 * ids, chain ids, source ids and error codes when they have their shape, accounts and assets with
 * their address cut to the short form, and numbers as they are. A value that breaks its rule is
 * kept as `[omitted]`, so the reader sees a field was there.
 */
export function reportLogLine(text: string): { readonly [key: string]: JsonValue } | undefined {
  const parsed = parseLine(text);
  if (parsed === undefined) {
    return undefined;
  }
  const fields = fieldsOf(parsed);
  return {
    time: parsed.time,
    level: parsed.level,
    subsystem: dottedName.test(parsed.subsystem) ? parsed.subsystem : omittedMark,
    event: dottedName.test(parsed.event) ? parsed.event : omittedMark,
    ...(Object.keys(fields).length === 0 ? {} : { fields }),
  };
}

function parseLine(text: string): LogLine | undefined {
  try {
    const line = logLineSchema.safeParse(JSON.parse(text));
    return line.success ? line.data : undefined;
  } catch {
    return undefined;
  }
}
