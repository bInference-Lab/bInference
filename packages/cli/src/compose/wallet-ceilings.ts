import {
  type ChainRegistry,
  isBridgeVenue,
  type VenueDeclaration,
  type WalletRole,
} from "@binference/chain";
import { BinferenceError } from "@binference/core";
import { type HeldCaps, readCeiling } from "@binference/custody-privy";
import type { InstallStore } from "@binference/engine/install";
import { z } from "zod";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import { type CeilingDraft, ceilingRequestOf } from "../init/ceiling-request.js";
import { launchPlansOf } from "./launch-plans.js";

/** What a new wallet's ceiling is planned from: the registry, the config and the venues run. */
export interface WalletCeilingOptions {
  readonly chains: ChainRegistry;
  readonly config: Pick<BinferenceConfig, "chains" | "defaults">;
  /** The venues this install runs: a new wallet's ceiling lets it call theirs. */
  readonly venues: readonly VenueDeclaration[];
}

/**
 * The venues a wallet's ceiling is planned from, among those this install runs: a bridge wallet's
 * every bridge venue, whichever venues the agent uses, so its ceiling always holds their deposits
 * (decision 0307); any other wallet's the venues named.
 */
export function ceilingVenuesOf(
  installed: readonly VenueDeclaration[],
  wallet: { readonly venues: readonly string[]; readonly role?: WalletRole | undefined },
): readonly VenueDeclaration[] {
  return wallet.role === "bridge"
    ? installed.filter(isBridgeVenue)
    : installed.filter((venue) => wallet.venues.includes(venue.id));
}

/**
 * A new wallet's ceiling on each enabled chain, as init builds the first one, for the venues
 * {@link ceilingVenuesOf} gives; a launch wallet's with the launch rules of every launchpad it runs
 * too (decision 0217). A config init would refuse is a fault here.
 */
export function ceilingChainsOf(
  options: WalletCeilingOptions,
  wallet: { readonly venues: readonly string[]; readonly role?: WalletRole },
): Pick<CeilingDraft, "chains" | "capPlans"> {
  const named = ceilingVenuesOf(options.venues, wallet);
  const request = ceilingRequestOf(options.chains, options.config, {
    venues: named,
    rescue: "",
    ...(wallet.role === undefined ? {} : { role: wallet.role }),
  });
  if (!request.ok) {
    throw new BinferenceError({
      code: "cli.ceiling_unbuilt",
      message: "The config gives no ceiling a wallet can have.",
      details: { problem: request.refusal.code },
    });
  }
  const { chains, capPlans } = request.value;
  const isLaunch = wallet.role === "launch";
  return { chains: isLaunch ? launchPlansOf(chains, options.venues) : chains, capPlans };
}

const storedPolicy = z.object({ rules: z.array(z.json()) });

const tokenCaps = (caps: readonly HeldCaps[]): number =>
  caps.reduce((count, item) => count + item.caps.approvals.length, 0);

/**
 * The 24-hour caps the live wallets' ceilings name, as the store mirrors them, which every ceiling
 * of the install shares: those of the ceiling naming the most token caps, since a token cap joins
 * at the end of a ceiling's caps in the change that first needs it (decision 0305).
 */
export async function heldCapsOf(
  install: Pick<InstallStore, "read">,
  signal: AbortSignal,
): Promise<readonly HeldCaps[]> {
  const { wallets } = await install.read({ signal });
  const held = wallets
    .filter((wallet) => wallet.archivedAtMs === undefined)
    .map((wallet) => {
      const policy = storedPolicy.safeParse(wallet.ceiling.policy);
      return policy.success ? (readCeiling(policy.data.rules)?.caps ?? []) : [];
    });
  const named = held.filter((caps) => caps.length > 0);
  return named.toSorted((left, right) => tokenCaps(right) - tokenCaps(left))[0] ?? [];
}
