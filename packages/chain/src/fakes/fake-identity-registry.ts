import { BinferenceError, err, type JsonValue, ok, type Result } from "@binference/core";
import { type AccountRef, accountRefParts, accountRefSchema } from "../caip/account-ref.js";
import type { ChainRef } from "../caip/chain-ref.js";
import type { IdentityRegistry } from "../identity/ports.js";
import type {
  DecodedRegistration,
  LandedRegistration,
  RegistrationCard,
} from "../identity/registration.js";
import type { SimulatedStep } from "../simulation/simulated-step.js";
import { isTxHash, type TxDraft, type TxHash } from "../transaction.js";
import { fakeCallOf, fakeDraft } from "./fake-draft.js";

/** What a fake identity registry starts with. */
export interface FakeIdentityOptions {
  readonly chain: ChainRef;
  /** The registry's address in the fake family: `0x` and 8 hex digits. */
  readonly address: string;
  /** The version it reports; the version it was tested with when absent. */
  readonly version?: string;
  /** The contract its proxy runs, and was tested with; none, as for a registry no proxy fronts. */
  readonly implementation?: AccountRef;
}

/** A fake identity registry a test registers through, tampers with and takes down. */
export interface FakeIdentityRegistry extends IdentityRegistry {
  /** Runs the draft unsent: a registration mints one identity token to its wallet. */
  simulate(draft: TxDraft): SimulatedStep;
  /**
   * Lands the draft as a transaction, minting its identity, and answers its hash: `hash` when
   * given, as a fake network names it, else one of the fake's own. A hash landed once answers as it
   * did, minting nothing more.
   */
  land(draft: TxDraft, hash?: TxHash): TxHash;
  /** Mints an identity to the wallet outside binference, as another app would. */
  registerOutside(wallet: AccountRef): void;
  /** Sets the version the registry reports from now on. */
  setVersion(version: string): void;
  /** Points its proxy at another contract from now on, as an upgrade would. */
  upgrade(implementation: AccountRef): void;
  /** Moves an identity to another holder, or sets the file it holds. */
  tamper(onchainId: string, change: Partial<Omit<LandedRegistration, "onchainId">>): void;
  /** Every later read rejects as a chain that does not answer, until `up`. */
  down(): void;
  up(): void;
}

const registryName = "identity-registry";
// The one call the fake declares, as a registry's plugin declares its call for a ceiling.
const registerAbi: JsonValue = {
  type: "function",
  name: "register",
  inputs: [{ name: "agentURI", type: "string" }],
  outputs: [],
  stateMutability: "nonpayable",
};

/** The registry version the fake was tested with. */
const testedVersion = "2.0.0";
const mintedTopic = "minted";

// What the fake registry holds and how it changes: its identities by id, its landed
// registrations by hash, the version it reports and whether it answers.
interface FakeBook {
  readonly chain: ChainRef;
  readonly address: string;
  readonly registry: AccountRef;
  readonly version: () => string;
  readonly implementation: () => AccountRef | undefined;
  readonly readable: (signal: AbortSignal) => void;
  readonly token: (onchainId: string) => Omit<LandedRegistration, "onchainId"> | undefined;
  readonly held: (wallet: AccountRef) => number;
  readonly count: () => number;
  readonly mint: (wallet: AccountRef, file: string) => string;
  readonly put: (onchainId: string, token: Omit<LandedRegistration, "onchainId">) => void;
  readonly landing: (
    hash: TxHash,
  ) => { readonly wallet: AccountRef; readonly onchainId: string } | undefined;
  readonly land: (wallet: AccountRef, file: string, hash?: TxHash) => TxHash;
  readonly set: (change: {
    readonly version?: string;
    readonly isDown?: boolean;
    readonly implementation?: AccountRef;
  }) => void;
}

function fault(problem: string): BinferenceError {
  return new BinferenceError({ code: "chain.rpc_down", message: problem });
}

function createBook(options: FakeIdentityOptions): FakeBook {
  const tokens = new Map<string, Omit<LandedRegistration, "onchainId">>();
  const landings = new Map<TxHash, { readonly wallet: AccountRef; readonly onchainId: string }>();
  const state: { version: string; isDown: boolean; implementation?: AccountRef } = {
    version: options.version ?? testedVersion,
    isDown: false,
    ...(options.implementation === undefined ? {} : { implementation: options.implementation }),
  };
  const mint = (wallet: AccountRef, file: string) => {
    const onchainId = String(tokens.size);
    tokens.set(onchainId, { owner: wallet, file });
    return onchainId;
  };
  return {
    chain: options.chain,
    address: options.address,
    registry: accountRefSchema.parse(`${options.chain}:${options.address}`),
    version: () => state.version,
    implementation: () => state.implementation,
    readable: (signal) => {
      signal.throwIfAborted();
      if (state.isDown) {
        throw fault("The fake registry is down.");
      }
    },
    token: (onchainId) => tokens.get(onchainId),
    held: (wallet) => [...tokens.values()].filter((token) => token.owner === wallet).length,
    count: () => tokens.size,
    mint,
    put: (onchainId, token) => tokens.set(onchainId, token),
    landing: (hash) => landings.get(hash),
    land: (wallet, file, given) => {
      const hash = given ?? `fake-identity-${landings.size}`;
      if (!isTxHash(hash)) {
        throw fault("A fake hash is malformed.");
      }
      if (!landings.has(hash)) {
        landings.set(hash, { wallet, onchainId: mint(wallet, file) });
      }
      return hash;
    },
    set: (change) => Object.assign(state, change),
  };
}

