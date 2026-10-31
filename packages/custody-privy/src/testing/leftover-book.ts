import { createHash, createPublicKey, type KeyObject } from "node:crypto";
import { BinferenceError, createSecret, type SecretStore } from "@binference/core";
import type { PrivyId } from "../privy/privy-records.js";
import {
  type LeftoverRecord,
  readLeftoverIndex,
  readLeftoverRecord,
} from "./leftover-record.schema.js";

/** What a run made with its owner key, as a {@link LeftoverRecord} lists it. */
export type LeftoverKind = "quorums" | "policies" | "aggregations";

/**
 * The live runs' owner keys and what each made, kept in a secret store so a run that dies leaves
 * what its cleanup needs: Privy deletes an owned aggregation only with its owner's signature, and
 * lists no aggregations. Each record is one entry named after its key; an index entry names them
 * all, since a store lists nothing. Calls run one at a time, in the order made.
 */
export interface LeftoverBook {
  /**
   * Keeps an owner key with nothing made yet, before the run makes anything, and answers its name;
   * a key already kept keeps what its record lists.
   */
  keep(ownerKey: KeyObject, signal: AbortSignal): Promise<string>;
  /** Adds one thing a run made to its record. */
  note(
    name: string,
    made: { readonly kind: LeftoverKind; readonly id: PrivyId },
    signal: AbortSignal,
  ): Promise<void>;
  /** The names of every kept record. */
  names(signal: AbortSignal): Promise<readonly string[]>;
  /** One kept record; undefined when the store holds none of that name or one it cannot read. */
  read(name: string, signal: AbortSignal): Promise<LeftoverRecord | undefined>;
  /** Removes a record and its key, once its cleanup confirmed everything it made gone. */
  forget(name: string, signal: AbortSignal): Promise<void>;
}

const indexName = "index";

// A record's name: the owner key's public half, hashed, so the name reveals nothing of the key.
function nameOf(ownerKey: KeyObject): string {
  const publicKey = createPublicKey(ownerKey).export({ format: "der", type: "spki" });
  return `owner-${createHash("sha256").update(publicKey).digest("hex").slice(0, 32)}`;
}

const settled = (): void => undefined;

function unkept(name: string): BinferenceError {
  return new BinferenceError({
    code: "custody.leftover_unkept",
    message: `No leftover record ${name} is kept; keep the owner key before making anything.`,
    details: { name },
  });
}

// The store's entries: the index of record names, and each record.
function entriesOf(store: SecretStore) {
  const names = async (signal: AbortSignal): Promise<readonly string[]> => {
    const held = await store.read(indexName, signal);
    return held.ok ? readLeftoverIndex(held.value.reveal()) : [];
  };
  const read = async (name: string, signal: AbortSignal): Promise<LeftoverRecord | undefined> => {
    const held = await store.read(name, signal);
    return held.ok ? readLeftoverRecord(held.value.reveal()) : undefined;
  };
  const write = async (name: string, record: LeftoverRecord, signal: AbortSignal) =>
    store.write(name, createSecret(JSON.stringify(record)), signal);
  const writeIndex = async (listed: readonly string[], signal: AbortSignal) =>
    store.write(indexName, createSecret(JSON.stringify(listed)), signal);
  return { names, read, write, writeIndex };
}

/** Creates a {@link LeftoverBook} over a secret store, such as the OS keychain. */
export function createLeftoverBook(store: SecretStore): LeftoverBook {
  let queue: Promise<void> = Promise.resolve();
  const inTurn = async <T>(work: () => Promise<T>): Promise<T> => {
    const turn = queue.then(work, work);
    queue = turn.then(settled, settled);
    return turn;
  };
  const { names, read, write, writeIndex } = entriesOf(store);
  return {
    keep: async (ownerKey, signal) =>
      inTurn(async () => {
        const name = nameOf(ownerKey);
        const privateKey = ownerKey.export({ format: "der", type: "pkcs8" }).toString("base64");
        const empty = { quorums: [], policies: [], aggregations: [] };
        const held = await read(name, signal);
        await (held === undefined
          ? write(name, { ownerKey: privateKey, ...empty }, signal)
          : Promise.resolve());
        const listed = await names(signal);
        await (listed.includes(name) ? Promise.resolve() : writeIndex([...listed, name], signal));
        return name;
      }),
    note: async (name, { kind, id }, signal) =>
      inTurn(async () => {
        const record = await read(name, signal);
        await (record === undefined
          ? Promise.reject(unkept(name))
          : write(name, { ...record, [kind]: [...record[kind], id] }, signal));
      }),
    names: async (signal) => inTurn(async () => names(signal)),
    read: async (name, signal) => inTurn(async () => read(name, signal)),
    forget: async (name, signal) =>
      inTurn(async () => {
        await store.delete(name, signal);
        const listed = await names(signal);
        await writeIndex(
          listed.filter((item) => item !== name),
          signal,
        );
      }),
  };
}
