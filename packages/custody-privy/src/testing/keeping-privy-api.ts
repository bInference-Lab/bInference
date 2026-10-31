import type { PrivyApi } from "../privy/privy-api.js";
import type { PrivyId } from "../privy/privy-records.js";
import type { LeftoverBook, LeftoverKind } from "./leftover-book.js";

/** The kept record a live run notes what it makes in, and its owner key's public half. */
export interface KeptRun {
  readonly book: LeftoverBook;
  /** The record's name, as {@link LeftoverBook.keep} answered it. */
  readonly name: string;
  /** The owner key's public half, DER SubjectPublicKeyInfo in base64. */
  readonly ownerKey: string;
}

/**
 * Privy's API for a live run that notes, in its kept record, every key quorum of its owner key,
 * policy and aggregation it makes, as soon as Privy answers each one's id, so a sweep finds them
 * after the run dies.
 */
export function createKeepingPrivyApi(api: PrivyApi, run: KeptRun): PrivyApi {
  const note = async (kind: LeftoverKind, id: PrivyId, signal: AbortSignal): Promise<PrivyId> => {
    await run.book.note(run.name, { kind, id }, signal);
    return id;
  };
  return {
    ...api,
    createKeyQuorum: async (request, options) => {
      const made = await api.createKeyQuorum(request, options);
      await (request.publicKey === run.ownerKey
        ? note("quorums", made.id, options.signal)
        : Promise.resolve(made.id));
      return made;
    },
    createPolicy: async (request, options) => {
      const made = await api.createPolicy(request, options);
      await note("policies", made.id, options.signal);
      return made;
    },
    createAggregation: async (request, options) =>
      note("aggregations", await api.createAggregation(request, options), options.signal),
  };
}