function fileOf(book: FakeBook, card: RegistrationCard): string {
  if (accountRefParts(card.wallet).chain !== book.chain) {
    throw fault("The card's wallet is on another chain.");
  }
  return `data:application/json,${encodeURIComponent(JSON.stringify(card))}`;
}

function decodeIn(book: FakeBook, draft: TxDraft): Result<DecodedRegistration, "unknown_call"> {
  const call = fakeCallOf(draft);
  const [name, file, ...rest] = call?.data.split(",") ?? [];
  const isOwn = draft.chain === book.chain && call?.to === book.address && call.value === 0n;
  return isOwn && name === "register" && file !== undefined && rest.length === 0
    ? ok({ file: decodeURIComponent(file) })
    : err("unknown_call");
}

function landedIn(
  book: FakeBook,
  request: { readonly wallet: AccountRef; readonly txHash: TxHash },
): Result<LandedRegistration, "not_found"> {
  const made = book.landing(request.txHash);
  const token = made === undefined ? undefined : book.token(made.onchainId);
  return made?.wallet === request.wallet && token !== undefined
    ? ok({ onchainId: made.onchainId, ...token })
    : err("not_found");
}

function simulateIn(book: FakeBook, draft: TxDraft): SimulatedStep {
  const isOwn = decodeIn(book, draft).ok;
  const topics = [mintedTopic, draft.from, String(book.count())];
  return {
    status: isOwn ? "success" : "reverted",
    gasUsed: isOwn ? 180_000n : 30_000n,
    transfers: [],
    approvals: [],
    logs: isOwn ? [{ emitter: book.registry, topics, data: "" }] : [],
  };
}

// The contract the book's proxy ran when the fake was made, which it was tested with.
function testedImplementationOf(book: FakeBook): Pick<IdentityRegistry, "testedImplementation"> {
  const implementation = book.implementation();
  return implementation === undefined ? {} : { testedImplementation: implementation };
}

// The port's reads and calls over the book.
function registryOf(book: FakeBook): IdentityRegistry {
  return {
    id: "fake-identity",
    contracts: [
      {
        chain: book.chain,
        names: [registryName],
        calls: [{ contract: registryName, abi: registerAbi, walletInputs: [] }],
        unapproved: [registryName],
      },
    ],
    chain: book.chain,
    registry: book.registry,
    testedVersion,
    releaseLink: "https://example.org/binference",
    ...testedImplementationOf(book),
    fileOf: (card) => fileOf(book, card),
    standing: async (wallet, { signal }) => {
      book.readable(signal);
      const implementation = book.implementation();
      const held = { version: book.version(), held: BigInt(book.held(wallet)) };
      return Promise.resolve(implementation === undefined ? held : { ...held, implementation });
    },
    build: ({ wallet, file }) =>
      fakeDraft(wallet, {
        to: book.address,
        value: 0n,
        data: `register,${encodeURIComponent(file)}`,
      }),
    decode: (draft) => decodeIn(book, draft),
    minted: (step, wallet) =>
      (step.logs ?? []).filter(
        ({ emitter, topics }) =>
          emitter === book.registry && topics[0] === mintedTopic && topics[1] === wallet,
      ).length,
    landed: async (request, { signal }) => {
      book.readable(signal);
      return Promise.resolve(landedIn(book, request));
    },
  };
}

/**
 * Creates an identity registry for tests over the fake family: `register,<file>` is its one call,
 * the file written as a URI component, which mints the next id to the draft's sender; its step
 * logs `minted` with the wallet and the id. Ids start at 0, and transactions take the hashes
 * `fake-identity-<n>`.
 */
export function createFakeIdentityRegistry(options: FakeIdentityOptions): FakeIdentityRegistry {
  const book = createBook(options);
  return {
    ...registryOf(book),
    simulate: (draft) => simulateIn(book, draft),
    land: (draft, hash) => {
      const decoded = decodeIn(book, draft);
      if (!decoded.ok) {
        throw fault("The fake registry was handed another call.");
      }
      return book.land(draft.from, decoded.value.file, hash);
    },
    registerOutside: (wallet) => {
      book.mint(wallet, "data:,");
    },
    setVersion: (version) => {
      book.set({ version });
    },
    upgrade: (implementation) => {
      book.set({ implementation });
    },
    tamper: (onchainId, change) => {
      const token = book.token(onchainId);
      if (token !== undefined) {
        book.put(onchainId, { ...token, ...change });
      }
    },
    down: () => {
      book.set({ isDown: true });
    },
    up: () => {
      book.set({ isDown: false });
    },
  };
}
