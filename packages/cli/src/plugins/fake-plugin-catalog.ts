import { type Clock, err, type Id, ok, type Result } from "@binference/core";
import { createListingSigner, type ListingSigner } from "./fake-listing-signer.js";
import { asPayload, revocationListFixture } from "./listing-fixtures.js";
import type { PluginListing, RevocationList } from "./plugin-listing.schema.js";
import type { CatalogFailure, PluginListingCatalog } from "./ports.js";

/** What a served listing is found by: its id and its package version. */
type ListingPlace = Pick<PluginListing, "listing" | "packageName" | "packageVersion">;

/**
 * The listing catalog as a test stands it up: it signs listings and revocation lists with a key
 * the test made, and answers as a catalog or a transport that lies would.
 */
export interface FakePluginCatalog extends PluginListingCatalog {
  readonly signer: ListingSigner;
  /** Serves `listing`, signed, as its id's newest version. */
  list(listing: PluginListing): void;
  /** Serves this envelope as it is for a listing's id and package version. */
  serveListing(place: ListingPlace, envelope: string): void;
  /** Signs the next revocation list now, with `listings` revoked beside those revoked before. */
  revoke(...listings: readonly Id<"pls">[]): RevocationList;
  /** Signs the next revocation list now with nothing new, as the catalog does every 10 minutes. */
  renew(): RevocationList;
  /** Answers this envelope as the revocation list from now on, such as an older one. */
  serveRevocations(envelope: string): void;
  /** Every revocation list it signed, as its envelope, the oldest first. */
  signedLists(): readonly string[];
  /**
   * From now on every read answers `unreachable` at once, or waits until its signal aborts, or
   * never settles at all, as an adapter that drops its signal (`stall`).
   */
  goDown(how: "refuse" | "hang" | "stall"): void;
  comeBack(): void;
  /** Its reads in order: `find <name>@<version>`, `get <id>` and `revocations`. */
  reads(): readonly string[];
}

const hourMs = 3_600_000;

// What the catalog holds; each part changes only through its own methods.
interface CatalogState {
  readonly listings: Map<string, { readonly place: ListingPlace; readonly envelope: string }>;
  readonly signed: { readonly list: RevocationList; readonly envelope: string }[];
  /** The envelope answered in place of the newest list, if any. */
  readonly served: string[];
  readonly down: Set<"refuse" | "hang" | "stall">;
  readonly asked: string[];
}

// A read as the catalog answers it while it is down: at once, once its caller gives up, or never.
async function answered<T>(
  state: CatalogState,
  signal: AbortSignal,
  answer: () => T,
): Promise<Result<T, CatalogFailure>> {
  if (signal.aborted || state.down.has("refuse")) {
    return err("unreachable");
  }
  if (state.down.has("stall")) {
    await new Promise(() => undefined);
  }
  if (state.down.has("hang")) {
    await new Promise((resolve) => {
      signal.addEventListener("abort", resolve, { once: true });
    });
    return err("unreachable");
  }
  return ok(answer());
}

function readsOf(state: CatalogState): PluginListingCatalog {
  return {
    find: async (name, version, signal) => {
      state.asked.push(`find ${name}@${version}`);
      return answered(state, signal, () =>
        [...state.listings.values()]
          .filter(({ place }) => place.packageName === name && place.packageVersion === version)
          .map(({ envelope }) => envelope),
      );
    },
    get: async (listing, signal) => {
      state.asked.push(`get ${listing}`);
      return answered(state, signal, () => state.listings.get(listing)?.envelope);
    },
    revocations: async (signal) => {
      state.asked.push("revocations");
      return answered(state, signal, () => state.served[0] ?? state.signed.at(-1)?.envelope ?? "");
    },
  };
}

// Signs the list after the newest one at the clock's time, with `revoked` added to it.
function nextList(
  state: CatalogState,
  parts: { readonly clock: Clock; readonly signer: ListingSigner },
  revoked: readonly Id<"pls">[],
): RevocationList {
  const last = state.signed.at(-1)?.list ?? revocationListFixture();
  const issuedAt = parts.clock.now();
  const list: RevocationList = {
    ...last,
    sequence: last.sequence + 1,
    issuedAt,
    expiresAt: issuedAt + hourMs,
    revoked: [...new Set([...last.revoked, ...revoked])].toSorted(),
  };
  state.signed.push({ list, envelope: parts.signer.sign("pluginRevocations", asPayload(list)) });
  state.served.splice(0);
  return list;
}

/** Stands up a listing catalog that signs with `signer`, or a key of its own, on `clock`. */
export function createFakePluginCatalog(parts: {
  readonly clock: Clock;
  readonly signer?: ListingSigner;
}): FakePluginCatalog {
  const signer = parts.signer ?? createListingSigner();
  const first = revocationListFixture({ issuedAt: parts.clock.now() });
  const state: CatalogState = {
    listings: new Map(),
    signed: [{ list: first, envelope: signer.sign("pluginRevocations", asPayload(first)) }],
    served: [],
    down: new Set(),
    asked: [],
  };
  const serve = (place: ListingPlace, envelope: string): void => {
    state.listings.set(place.listing, { place, envelope });
  };
  const signing = { clock: parts.clock, signer };
  return {
    ...readsOf(state),
    signer,
    list: (listing) => serve(listing, signer.sign("pluginListing", asPayload(listing))),
    serveListing: serve,
    revoke: (...listings) => nextList(state, signing, listings),
    renew: () => nextList(state, signing, []),
    serveRevocations: (envelope) => {
      state.served.splice(0, 1, envelope);
    },
    signedLists: () => state.signed.map(({ envelope }) => envelope),
    goDown: (how) => {
      state.down.clear();
      state.down.add(how);
    },
    comeBack: () => {
      state.down.clear();
    },
    reads: () => [...state.asked],
  };
}
