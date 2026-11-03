import type { AccountRef, ChainRef, SimulatedStep, TxDraft, TxHash } from "@binference/chain";
import {
  type IdentityRegistry,
  type IdentityStanding,
  identityStandingSchema,
  type LandedRegistration,
  landedRegistrationSchema,
  registrationFileSchema,
} from "@binference/chain/identity";
import { err, type JsonValue, ok, type Result } from "@binference/core";

// What a registration builds: the file from the registering wallet.
interface IdentityBuild {
  readonly wallet: AccountRef;
  readonly file: string;
}

/**
 * The only caller of the identity plugins (decision 0335): it copies every answer through its
 * schema, holds every call a plugin builds to the file and the wallet it was asked for, and reads
 * a plugin that throws, times out or answers outside its shape as `venue_down`.
 */
export interface IdentityHost {
  /** The registries the engine runs, the first one the one a registration uses. */
  readonly registries: readonly IdentityRegistry[];
  /** The registry the engine runs on the chain, or `undefined`. */
  readonly registryOn: (chain: ChainRef) => IdentityRegistry | undefined;
  /** The calls the registry declares on its chain, as a ceiling holds them. */
  callsOf(registry: IdentityRegistry): readonly JsonValue[];
  /** The registry's version and the wallet's identity tokens, at the latest block. */
  standing(
    registry: IdentityRegistry,
    wallet: AccountRef,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<IdentityStanding, "venue_down">>;
  /**
   * The registration's one call, held to its request: it decodes back to the file, from the
   * wallet, on the registry's chain; anything else is `decode_mismatch`.
   */
  build(registry: IdentityRegistry, request: IdentityBuild): Result<TxDraft, "decode_mismatch">;
  /** Whether a stored draft still decodes to the registration the card confirmed. */
  holds(registry: IdentityRegistry, draft: TxDraft, request: IdentityBuild): boolean;
  /** How many identity tokens the step minted to the wallet; a plugin that throws counts none. */
  minted(registry: IdentityRegistry, step: SimulatedStep, wallet: AccountRef): number;
  /** What the landed registration made, read back. */
  landed(
    registry: IdentityRegistry,
    request: { readonly wallet: AccountRef; readonly txHash: TxHash },
    options: { readonly signal: AbortSignal },
  ): Promise<Result<LandedRegistration, "not_found" | "venue_down">>;
}

// A plugin's read, with any fault but the caller's stop read as `venue_down`.
async function hosted<T>(
  signal: AbortSignal,
  read: () => Promise<T>,
): Promise<Result<T, "venue_down">> {
  try {
    return ok(await read());
  } catch {
    signal.throwIfAborted();
    return err("venue_down");
  }
}

function holdsBuild(registry: IdentityRegistry, draft: TxDraft, request: IdentityBuild): boolean {
  try {
    const decoded = registry.decode(draft);
    return (
      decoded.ok &&
      decoded.value.file === request.file &&
      draft.from === request.wallet &&
      draft.chain === registry.chain
    );
  } catch {
    return false;
  }
}

/** Creates the identity host over the registries the engine runs. */
export function createIdentityHost(registries: readonly IdentityRegistry[]): IdentityHost {
  return {
    registries,
    registryOn: (chain) => registries.find((registry) => registry.chain === chain),
    callsOf: (registry) =>
      registry.contracts
        .filter((contracts) => contracts.chain === registry.chain)
        .flatMap((contracts) => (contracts.calls ?? []).map((call) => call.abi)),
    standing: async (registry, wallet, { signal }) => {
      const read = await hosted(signal, async () => registry.standing(wallet, { signal }));
      const parsed = read.ok ? identityStandingSchema.safeParse(read.value) : undefined;
      return parsed?.success === true ? ok(parsed.data) : err("venue_down");
    },
    build: (registry, request) => {
      try {
        const file = registrationFileSchema.safeParse(request.file);
        const draft = file.success ? registry.build(request) : undefined;
        return draft !== undefined && holdsBuild(registry, draft, request)
          ? ok(draft)
          : err("decode_mismatch");
      } catch {
        return err("decode_mismatch");
      }
    },
    holds: holdsBuild,
    minted: (registry, step, wallet) => {
      try {
        return registry.minted(step, wallet);
      } catch {
        return 0;
      }
    },
    landed: async (registry, request, { signal }) => {
      const read = await hosted(signal, async () => registry.landed(request, { signal }));
      if (!read.ok || !read.value.ok) {
        return read.ok ? err("not_found") : read;
      }
      const parsed = landedRegistrationSchema.safeParse(read.value.value);
      return parsed.success ? ok(parsed.data) : err("venue_down");
    },
  };
}
